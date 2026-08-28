import type { Chain, KlineCandle } from "@/lib/types";

const DEX_CHAIN: Record<Chain, string> = { sol: "solana", bsc: "bsc", robinhood: "robinhood" };
const GT_NETWORK: Record<Chain, string> = { sol: "solana", bsc: "bsc", robinhood: "robinhood" };

function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function arr(value: unknown): any[] { return Array.isArray(value) ? value : []; }
function obj(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function sameAddress(chain: Chain, a: unknown, b: string) {
  const left = String(a || "");
  return chain === "sol" ? left === b : left.toLowerCase() === b.toLowerCase();
}

export type PublicTokenMarket = {
  pairAddress: string;
  dexId: string;
  symbol: string;
  name: string;
  price: number;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  change5m: number;
  buys5m: number;
  sells5m: number;
  website: string;
  twitter: string;
  telegram: string;
  imageUrl: string;
  pairUrl: string;
};

export async function fetchPublicTokenMarket(chain: Chain, address: string): Promise<PublicTokenMarket | null> {
  const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/${DEX_CHAIN[chain]}/${encodeURIComponent(address)}`, {
    next: { revalidate: 15 },
    headers: { Accept: "application/json", "User-Agent": "MemeToGo/0.2" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`DEX Screener HTTP ${response.status}`);
  const pairs = arr(await response.json()).filter(pair => pair && typeof pair === "object");
  if (!pairs.length) return null;
  pairs.sort((a, b) => num(b?.liquidity?.usd) - num(a?.liquidity?.usd));
  const preferred = pairs.find(pair => sameAddress(chain, pair?.baseToken?.address, address)) || pairs[0];
  const info = obj(preferred.info);
  const websites = arr(info.websites);
  const socials = arr(info.socials);
  const social = (platform: string) => String(socials.find(item => String(item?.platform || "").toLowerCase() === platform)?.handle || "");
  return {
    pairAddress: String(preferred.pairAddress || ""),
    dexId: String(preferred.dexId || ""),
    symbol: String(preferred.baseToken?.symbol || preferred.quoteToken?.symbol || "UNKNOWN"),
    name: String(preferred.baseToken?.name || preferred.quoteToken?.name || "UNKNOWN"),
    price: num(preferred.priceUsd),
    marketCap: num(preferred.marketCap ?? preferred.fdv),
    liquidity: num(preferred.liquidity?.usd),
    volume24h: num(preferred.volume?.h24),
    change5m: num(preferred.priceChange?.m5),
    buys5m: num(preferred.txns?.m5?.buys),
    sells5m: num(preferred.txns?.m5?.sells),
    website: String(websites[0]?.url || ""),
    twitter: social("twitter") || social("x"),
    telegram: social("telegram"),
    imageUrl: String(info.imageUrl || ""),
    pairUrl: String(preferred.url || ""),
  };
}

export async function fetchPublicKline(chain: Chain, address: string, pairAddress: string): Promise<KlineCandle[]> {
  if (!pairAddress) return [];
  const url = new URL(`https://api.geckoterminal.com/api/v2/networks/${GT_NETWORK[chain]}/pools/${encodeURIComponent(pairAddress)}/ohlcv/minute`);
  url.searchParams.set("aggregate", "5");
  url.searchParams.set("limit", "288");
  url.searchParams.set("currency", "usd");
  url.searchParams.set("token", address);
  const response = await fetch(url, {
    next: { revalidate: 30 },
    headers: { Accept: "application/json;version=20230203", "User-Agent": "MemeToGo/0.2" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`GeckoTerminal HTTP ${response.status}`);
  const payload = obj(await response.json());
  const rows = arr(obj(obj(payload.data).attributes).ohlcv_list);
  return rows.map(item => {
    const row = arr(item);
    return {
      time: num(row[0]),
      open: num(row[1]),
      high: num(row[2]),
      low: num(row[3]),
      close: num(row[4]),
      volume: num(row[5]),
    };
  }).filter(candle => candle.time && candle.open && candle.high && candle.low && candle.close)
    .sort((a, b) => a.time - b.time)
    .slice(-288);
}
