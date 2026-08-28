import type { Chain, RankToken, Signal } from "@/lib/types";

const DEFAULT_DASHBOARD_URL = "https://newsalert-seven.vercel.app/api/gmgn/dashboard";
const TRACKED_SIGNAL_TYPES = new Set([1, 6, 7, 8, 12, 14, 15, 16, 20]);
const VALID_CHAINS = new Set<Chain>(["sol", "bsc", "robinhood"]);

function obj(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function nullableNum(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function int(value: unknown, fallback = 0) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}
function chainOf(value: unknown): Chain | null {
  const chain = String(value || "").toLowerCase() as Chain;
  return VALID_CHAINS.has(chain) ? chain : null;
}

export type NewsalertSnapshot = {
  signals: Signal[];
  ranks: RankToken[];
  health: Record<string, any>;
  status: Record<string, any>;
  sourceUrl: string;
};

export async function fetchNewsalertSnapshot(): Promise<NewsalertSnapshot> {
  const sourceUrl = (process.env.NEWSALERT_GMGN_DASHBOARD_URL || DEFAULT_DASHBOARD_URL).trim();
  const response = await fetch(sourceUrl, {
    next: { revalidate: 10 },
    headers: { Accept: "application/json", "User-Agent": "MemeToGo/0.2 Newsalert-collector-reader" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Newsalert collector HTTP ${response.status}`);
  const payload = obj(await response.json());
  const status = obj(payload.status);
  const health = obj(payload.health);

  const signals: Signal[] = [];
  for (const raw of Array.isArray(status.latest_items) ? status.latest_items : []) {
    const row = obj(raw);
    const chain = chainOf(row.chain);
    const signalType = int(row.signal_type, 0);
    if (!chain || !TRACKED_SIGNAL_TYPES.has(signalType)) continue;
    const address = String(row.address || "").trim();
    if (!address) continue;
    const triggerEpoch = num(row.trigger_epoch, Date.now() / 1000);
    signals.push({
      id: String(row.id || `${chain}:${address}:${signalType}:${Math.floor(triggerEpoch)}`),
      chain,
      address,
      symbol: String(row.symbol || "UNKNOWN"),
      name: String(row.name || row.symbol || "UNKNOWN"),
      signalType,
      signalLabel: String(row.signal_label || `信号${signalType}`),
      triggerAt: String(row.trigger_at || new Date(triggerEpoch * 1000).toISOString()),
      triggerEpoch,
      marketCap: num(row.market_cap),
      triggerMarketCap: num(row.trigger_market_cap),
      firstTriggerMarketCap: num(row.first_trigger_market_cap),
      athMarketCap: num(row.ath_market_cap),
      liquidity: num(row.liquidity),
      holderCount: int(row.holder_count),
      top10Rate: nullableNum(row.top_10_holder_rate),
      rugRatio: nullableNum(row.rug_ratio),
      washTrading: Boolean(row.is_wash_trading),
    });
  }

  const ranks: RankToken[] = [];
  for (const raw of Array.isArray(status.latest_rankings) ? status.latest_rankings : []) {
    const row = obj(raw);
    const chain = chainOf(row.chain);
    const address = String(row.address || "").trim();
    if (!chain || !address) continue;
    ranks.push({
      chain,
      address,
      symbol: String(row.symbol || "UNKNOWN"),
      name: String(row.name || row.symbol || "UNKNOWN"),
      rank: int(row.volume_rank ?? row.rank, 999),
      price: num(row.price),
      marketCap: num(row.market_cap),
      athMarketCap: num(row.ath_market_cap),
      liquidity: num(row.liquidity),
      volume5m: num(row.volume_5m),
      change5m: num(row.price_change_5m),
      buys5m: int(row.buys_5m),
      sells5m: int(row.sells_5m),
      holders: int(row.holder_count),
      smartCount: int(row.smart_degen_count),
      kolCount: int(row.renowned_count),
      top10Rate: nullableNum(row.top_10_holder_rate),
      rugRatio: nullableNum(row.rug_ratio),
      bundlerRate: nullableNum(row.bundler_rate),
      insiderRate: nullableNum(row.insider_rate),
      washTrading: Boolean(row.is_wash_trading),
      launchpad: row.launchpad_platform ? String(row.launchpad_platform) : undefined,
    });
  }

  return { signals, ranks, health, status, sourceUrl };
}

export function tokenContext(snapshot: NewsalertSnapshot, chain: Chain, address: string) {
  const key = address.toLowerCase();
  const rank = snapshot.ranks.find(row => row.chain === chain && row.address.toLowerCase() === key) || null;
  const signals = snapshot.signals
    .filter(row => row.chain === chain && row.address.toLowerCase() === key)
    .sort((a, b) => b.triggerEpoch - a.triggerEpoch);
  return { rank, signals };
}
