"use client";

import type { AlphaProject, HawkesMetrics } from "@/lib/types";
import styles from "./hawkes.module.css";

const regimeLabels: Record<HawkesMetrics["regime"], string> = {
  insufficient: "暂无资金事件",
  seed: "刚有资金介入",
  unilateral: "单边持续买入",
  dormant: "暂未形成接力",
  upstream_ignition: "聪明钱带动扩散",
  cascade: "资金接力形成",
  overheated: "资金传播过热",
};

const confidenceLabels: Record<HawkesMetrics["confidence"], string> = {
  low: "低",
  medium: "中",
  high: "高",
};

function relayLevel(value: number) {
  if (value < 0.2) return "低";
  if (value < 0.5) return "一般";
  if (value < 1) return "较强";
  return "很强";
}

function outlook(project: AlphaProject) {
  const h = project.hawkes;
  if (!h || h.eventCount === 0) {
    return {
      bias: "暂不判断",
      tone: "neutral",
      structure: "最近还没有捕捉到聪明钱或 KOL 的有效买入。",
      outlook: "目前看不到资金接力，先参考价格、成交、P0/P0+ 和风险模块。",
      confirm: "出现第一笔聪明钱或 KOL 买入后，这个模块才开始有参考价值。",
      invalidation: "当前没有资金传播信号。",
    };
  }

  const smLead = h.smartToKol > h.kolToSmart * 1.2;
  const kolLead = h.kolToSmart > h.smartToKol * 1.2;
  const priceExtended = project.change5m >= 20;
  const weakLiquidity = project.liquidity > 0 && project.liquidity < 100_000;

  if (h.regime === "seed") {
    const smartSeed = h.latestEventType === "smart";
    return {
      bias: smartSeed ? "观察偏多" : "中性观察",
      tone: smartSeed ? "bull" : "warn",
      structure: smartSeed
        ? "刚出现第一笔聪明钱买入，说明有高质量资金开始关注，但目前还没有形成连续买入或 KOL 接力。"
        : "刚出现第一笔 KOL 买入，说明叙事热度开始出现，但暂时没有聪明钱跟进。",
      outlook: smartSeed
        ? "这是很早的观察信号，不等于马上会上涨。现在最重要的是看接下来有没有新的聪明钱继续买，或者 KOL 开始跟进。"
        : "单个 KOL 买入的参考价值有限。后面如果聪明钱开始跟进，信号才会明显变强；否则更可能只是一次孤立的情绪事件。",
      confirm: smartSeed
        ? "未来 1 小时再出现新的聪明钱买入，或首次出现 KOL 跟进，同时成交和流动性没有恶化，信号明显增强。"
        : "后续出现聪明钱买入，是 KOL 信号真正升级的关键确认。",
      invalidation: "如果后面一直没有新的身份资金跟进，这次买入的参考价值会快速下降。",
    };
  }

  if (h.regime === "unilateral") {
    const smartOnly = h.smartEvents > 0 && h.kolEvents === 0;
    return {
      bias: smartOnly ? "偏多观察" : "中性偏谨慎",
      tone: smartOnly ? "bull" : "warn",
      structure: smartOnly
        ? `已经连续出现 ${h.eventCount} 笔聪明钱买入，但暂时还没有 KOL 跟进。`
        : `已经连续出现 ${h.eventCount} 笔 KOL 买入，但暂时还没有聪明钱确认。`,
      outlook: smartOnly
        ? "连续聪明钱买入比单笔更有价值，说明资金正在形成一致行动。下一步如果 KOL 开始接力，通常代表项目从“资金关注”进入“传播扩散”。"
        : "KOL 连续买入说明热度在扩散，但没有聪明钱确认时，更容易是情绪驱动。若价格已经明显拉升，追高价值较低。",
      confirm: smartOnly
        ? "出现第一批 KOL 跟进，同时聪明钱仍继续买，是信号进一步变强的关键。"
        : "出现聪明钱跟进，才说明这轮热度可能不只是 KOL 自嗨。",
      invalidation: "如果同一类资金停止买入，且没有另一类资金接力，当前信号会逐步失效。",
    };
  }

  if (h.regime === "overheated") {
    return {
      bias: "高波动 · 谨慎追涨",
      tone: "risk",
      structure: "聪明钱和 KOL 的买入已经高度互相带动，资金传播非常拥挤，市场进入高热状态。",
      outlook: priceExtended
        ? "价格也已经快速拉升，说明资金和价格同时过热，继续追高的回撤风险明显增加。"
        : "价格还没完全垂直拉升，但资金传播已经很热，后续波动通常会明显放大。",
      confirm: "更健康的情况是资金热度稍微降下来，但价格、成交和流动性仍能维持强势。",
      invalidation: "如果身份资金突然停止买入，同时价格跌回启动区，通常意味着这轮资金接力开始结束。",
    };
  }

  if (h.regime === "upstream_ignition") {
    return {
      bias: priceExtended ? "偏多 · 但已开始兑现" : "偏多 · 早期扩散",
      tone: "bull",
      structure: "当前更像聪明钱先买，随后 KOL 开始跟进，资金传播方向比较健康。",
      outlook: `${priceExtended ? "资金结构仍然偏强，但价格已经开始反应，最早期的赔率已经下降。" : "这是比较理想的早期 Alpha 结构：聪明钱先动作，KOL 再接力，而价格还没有完全兑现。"}${weakLiquidity ? " 但当前流动性偏薄，仍要防止少量资金把价格机械推高。" : ""}`,
      confirm: "聪明钱继续买、KOL 跟进数量增加、成交同步放大，但价格还没有垂直暴涨，是最理想的继续走强确认。",
      invalidation: "如果聪明钱停止买入，反而只剩 KOL 热度继续升高，早期 Alpha 质量会明显下降。",
    };
  }

  if (h.regime === "cascade") {
    if (smLead) {
      return {
        bias: priceExtended ? "偏多 · 已到传播中段" : "偏多 · 接力扩散",
        tone: "bull",
        structure: "聪明钱和 KOL 已经形成持续接力，而且目前仍然是聪明钱更偏上游。",
        outlook: priceExtended
          ? "资金接力仍然支持趋势，但行情已经不是最早期阶段，继续追高要更看重价格位置和流动性。"
          : "资金接力已经形成，但价格还没有完全反映，后面仍有继续扩散的空间。",
        confirm: "聪明钱继续保持领先、KOL 持续跟进、成交和流动性继续扩张，是趋势延续的主要确认。",
        invalidation: "如果聪明钱和 KOL 的买入同时减弱，成交也开始萎缩，说明接力正在结束。",
      };
    }
    if (kolLead) {
      return {
        bias: "中性偏谨慎 · KOL主导",
        tone: "warn",
        structure: "虽然已经形成资金接力，但目前更像 KOL 热度先起来，聪明钱随后才参与。",
        outlook: "这种结构仍可能上涨，但更像市场已经发现项目后的扩散，不属于最理想的早期 Alpha。价格如果已经快速上涨，追高要谨慎。",
        confirm: "如果后面重新变成聪明钱先买、KOL 再跟，结构才会明显改善。",
        invalidation: "如果 KOL 继续升温但聪明钱开始减少，容易逐渐演变成纯情绪行情。",
      };
    }
    return {
      bias: "中性偏多",
      tone: "neutral",
      structure: "聪明钱和 KOL 正在互相带动，但暂时看不出谁明显领先。",
      outlook: "行情有一定持续性，但更像趋势确认，不是最早期的发现阶段。此时要结合价格是否已经涨太多来判断是否还有赔率。",
      confirm: "如果聪明钱开始明显领先，同时资金接力继续增强，结构会进一步转强。",
      invalidation: "如果两边买入都同时变弱，说明资金传播开始降温。",
    };
  }

  return {
    bias: "中性 · 先观察",
    tone: "neutral",
    structure: "已经有身份资金活动，但目前这些买入还比较零散，没有形成明显接力。",
    outlook: "现在不适合仅凭几笔聪明钱或 KOL 买入追涨。后面如果新的独立资金持续出现，信号才会升级。",
    confirm: "聪明钱连续买入、KOL 开始跟进，或者两边同时增强，都是资金结构转强的信号。",
    invalidation: "如果后续一直没有新的资金跟进，这轮信号更可能只是孤立交易。",
  };
}

