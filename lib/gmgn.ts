import type { Chain, KlineCandle, RankToken, Signal, Trader } from "@/lib/types";

const HOST = (process.env.GMGN_OPENAPI_HOST || "https://openapi.gmgn.ai").replace(/\/$/, "");
export const SIGNAL_CHAINS: Chain[] = ["sol", "bsc", "robinhood"];
export const MIN_MARKET_CAP = 1_000_000;
export const SIGNAL_LABELS: Record<number, string> = {
  1: "K线异动",
  6: "价格拉升",
  7: "创历史新高",
  8: "市值关键位",
  12: "聪明钱买入",
  14: "巨额买入",
  15: "多钱包买入",
  16: "多笔巨额买入",
  20: "KOL买入",
};
const TRACKED_SIGNAL_TYPES = new Set(Object.keys(SIGNAL_LABELS).map(Number));

function apiKey() {
  const key = (process.env.GMGN_API_KEY || "").trim();
  if (!key) throw new Error("GMGN_API_KEY 未配置");
  return key;
}

async function gmgnRequest(path: string, options: { method?: "GET" | "POST"; query?: Record<string, string | number>; body?: unknown } = {}) {
  const url = new URL(`${HOST}${path}`);
  for (const [key, value] of Object.entries(options.query || {})) url.searchParams.set(key, String(value));
  url.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000)));
  url.searchParams.set("client_id", crypto.randomUUID());
  const response = await fetch(url, {
    method: options.method || "GET",
    cache: "no-store",
    headers: {
      "X-APIKEY": apiKey(),
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "MemeToGo/0.1 Alpha-Radar",
    },
    body: options.body == null ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(12_000),
  });
  let payload: unknown = {};
  try { payload = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const reset = response.headers.get("X-RateLimit-Reset");
    throw new Error(`GMGN HTTP ${response.status}${reset ? `，限频重置 ${reset}` : ""}`);
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const p = payload as Record<string, unknown>;
    if (p.code != null && ![0, "0"].includes(p.code as never)) {
      throw new Error(`GMGN API：${String(p.message || p.error || p.msg || p.code)}`);
    }
  }
  return payload;
}

