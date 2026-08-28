import type { Trader, WealthStory } from "@/lib/types";

export const P0_PLUS_MIN_MARKET_CAP = 1_000_000; // User-approved lower floor for MemeToGo.
export const P0_PLUS_MIN_LIQUIDITY = 100_000;

const safeToken = (token: { marketCap: number; liquidity: number; washTrading: boolean; top10Rate: number | null; rugRatio: number | null; bundlerRate: number | null; insiderRate: number | null; isHoneypot?: boolean }) =>
  token.marketCap >= P0_PLUS_MIN_MARKET_CAP && token.liquidity >= P0_PLUS_MIN_LIQUIDITY && !token.washTrading && !token.isHoneypot &&
  !(token.top10Rate != null && token.top10Rate > .5) && !(token.rugRatio != null && token.rugRatio > .3) &&
  !(token.bundlerRate != null && token.bundlerRate > .3) && !(token.insiderRate != null && token.insiderRate > .3);

function realized(t: Trader) {
  if (t.suspicious || t.cost < 2_000 || t.sold < 20_000) return false;
  return (t.realizedProfit >= 50_000 && t.realizedRoi >= 5) ||
    (t.realizedProfit >= 150_000 && t.realizedRoi >= 3) ||
    (t.realizedProfit >= 500_000 && t.realizedRoi >= 2);
}
function paper(t: Trader) {
  if (t.suspicious || t.cost < 2_000) return false;
  return (t.unrealizedProfit >= 250_000 && t.unrealizedRoi >= 10) ||
    (t.totalProfit >= 500_000 && t.totalRoi >= 3) ||
    (t.currentValue >= 500_000 && t.cost <= 50_000 && t.totalRoi >= 10);
}
function clusterMember(t: Trader) { return !t.suspicious && t.cost >= 2_000 && t.totalProfit >= 100_000 && t.totalRoi >= 3; }

export function evaluateP0Plus(token: Parameters<typeof safeToken>[0], traders: Trader[]) {
  const eligibleToken = safeToken(token);
  const stories: WealthStory[] = [];
  if (eligibleToken) {
    for (const t of traders) {
      if (realized(t)) stories.push({ type: "cash_out", wallet: t.address, label: "已实现财富效应", profit: t.realizedProfit, roi: t.realizedRoi, cost: t.cost, currentValue: t.currentValue });
      else if (paper(t)) {
        const lowCost = t.currentValue >= 500_000 && t.cost <= 50_000 && t.totalRoi >= 10;
        stories.push({ type: lowCost ? "low_cost_moonbag" : "paper_wealth", wallet: t.address, label: lowCost ? "低成本巨额浮盈" : "未实现财富效应", profit: Math.max(t.unrealizedProfit, t.totalProfit), roi: Math.max(t.unrealizedRoi, t.totalRoi), cost: t.cost, currentValue: t.currentValue });
      }
    }
    const members = traders.filter(clusterMember);
    const totalCost = members.reduce((s, t) => s + t.cost, 0);
    const totalProfit = members.reduce((s, t) => s + t.totalProfit, 0);
    if (members.length >= 2 && totalProfit >= 500_000 && totalCost > 0 && totalProfit / totalCost >= 3) {
      stories.push({ type: "multi_wallet_cluster", wallet: `${members.length} wallets`, label: "多钱包财富共振", profit: totalProfit, roi: totalProfit / totalCost, cost: totalCost, currentValue: members.reduce((s, t) => s + t.currentValue, 0) });
    }
  }
  stories.sort((a, b) => b.profit - a.profit);
  return {
    eligibleToken,
    confirmed: eligibleToken && stories.length > 0,
    stories: stories.slice(0, 5),
    reason: !eligibleToken ? "未通过P0+基础市值/流动性/风险过滤" : stories.length ? "满足Newsalert财富效应阈值（MemeToGo市值下限改为100万美元）" : "基础条件通过，但尚未出现足够强的已实现/未实现财富效应",
  };
}