function buyDecision(project: AlphaProject) {
  const h = project.hawkes;
  if (!h || h.eventCount === 0) {
    return {
      verdict: "暂不买",
      tone: "neutral",
      summary: "没有可用的身份资金传播事件，Hawkes 目前不能提供买点依据。",
      relayProbability: 0,
      forecast: "先等第一笔聪明钱或 KOL 买入出现。",
      upgrade: "出现聪明钱连续买入，并开始带动 KOL，才进入可观察区。",
      downgrade: "无传播结构可失效。",
    };
  }

  const rho = h.reproductionNumber;
  const relayProbability = Math.max(0, Math.min(1, 1 - Math.exp(-Math.max(0, h.expectedTriggered60m))));
  const smLead = h.smartToKol > h.kolToSmart * 1.2;
  const kolLead = h.kolToSmart > h.smartToKol * 1.2;
  const priceExtended = project.change5m >= 20;
  const weakLiquidity = project.liquidity > 0 && project.liquidity < 100_000;

  let score = 45;
  if (rho >= .45 && rho <= .85) score += 15;
  else if (rho >= .25 && rho < .45) score += 5;
  else if (rho > .95) score -= 18;
  else if (rho < .2) score -= 10;

  if (h.smartToSmart >= .15) score += 8;
  if (smLead) score += 14;
  if (kolLead) score -= 12;
  if (h.expectedTriggered60m >= .5) score += 10;
  else if (h.expectedTriggered60m >= .25) score += 6;
  else if (h.expectedTriggered60m < .15) score -= 6;
  if (h.localEvidenceWeight >= .5) score += 6;
  else if (h.localEvidenceWeight < .25) score -= 5;
  if (h.confidence === "high") score += 6;
  if (h.confidence === "low") score -= 5;
  if (priceExtended) score -= 10;
  if (weakLiquidity) score -= 10;
  if (h.regime === "overheated") score -= 15;
  if (h.regime === "upstream_ignition") score += 8;

  const veryBullish =
    score >= 85 &&
    rho >= .60 && rho <= .90 &&
    h.smartToSmart >= .15 &&
    h.smartToKol >= .15 &&
    h.expectedTriggered60m >= .35 &&
    h.endogenousRatio >= .35 &&
    h.localEvidenceWeight >= .50 &&
    h.confidence !== "low" &&
    h.eventCount >= 4 &&
    h.smartEvents >= 2 &&
    h.kolEvents >= 1 &&
    smLead &&
    !priceExtended &&
    !weakLiquidity &&
    h.regime !== "overheated";

  let verdict: string;
  let tone: string;
  if (veryBullish) {
    verdict = "非常看好";
    tone = "strong";
  } else if (score >= 72) {
    verdict = "可小仓试错";
    tone = "bull";
  } else if (score >= 54) {
    verdict = "等确认再买";
    tone = "warn";
  } else if (score >= 38) {
    verdict = "不建议追价";
    tone = "warn";
  } else {
    verdict = "回避";
    tone = "risk";
  }

  if (h.regime === "overheated" && (verdict === "非常看好" || verdict === "可小仓试错")) verdict = "不建议追价";
  if (kolLead && h.smartToSmart < .15 && (verdict === "非常看好" || verdict === "可小仓试错")) verdict = "等确认再买";

  const halfLife = Math.max(1, Math.round(h.kernelHalfLifeMinutes));
  const idealRho = rho < .65 ? "ρ 升向 0.65–0.85" : rho <= .85 ? "ρ 保持在 0.65–0.85" : "ρ 回落并稳定在 0.65–0.85";
  const smartNeed = h.smartToSmart < .15 ? `聪明钱连续性 ${h.smartToSmart.toFixed(2)}→≥0.15` : `聪明钱连续性维持 ≥0.15`;
  const crossNeed = h.smartToKol < .15 ? `聪明钱→KOL ${h.smartToKol.toFixed(2)}→≥0.15` : "聪明钱→KOL 维持较强";
  const relayNeed = h.expectedTriggered60m < .25 ? `未来1小时接力预期 ${h.expectedTriggered60m.toFixed(2)}→≥0.25` : "未来1小时接力预期维持 ≥0.25";

  let summary = `当前资金传播强度 ${rho.toFixed(2)}，未来1小时由现有传播带出至少一次新身份资金事件的近似概率约 ${(relayProbability * 100).toFixed(0)}%。`;
  if (veryBullish) summary += " 当前同时满足聪明钱领先、跨群体传播、连续买入、接力预期和本地证据等高质量条件，属于模型中少见的高置信早期传播结构。";
  else if (kolLead) summary += " 目前由 KOL 热度带动聪明钱的程度更高，属于偏后段的扩散结构，不是最理想的早期点火。";
  else if (smLead) summary += " 当前由聪明钱向 KOL 扩散，传播方向更符合早期 Alpha 的理想结构。";
  else summary += " 当前聪明钱与 KOL 的主导关系还不够明确。";
  if (priceExtended) summary += " 同时价格短线已经明显拉升，买点赔率进一步下降。";

  return {
    verdict,
    tone,
    summary,
    relayProbability,
    forecast: veryBullish
      ? `未来 ${halfLife} 分钟重点看强结构能否延续：聪明钱继续出现、SM→KOL 不回落、ρ 保持在健康高位而不过热。如果这些条件维持，说明传播正在从“点火”进入自持续扩散。`
      : `未来 ${halfLife} 分钟是关键观察窗口。若没有新的身份资金事件，现有 Hawkes 激发会按指数核自然衰减；若继续出现新 SM，传播强度和聪明钱连续性应抬升。`,
    upgrade: veryBullish
      ? "当前已处于最高档。后续不需要指标继续无限上升，反而要观察 ρ 不要冲到过热区、聪明钱继续领先且价格不过度垂直拉升，才能维持“非常看好”。"
      : `${idealRho}；${smartNeed}；${crossNeed}；${relayNeed}。普通信号至少出现 2 项同步改善；若要升级到“非常看好”，还需要聪明钱明确领先、项目自身数据占比 ≥50%、至少中等置信度且价格尚未短线暴涨。`,
    downgrade: veryBullish
      ? "若聪明钱停止接力、SM→KOL 明显回落、KOL 反向主导，或 ρ 升入过热区并伴随价格急拉，则从“非常看好”降级，不再按最高档处理。"
      : kolLead
        ? "若 KOL 连续性继续上升，但聪明钱连续性仍低于 0.15、聪明钱→KOL 继续弱于 KOL→聪明钱，则更像情绪扩散，应继续降低追价意愿。"
        : "若 ρ 跌破约 0.30、未来1小时接力预期降到 0.15 以下，或聪明钱连续性明显回落，说明传播开始衰减。",
  };
}

