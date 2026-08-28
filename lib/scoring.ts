import { MIN_MARKET_CAP } from "@/lib/gmgn";
import { estimateMarkedBivariateHawkes } from "@/lib/hawkes";
import type { AlphaProject, RankToken, Signal } from "@/lib/types";

const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));
const riskHigh = (value: number | null, threshold: number) => value != null && value > threshold;
const hawkesRegimeLabel = (regime: AlphaProject["hawkes"]["regime"]) => ({
  insufficient: "样本不足",
  dormant: "未启动",
  upstream_ignition: "上游点火",
  cascade: "级联形成",
  overheated: "过热",
}[regime]);

export function buildAlphaProjects(signals: Signal[], ranks: RankToken[], nowEpoch = Date.now() / 1000): AlphaProject[] {
  const rankMap = new Map(ranks.map(row => [`${row.chain}:${row.address.toLowerCase()}`, row]));
  const grouped = new Map<string, Signal[]>();
  for (const signal of signals) {
    // Preserve identity-flow history even when the signal fired below $1M.
    // The actual listing gate is evaluated after current rank data is merged.
    const key = `${signal.chain}:${signal.address.toLowerCase()}`;
    const list = grouped.get(key) || [];
    list.push(signal);
    grouped.set(key, list);
  }

  const projects: AlphaProject[] = [];
  for (const [key, rows] of grouped) {
    const smartSignals = rows.filter(row => row.signalType === 12);
    const kolSignals = rows.filter(row => row.signalType === 20);
    // Product hard gate: no recent Smart Money/KOL BUY signal, no listing.
    if (!smartSignals.length && !kolSignals.length) continue;
    const latest = [...rows].sort((a, b) => b.triggerEpoch - a.triggerEpoch)[0];
    const rank = rankMap.get(key);
    const base: RankToken = rank || {
      chain: latest.chain,
      address: latest.address,
      symbol: latest.symbol,
      name: latest.name,
      rank: 999,
      price: 0,
      marketCap: latest.marketCap,
      athMarketCap: latest.athMarketCap,
      liquidity: latest.liquidity,
      volume5m: 0,
      change5m: 0,
      buys5m: 0,
      sells5m: 0,
      holders: latest.holderCount,
      smartCount: 0,
      kolCount: 0,
      top10Rate: latest.top10Rate,
      rugRatio: latest.rugRatio,
      bundlerRate: null,
      insiderRate: null,
      washTrading: latest.washTrading,
    };
    const marketCap = base.marketCap || latest.marketCap;
    // This is the only $1M listing gate: prefer current 5m rank market cap when present.
    if (marketCap < MIN_MARKET_CAP) continue;

    const signalTypes = new Set(rows.map(row => row.signalType));
    const thesis: string[] = [];
    const risks: string[] = [];
    const p0Reasons: string[] = [];
    let score = 0;

    if (smartSignals.length) {
      score += 32 + Math.min(12, Math.max(0, smartSignals.length - 1) * 4);
      thesis.push(`近期SM买入 ${smartSignals.length}笔`);
    }
    if (kolSignals.length) {
      score += 26 + Math.min(12, Math.max(0, kolSignals.length - 1) * 4);
      thesis.push(`近期KOL买入 ${kolSignals.length}笔`);
    }
    if (smartSignals.length && kolSignals.length) {
      score += 16;
      thesis.push("SM与KOL近期同向买入");
    }
    if (base.smartCount >= 3) {
      score += 18 + (base.smartCount >= 5 ? 6 : 0);
      thesis.push(`当前SM持仓 ${base.smartCount}钱包`);
    }
    if (base.kolCount >= 2) {
      score += 10 + (base.kolCount >= 4 ? 5 : 0);
      thesis.push(`当前KOL持仓 ${base.kolCount}钱包`);
    }
    if (signalTypes.has(14)) { score += 8; thesis.push("伴随巨额买入"); }
    if (signalTypes.has(15)) { score += 5; thesis.push("伴随多钱包买入"); }
    if (signalTypes.has(16)) { score += 12; thesis.push("伴随多笔巨额买入"); p0Reasons.push("GMGN 多笔巨额买入（原生P0）"); }
    if (signalTypes.has(14)) p0Reasons.push("GMGN 巨额买入（原生P0）");

    const safe = !base.washTrading && !riskHigh(base.rugRatio, .3) && !riskHigh(base.top10Rate, .5) && !riskHigh(base.bundlerRate, .3) && !riskHigh(base.insiderRate, .3);
    if (base.smartCount >= 3 && base.rank <= 30 && base.volume5m >= 100_000 && base.liquidity >= 50_000 && safe) {
      score += 14;
      p0Reasons.push("聪明钱共振（原规则P0）");
    }
    if (base.rank <= 10 && base.volume5m >= 500_000 && base.change5m >= 20) {
      score += 8;
      p0Reasons.push("爆量拉升（原规则P0）");
    }
    const firstTriggerMc = Math.min(...rows.map(row => row.firstTriggerMarketCap || Number.POSITIVE_INFINITY));
    if (Number.isFinite(firstTriggerMc) && firstTriggerMc < 5_000_000 && marketCap >= 5_000_000 && base.rank <= 20 && base.volume5m >= 100_000) {
      score += 10;
      p0Reasons.push("市值突破500万美元（近似原规则P0）");
    }
    if (base.rank <= 15 && base.volume5m >= 250_000 && base.buys5m >= 30 && base.buys5m >= 2 * Math.max(base.sells5m, 1) && base.change5m >= 5) {
      score += 6;
      thesis.push(`5分钟买卖笔数 ${base.buys5m}/${base.sells5m}`);
    }
    const age = Math.max(0, nowEpoch - latest.triggerEpoch);
    if (age <= 300) score += 8;
    else if (age <= 900) score += 5;
    else if (age > 3600) score -= 10;

    if (base.washTrading) { score -= 35; risks.push("疑似刷量"); }
    if (riskHigh(base.rugRatio, .3)) { score -= 25; risks.push(`Rug风险 ${(base.rugRatio! * 100).toFixed(0)}%`); }
    if (riskHigh(base.top10Rate, .5)) { score -= 20; risks.push(`Top10持仓 ${(base.top10Rate! * 100).toFixed(0)}%`); }
    if (riskHigh(base.bundlerRate, .3)) { score -= 15; risks.push(`Bundler ${(base.bundlerRate! * 100).toFixed(0)}%`); }
    if (riskHigh(base.insiderRate, .3)) { score -= 15; risks.push(`内幕地址 ${(base.insiderRate! * 100).toFixed(0)}%`); }
    if (base.liquidity > 0 && base.liquidity < 100_000) { score -= 8; risks.push("流动性低于10万美元"); }

    const hawkes = estimateMarkedBivariateHawkes(rows, nowEpoch);
    if (hawkes.eventCount >= 2) {
      thesis.unshift(`Hawkes ρ ${hawkes.reproductionNumber.toFixed(2)} · ${hawkesRegimeLabel(hawkes.regime)} · 内生 ${(hawkes.endogenousRatio * 100).toFixed(0)}%`);
      thesis.unshift(`Hawkes SM→KOL ${hawkes.smartToKol.toFixed(2)} / KOL→SM ${hawkes.kolToSmart.toFixed(2)}`);
    }

    score = Math.round(clamp(score));
    const grade: AlphaProject["grade"] = score >= 85 ? "A+" : score >= 70 ? "A" : score >= 55 ? "B+" : "B";
    projects.push({
      ...base,
      marketCap,
      key,
      smartBuySignals: smartSignals.length,
      kolBuySignals: kolSignals.length,
      contextSignals: [...signalTypes].sort((a, b) => a - b),
      latestSignalAt: latest.triggerAt,
      latestSignalEpoch: latest.triggerEpoch,
      score,
      grade,
      legacyP0: p0Reasons.length > 0,
      legacyP0Reasons: [...new Set(p0Reasons)],
      thesis: [...new Set(thesis)].slice(0, 6),
      risks: [...new Set(risks)],
      hawkes,
    });
  }

  return projects.sort((a, b) => b.score - a.score || b.latestSignalEpoch - a.latestSignalEpoch);
}
