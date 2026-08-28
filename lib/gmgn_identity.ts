import type { Chain, Signal } from "@/lib/types";

const HOST = (process.env.GMGN_OPENAPI_HOST || "https://openapi.gmgn.ai").replace(/\/$/, "");

export type IdentityTradeDiagnostic = {
  smartRawRows: number;
  smartBuyRows: number;
  kolRawRows: number;
  kolBuyRows: number;
  warnings: string[];
};

function apiKey() {
  const key = (process.env.GMGN_API_KEY || "").trim();
  if (!key) throw new Error("GMGN_API_KEY 未配置");
  return key;
}

function dict(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function nullableNum(value: unknown) {
  const parsed = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(parsed) ? null : parsed;
}
function rowsFrom(payload: unknown): Record<string, any>[] {
  if (Array.isArray(payload)) return payload.filter((row): row is Record<string, any> => !!row && typeof row === "object");
  let current: unknown = payload;
  for (let depth = 0; depth < 5; depth++) {
    const obj = dict(current);
    for (const key of ["list", "items", "trades"]) {
      if (Array.isArray(obj[key])) return obj[key].filter((row: unknown): row is Record<string, any> => !!row && typeof row === "object");
    }
    if (!obj.data || obj.data === current) break;
    current = obj.data;
  }
  return [];
}
function value(row: Record<string, any>, ...keys: string[]) {
  const sources = [row, dict(row.base_token), dict(row.token), dict(row.data), dict(row.cur_data)];
  for (const source of sources) {
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
    }
  }
  return undefined;
}
function epoch(value: unknown) {
  let parsed = num(value, 0);
  if (!parsed && typeof value === "string") parsed = Date.parse(value) / 1000;
  if (parsed > 10_000_000_000) parsed /= 1000;
  return parsed || Date.now() / 1000;
}

async function requestFeed(path: "/v1/user/smartmoney" | "/v1/user/kol", chain: Chain) {
  const url = new URL(`${HOST}${path}`);
  url.searchParams.set("chain", chain);
  url.searchParams.set("limit", "200");
  url.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000)));
  url.searchParams.set("client_id", crypto.randomUUID());
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      "X-APIKEY": apiKey(),
      Accept: "application/json",
      "User-Agent": "MemeToGo/0.3 Identity-Flow",
    },
    signal: AbortSignal.timeout(12_000),
  });
  let payload: unknown = {};
  try { payload = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const reset = response.headers.get("X-RateLimit-Reset");
    throw new Error(`HTTP ${response.status}${reset ? `，限频重置 ${reset}` : ""}`);
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const envelope = payload as Record<string, unknown>;
    if (envelope.code != null && ![0, "0"].includes(envelope.code as never)) {
      throw new Error(String(envelope.message || envelope.error || envelope.msg || envelope.code));
    }
  }
  return rowsFrom(payload);
}

function tradeToSignal(chain: Chain, row: Record<string, any>, type: 12 | 20): Signal | null {
  if (String(row.side || "").toLowerCase() !== "buy") return null;
  const address = String(value(row, "base_address", "address", "token_address") || "").trim();
  if (!address) return null;
  const triggerEpoch = epoch(value(row, "timestamp", "created_at", "trigger_at"));
  const transaction = String(row.transaction_hash || row.tx_hash || row.id || "").trim();
  const maker = String(row.maker || dict(row.maker_info).address || "").trim();
  const stableId = transaction || `${maker}:${address}:${Math.floor(triggerEpoch)}`;
  return {
    id: `${chain}:identity:${type}:${stableId}`,
    chain,
    address,
    symbol: String(value(row, "symbol", "token_symbol") || "UNKNOWN"),
    name: String(value(row, "name", "token_name", "symbol") || "UNKNOWN"),
    signalType: type,
    signalLabel: type === 12 ? "聪明钱买入" : "KOL买入",
    triggerAt: new Date(triggerEpoch * 1000).toISOString(),
    triggerEpoch,
    marketCap: num(value(row, "market_cap", "usd_market_cap")),
    triggerMarketCap: num(value(row, "trigger_mc")),
    firstTriggerMarketCap: num(value(row, "first_trigger_mc")),
    athMarketCap: num(value(row, "ath", "history_highest_market_cap")),
    liquidity: num(value(row, "liquidity", "liquidity_usd")),
    holderCount: Math.trunc(num(value(row, "holder_count"))),
    top10Rate: nullableNum(value(row, "top_10_holder_rate")),
    rugRatio: nullableNum(value(row, "rug_ratio")),
    washTrading: Boolean(value(row, "is_wash_trading")),
  };
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchIdentityBuySignals(chain: Chain): Promise<{ signals: Signal[]; diagnostic: IdentityTradeDiagnostic }> {
  const warnings: string[] = [];
  let smartRows: Record<string, any>[] = [];
  let kolRows: Record<string, any>[] = [];

  try {
    smartRows = await requestFeed("/v1/user/smartmoney", chain);
  } catch (error) {
    warnings.push(`SmartMoney: ${error instanceof Error ? error.message : String(error)}`);
  }

  await pause(250);

  try {
    kolRows = await requestFeed("/v1/user/kol", chain);
  } catch (error) {
    warnings.push(`KOL: ${error instanceof Error ? error.message : String(error)}`);
  }

  const smartSignals = smartRows.map(row => tradeToSignal(chain, row, 12)).filter((row): row is Signal => row !== null);
  const kolSignals = kolRows.map(row => tradeToSignal(chain, row, 20)).filter((row): row is Signal => row !== null);
  const merged = new Map<string, Signal>();
  for (const signal of [...smartSignals, ...kolSignals]) merged.set(signal.id, signal);

  return {
    signals: [...merged.values()].sort((a, b) => b.triggerEpoch - a.triggerEpoch),
    diagnostic: {
      smartRawRows: smartRows.length,
      smartBuyRows: smartSignals.length,
      kolRawRows: kolRows.length,
      kolBuyRows: kolSignals.length,
      warnings,
    },
  };
}