export default function HawkesPanel({ project }: { project: AlphaProject }) {
  const h = project.hawkes;
  if (!h) return <section><div className="section-title"><h3>Hawkes 资金传播</h3><span>等待模型数据</span></div><p className="muted">该项目尚未生成资金传播数据。</p></section>;
  const view = outlook(project);
  const decision = buyDecision(project);
  const horizonLabel = h.horizonMinutes >= 60 ? `${(h.horizonMinutes / 60).toFixed(h.horizonMinutes % 60 ? 1 : 0)}H` : `${h.horizonMinutes}m`;
  const relay = relayLevel(h.expectedTriggered60m);

  return <section className={styles.section}>
    <div className="section-title"><h3>Hawkes 资金传播</h3><span>观察窗口 {horizonLabel} · 模型自动适配</span></div>
    <div className={styles.statusRow}>
      <span className={`${styles.regime} ${styles[view.tone]}`}>{regimeLabels[h.regime]}</span>
      <span>当前判断：<b>{view.bias}</b></span>
      <span>可靠度：<b>{confidenceLabels[h.confidence]}</b></span>
      <span>买入样本：<b>{h.eventCount}</b>（SM {h.smartEvents} / KOL {h.kolEvents}）</span>
      <span>项目自身数据占比：<b>{(h.localEvidenceWeight * 100).toFixed(0)}%</b></span>
    </div>

    <div className={styles.cards}>
      <div className={styles.card}><span>资金传播强度</span><strong>{h.reproductionNumber.toFixed(2)}</strong><small>{h.reproductionNumber < .4 ? "目前较弱" : h.reproductionNumber < .8 ? "正在增强" : h.reproductionNumber < .95 ? "已经很强" : "接近过热"}</small></div>
      <div className={styles.card}><span>资金接力占比</span><strong>{(h.endogenousRatio * 100).toFixed(0)}%</strong><small>有多少买入可能由前面的资金带动</small></div>
      <div className={`${styles.card} ${styles.smart}`}><span>聪明钱 → KOL</span><strong>{h.smartToKol.toFixed(2)}</strong><small>聪明钱带动 KOL 的程度</small></div>
      <div className={`${styles.card} ${styles.kol}`}><span>KOL → 聪明钱</span><strong>{h.kolToSmart.toFixed(2)}</strong><small>KOL 热度带动聪明钱的程度</small></div>
    </div>

    <div className={styles.matrixLine}>
      <span>聪明钱连续性 <b>{h.smartToSmart.toFixed(2)}</b></span>
      <span>KOL连续性 <b>{h.kolToKol.toFixed(2)}</b></span>
      <span>未来1小时接力预期 <b>{relay} · {h.expectedTriggered60m.toFixed(2)}</b></span>
      <span>传播方向 <b>{h.directionalEdge > .15 ? "聪明钱领先" : h.directionalEdge < -.15 ? "KOL领先" : "暂不明显"}</b></span>
    </div>

    <div className={styles.reading}>
      <div><span>现在发生了什么</span><p>{view.structure}</p></div>
      <div className={styles.outlook}><span>对后市意味着什么</span><p>{view.outlook}</p></div>
      <div><span>什么情况会更强</span><p>{view.confirm}</p></div>
      <div><span>什么情况说明信号失效</span><p>{view.invalidation}</p></div>
    </div>

    <div className={`${styles.decision} ${styles[`decision_${decision.tone}`]}`}>
      <div className={styles.decisionHead}>
        <div><span>Hawkes 资金传播总结</span><strong>{decision.verdict}</strong></div>
        <div className={styles.probability}><span>未来1小时接力概率</span><b>{(decision.relayProbability * 100).toFixed(0)}%</b></div>
      </div>
      <p className={styles.decisionSummary}>{decision.summary}</p>
      <div className={styles.decisionGrid}>
        <div><span>未来30–60分钟怎么演化</span><p>{decision.forecast}</p></div>
        <div><span>什么变化后更值得买</span><p>{decision.upgrade}</p></div>
        <div><span>什么变化后应该放弃</span><p>{decision.downgrade}</p></div>
      </div>
    </div>

    <p className={styles.note}>简单读法：先看“聪明钱有没有继续买”，再看“KOL 有没有接力”。资金传播强度越高，说明这些买入越容易互相带动；但太高也可能意味着已经过热。未来1小时接力概率由 Hawkes 条件期望事件数近似换算为 1-e^-λ，仅用于比较传播延续性，不等同于价格上涨概率。该模块暂不计入 Alpha Score。</p>
  </section>;
}