function dict(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function num(value: unknown, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function nullableNum(value: unknown) { const n = Number(value); return value === null || value === undefined || value === "" || !Number.isFinite(n) ? null : n; }
function int(value: unknown, fallback = 0) { const n = Number.parseInt(String(value ?? ""), 10); return Number.isFinite(n) ? n : fallback; }
function nested(row: Record<string, any>) { return [row, dict(row.data), dict(row.cur_data), dict(row.token)]; }
function pick(row: Record<string, any>, ...keys: string[]) {
  for (const source of nested(row)) for (const key of keys) if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  return undefined;
}
function epoch(value: unknown) {
  let n = num(value, 0);
  if (!n && typeof value === "string") n = Date.parse(value) / 1000;
  if (n > 10_000_000_000) n /= 1000;
  return n || Date.now() / 1000;
}
function rowsFrom(payload: unknown, keys: string[]): any[] {
  if (Array.isArray(payload)) return payload.filter((x): x is Record<string, any> => !!x && typeof x === "object");
  let current: unknown = payload;
  for (let depth = 0; depth < 5; depth++) {
    const obj = dict(current);
    for (const key of keys) if (Array.isArray(obj[key])) return obj[key].filter((x: unknown) => !!x && typeof x === "object");
    if (!obj.data || obj.data === current) break;
    current = obj.data;
  }
  return [];
}

export async function fetchSignals(chain: Chain): Promise<Signal[]> {
  const payload = await gmgnRequest("/v1/market/token_signal", {
    method: "POST",
    body: {
      chain,
      groups: [
        { mc_min: MIN_MARKET_CAP, signal_type: [12, 20] },
        { mc_min: MIN_MARKET_CAP, signal_type: [1, 6, 7, 8] },
        // 14/15/16 cannot be explicitly included in GMGN filters; collect them from an unfiltered group.
        { mc_min: MIN_MARKET_CAP },
      ],
    },
  });
  const result = new Map<string, Signal>();
  for (const row of rowsFrom(payload, ["list", "items", "signals"])) {
    const signalType = int(pick(row, "signal_type", "type"), 1);
    if (!TRACKED_SIGNAL_TYPES.has(signalType)) continue;
    const address = String(pick(row, "token_address", "address", "contract_address") || "").trim();
    if (!address) continue;
    const triggerEpoch = epoch(pick(row, "trigger_at", "timestamp", "created_at"));
    const upstream = String(pick(row, "id", "signal_id") || `${address}:${signalType}:${Math.floor(triggerEpoch)}`);
    const marketCap = num(pick(row, "market_cap", "usd_market_cap", "marketcap", "mc"));
    if (marketCap && marketCap < MIN_MARKET_CAP) continue;
    result.set(`${chain}:${upstream}`, {
      id: `${chain}:${upstream}`,
      chain,
      address,
      symbol: String(pick(row, "symbol", "token_symbol") || "UNKNOWN"),
      name: String(pick(row, "name", "token_name", "symbol") || "UNKNOWN"),
      signalType,
      signalLabel: SIGNAL_LABELS[signalType] || `信号${signalType}`,
      triggerAt: new Date(triggerEpoch * 1000).toISOString(),
      triggerEpoch,
      marketCap,
      triggerMarketCap: num(pick(row, "trigger_mc")),
      firstTriggerMarketCap: num(pick(row, "first_trigger_mc")),
      athMarketCap: num(pick(row, "ath")),
      liquidity: num(pick(row, "liquidity", "liquidity_usd")),
      holderCount: int(pick(row, "holder_count")),
      top10Rate: nullableNum(pick(row, "top_10_holder_rate")),
      rugRatio: nullableNum(pick(row, "rug_ratio")),
      washTrading: Boolean(pick(row, "is_wash_trading")),
    });
  }
  return [...result.values()];
}

export async function fetchRank(chain: Chain): Promise<RankToken[]> {
  const payload = await gmgnRequest("/v1/market/rank", {
    query: { chain, interval: "5m", limit: 100, order_by: "volume", direction: "desc" },
  });
  return rowsFrom(payload, ["rank", "list", "items"]).map((row, index) => ({
    chain,
    address: String(row.address || row.token_address || "").trim(),
    symbol: String(row.symbol || "UNKNOWN"),
    name: String(row.name || row.symbol || "UNKNOWN"),
    rank: int(row.rank, index + 1),
    price: num(row.price),
    marketCap: num(row.market_cap ?? row.usd_market_cap),
    athMarketCap: num(row.history_highest_market_cap ?? row.ath),
    liquidity: num(row.liquidity),
    volume5m: num(row.volume),
    change5m: num(row.price_change_percent5m ?? row.price_change_percent),
    buys5m: int(row.buys),
    sells5m: int(row.sells),
    holders: int(row.holder_count),
    smartCount: int(row.smart_degen_count),
    kolCount: int(row.renowned_count),
    top10Rate: nullableNum(row.top_10_holder_rate),
    rugRatio: nullableNum(row.rug_ratio),
    bundlerRate: nullableNum(row.bundler_rate ?? row.top_bundler_trader_percentage),
    insiderRate: nullableNum(row.rat_trader_amount_rate ?? row.insider_rate ?? row.top_rat_trader_percentage),
    washTrading: Boolean(row.is_wash_trading),
    launchpad: row.launchpad_platform ? String(row.launchpad_platform) : undefined,
  })).filter(row => row.address);
}

export async function fetchTokenInfo(chain: Chain, address: string) {
  const payload = await gmgnRequest("/v1/token/info", { query: { chain, address } });
  const data = dict(dict(payload).data || payload);
  const stat = dict(data.stat);
  const priceObj = dict(data.price);
  const price = num(priceObj.price ?? data.price);
  const supply = num(data.circulating_supply ?? data.total_supply);
  return {
    chain,
    address,
    symbol: String(data.symbol || "UNKNOWN"),
    name: String(data.name || data.symbol || "UNKNOWN"),
    price,
    marketCap: num(data.market_cap) || (price > 0 && supply > 0 ? price * supply : 0),
    liquidity: num(data.liquidity),
    holders: int(data.holder_count),
    top10Rate: nullableNum(stat.top_10_holder_rate ?? data.top_10_holder_rate),
    rugRatio: nullableNum(data.rug_ratio),
    bundlerRate: nullableNum(stat.top_bundler_trader_percentage ?? data.bundler_rate),
    insiderRate: nullableNum(stat.top_rat_trader_percentage ?? data.insider_rate),
    washTrading: Boolean(data.is_wash_trading),
    isHoneypot: Boolean(data.is_honeypot),
    launchpad: String(data.launchpad_platform || data.launchpad || ""),
    twitter: String(data.twitter_username || data.twitter || data.twitter_url || ""),
    website: String(data.website || data.website_url || ""),
    telegram: String(data.telegram || data.telegram_url || ""),
    description: String(data.description || ""),
  };
}

export async function fetchKline(chain: Chain, address: string, resolution = "5m", hours = 24): Promise<KlineCandle[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - hours * 3600;
  const payload = await gmgnRequest("/v1/market/token_kline", { query: { chain, address, resolution, from, to } });
  const raw = Array.isArray(payload) ? payload : rowsFrom(payload, ["list", "items", "klines", "data"]);
  const candles: KlineCandle[] = [];
  for (const item of raw as any[]) {
    if (Array.isArray(item)) {
      const [time, open, close, high, low, volume] = item;
      candles.push({ time: num(time), open: num(open), close: num(close), high: num(high), low: num(low), volume: num(volume) });
    } else if (item && typeof item === "object") {
      candles.push({
        time: num(item.time ?? item.timestamp),
        open: num(item.open), close: num(item.close), high: num(item.high), low: num(item.low), volume: num(item.volume),
      });
    }
  }
  return candles.filter(c => c.time && c.open && c.high && c.low && c.close).sort((a, b) => a.time - b.time).slice(-320);
}

function normalizeTrader(row: Record<string, any>): Trader {
  const realizedProfit = num(row.realized_profit);
  const unrealizedProfit = num(row.unrealized_profit);
  const totalProfit = nullableNum(row.profit) ?? realizedProfit + unrealizedProfit;
  const cost = num(row.history_bought_cost ?? row.total_cost ?? row.buy_cost);
  const roi = (direct: unknown, profit: number) => nullableNum(direct) ?? (cost > 0 ? profit / cost : 0);
  return {
    address: String(row.address || row.wallet || row.maker || ""),
    name: String(row.name || row.twitter_name || ""),
    twitterUsername: String(row.twitter_username || ""),
    tags: Array.isArray(row.tags || row.wallet_tags) ? (row.tags || row.wallet_tags).map(String) : [],
    cost,
    sold: num(row.history_sold_income ?? row.sell_value),
    currentValue: num(row.usd_value ?? row.current_value ?? row.holding_value),
    realizedProfit,
    unrealizedProfit,
    totalProfit,
    realizedRoi: roi(row.realized_pnl, realizedProfit),
    unrealizedRoi: roi(row.unrealized_pnl, unrealizedProfit),
    totalRoi: roi(row.profit_change ?? row.pnl, totalProfit),
    suspicious: Boolean(row.is_suspicious || row.is_wash_trading),
  };
}

export async function fetchTopTraders(chain: Chain, address: string): Promise<Trader[]> {
  const merged = new Map<string, Trader>();
  const results = await Promise.allSettled(["profit", "unrealized_profit"].map(order_by => gmgnRequest("/v1/market/token_top_traders", {
    query: { chain, address, limit: 30, order_by, direction: "desc" },
  })));
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const row of rowsFrom(result.value, ["list", "items", "traders", "data"])) {
      const trader = normalizeTrader(row);
      if (!trader.address) continue;
      const key = trader.address.toLowerCase();
      const previous = merged.get(key);
      if (!previous || trader.totalProfit > previous.totalProfit) merged.set(key, trader);
    }
  }
  return [...merged.values()].sort((a, b) => b.totalProfit - a.totalProfit).slice(0, 30);
}
