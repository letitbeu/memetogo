import { NextRequest, NextResponse } from "next/server";
import { MIN_MARKET_CAP, SIGNAL_CHAINS } from "@/lib/gmgn";
import { fetchIndependentSnapshot, fetchIndependentTokenInfo, fetchIndependentTopTraders, tokenContext } from "@/lib/gmgn_independent";
import { researchCulture } from "@/lib/culture";
import { fetchPublicKline, fetchPublicTokenMarket } from "@/lib/marketdata";
import { evaluateP0Plus } from "@/lib/wealth";
import { estimateMarkedBivariateHawkes } from "@/lib/hawkes";
import type { AlphaProject, Chain, KlineCandle, Trader } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DETAIL_CACHE_MS = 60_000;
const MAX_DETAIL_CACHE = 64;

type DetailPayload = Record<string, unknown>;
const detailCache = new Map<string, { at: number; payload: DetailPayload }>();
const detailInFlight = new Map<string, Promise<DetailPayload>>();

function validAddress(chain: Chain, address: string) {
  if (chain === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  if (chain === "bsc") return /^0x[a-fA-F0-9]{40}$/.test(address);
  return address.length >= 8 && address.length <= 128 && !/[\s/?#]/.test(address);
}

function xUrl(value: string) {
  const text = value.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  return `https://x.com/${text.replace(/^@/, "")}`;
}

function high(value: number | null, threshold: number) {
  return value != null && value > threshold;
}

function pruneDetailCache(now = Date.now()) {
  for (const [key, row] of detailCache) {
    if (now - row.at > DETAIL_CACHE_MS * 3) detailCache.delete(key);
  }
  while (detailCache.size > MAX_DETAIL_CACHE) {
    const oldest = detailCache.keys().next().value as string | undefined;
    if (!oldest) break;
    detailCache.delete(oldest);
  }
}

async function buildDetail(chain: Chain, address: string): Promise<DetailPayload> {
  const snapshot = await fetchIndependentSnapshot();
  const { rank, signals } = tokenContext(snapshot, chain, address);
  const newest = signals[0] || null;
  const diagnostics: string[] = [];

  const chainDiagnostic = snapshot.diagnostics.find(row => row.chain === chain);
  if (chainDiagnostic?.errors.length) diagnostics.push(...chainDiagnostic.errors.map(error => `GMGN ${error}`));

  const [gmgnInfo, market] = await Promise.all([
    rank
      ? Promise.resolve(null)
      : fetchIndependentTokenInfo(chain, address).catch(error => {
          diagnostics.push(`GMGN Token Info: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }),
    fetchPublicTokenMarket(chain, address).catch(error => {
      diagnostics.push(`DEX Screener: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }),
  ]);

  const info = {
    chain,
    address,
    symbol: rank?.symbol || newest?.symbol || gmgnInfo?.symbol || market?.symbol || "UNKNOWN",
    name: rank?.name || newest?.name || gmgnInfo?.name || market?.name || "UNKNOWN",
    price: market?.price || rank?.price || gmgnInfo?.price || 0,
    marketCap: market?.marketCap || rank?.marketCap || newest?.marketCap || gmgnInfo?.marketCap || 0,
    liquidity: market?.liquidity || rank?.liquidity || newest?.liquidity || gmgnInfo?.liquidity || 0,
    holders: rank?.holders || newest?.holderCount || gmgnInfo?.holders || 0,
    smartCount: rank?.smartCount || 0,
    kolCount: rank?.kolCount || 0,
    top10Rate: rank?.top10Rate ?? newest?.top10Rate ?? gmgnInfo?.top10Rate ?? null,
    rugRatio: rank?.rugRatio ?? newest?.rugRatio ?? gmgnInfo?.rugRatio ?? null,
    bundlerRate: rank?.bundlerRate ?? gmgnInfo?.bundlerRate ?? null,
    insiderRate: rank?.insiderRate ?? gmgnInfo?.insiderRate ?? null,
    washTrading: rank?.washTrading || newest?.washTrading || gmgnInfo?.washTrading || false,
    isHoneypot: gmgnInfo?.isHoneypot || false,
    launchpad: rank?.launchpad || gmgnInfo?.launchpad || market?.dexId || "",
    twitter: xUrl(market?.twitter || gmgnInfo?.twitter || ""),
    website: market?.website || gmgnInfo?.website || "",
    telegram: market?.telegram || gmgnInfo?.telegram || "",
    description: gmgnInfo?.description || "",
    imageUrl: market?.imageUrl || "",
    pairUrl: market?.pairUrl || "",
    volume24h: market?.volume24h || 0,
  };

  const candlesPromise: Promise<KlineCandle[]> = market?.pairAddress
    ? fetchPublicKline(chain, address, market.pairAddress).catch(error => {
        diagnostics.push(`GeckoTerminal K线: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      })
    : Promise.resolve([]);
  if (!market?.pairAddress) diagnostics.push("未找到可用于K线的主交易池");

  const tradersPromise: Promise<Trader[]> = fetchIndependentTopTraders(chain, address).catch(error => {
    diagnostics.push(`GMGN Top Traders: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  });

  // Culture research is independent from Kline/Top Traders once token metadata is known.
  // Running these in parallel cuts detail latency and prevents rapid switching from stacking serial work.
  const [candles, traders, culture] = await Promise.all([
    candlesPromise,
    tradersPromise,
    researchCulture(info),
  ]);

  const riskToken = {
    marketCap: info.marketCap,
    liquidity: info.liquidity,
    washTrading: info.washTrading,
    isHoneypot: info.isHoneypot,
    top10Rate: info.top10Rate,
    rugRatio: info.rugRatio,
    bundlerRate: info.bundlerRate,
    insiderRate: info.insiderRate,
  };
  const wealth = evaluateP0Plus(riskToken, traders);
  const smartBuySignals = signals.filter(signal => signal.signalType === 12).length;
  const kolBuySignals = signals.filter(signal => signal.signalType === 20).length;
  const identityEligible = smartBuySignals > 0 || kolBuySignals > 0;
  const marketCapEligible = info.marketCap >= MIN_MARKET_CAP;
  const gateEligible = identityEligible && marketCapEligible;
  const hawkes = estimateMarkedBivariateHawkes(signals);

  const risks: string[] = [];
  if (info.washTrading) risks.push("疑似刷量");
  if (info.isHoneypot) risks.push("疑似蜜罐");
  if (high(info.rugRatio, .3)) risks.push(`Rug风险 ${(info.rugRatio! * 100).toFixed(0)}%`);
  if (high(info.top10Rate, .5)) risks.push(`Top10持仓 ${(info.top10Rate! * 100).toFixed(0)}%`);
  if (high(info.bundlerRate, .3)) risks.push(`Bundler ${(info.bundlerRate! * 100).toFixed(0)}%`);
  if (high(info.insiderRate, .3)) risks.push(`内幕地址 ${(info.insiderRate! * 100).toFixed(0)}%`);
  if (info.liquidity > 0 && info.liquidity < 100_000) risks.push("流动性低于10万美元");

  const p0Reasons: string[] = [];
  const safe = !info.washTrading && !info.isHoneypot && !high(info.rugRatio, .3) && !high(info.top10Rate, .5) && !high(info.bundlerRate, .3) && !high(info.insiderRate, .3);
  if (rank && rank.smartCount >= 3 && rank.rank <= 30 && rank.volume5m >= 100_000 && rank.liquidity >= 50_000 && safe) p0Reasons.push("聪明钱共振（P0）");
  if (rank && rank.rank <= 10 && rank.volume5m >= 500_000 && rank.change5m >= 20) p0Reasons.push("爆量拉升（P0）");
  if (rank && rank.rank <= 15 && rank.volume5m >= 250_000 && rank.buys5m >= 30 && rank.buys5m >= 2 * Math.max(rank.sells5m, 1) && rank.change5m >= 5) p0Reasons.push("5分钟买压显著（P0）");

  const thesis: string[] = [];
  if (smartBuySignals) thesis.push(`当前采集窗口SM买入 ${smartBuySignals}笔`);
  if (kolBuySignals) thesis.push(`当前采集窗口KOL买入 ${kolBuySignals}笔`);
  if (rank?.smartCount) thesis.push(`当前SM持仓 ${rank.smartCount}钱包`);
  if (rank?.kolCount) thesis.push(`当前KOL持仓 ${rank.kolCount}钱包`);
  thesis.push(gateEligible ? "当前满足MemeToGo榜单硬门槛" : "主动分析：未必满足榜单硬门槛");

  const explorerProject: AlphaProject = {
    chain,
    address,
    symbol: info.symbol,
    name: info.name,
    rank: rank?.rank || 999,
    price: info.price,
    marketCap: info.marketCap,
    athMarketCap: rank?.athMarketCap || newest?.athMarketCap || 0,
    liquidity: info.liquidity,
    volume5m: rank?.volume5m || 0,
    change5m: rank?.change5m || 0,
    buys5m: rank?.buys5m || 0,
    sells5m: rank?.sells5m || 0,
    holders: info.holders,
    smartCount: info.smartCount,
    kolCount: info.kolCount,
    top10Rate: info.top10Rate,
    rugRatio: info.rugRatio,
    bundlerRate: info.bundlerRate,
    insiderRate: info.insiderRate,
    washTrading: info.washTrading,
    launchpad: info.launchpad,
    key: `explorer:${chain}:${address.toLowerCase()}`,
    smartBuySignals,
    kolBuySignals,
    contextSignals: [...new Set(signals.map(signal => signal.signalType))].sort((a, b) => a - b),
    latestSignalAt: newest?.triggerAt || new Date().toISOString(),
    latestSignalEpoch: newest?.triggerEpoch || Date.now() / 1000,
    score: 0,
    grade: "B",
    legacyP0: p0Reasons.length > 0,
    legacyP0Reasons: p0Reasons,
    thesis,
    risks,
    hawkes,
  };

  return {
    generatedAt: new Date().toISOString(),
    info,
    rank,
    explorerProject,
    gate: {
      eligible: gateEligible,
      marketCapEligible,
      identityEligible,
      minMarketCap: MIN_MARKET_CAP,
      note: identityEligible ? "当前MemeToGo身份资金采集窗口已捕捉到该项目BUY" : "当前MemeToGo身份资金采集窗口未捕捉到Smart Money/KOL BUY；不代表历史上从未发生",
    },
    p0: { confirmed: p0Reasons.length > 0, reasons: p0Reasons },
    hawkes,
    candles,
    traders: traders.slice(0, 12),
    signals: signals.slice(0, 24),
    smartBuySignals,
    kolBuySignals,
    p0Plus: wealth,
    culture,
    dataSource: {
      identityFlow: "GMGN via MemeToGo independent collector",
      tokenInfo: rank ? "GMGN 5m rank snapshot" : "GMGN token info via MemeToGo key, 5m cached",
      market: "DEX Screener",
      kline: "GeckoTerminal 5m OHLCV",
      topTraders: "GMGN via MemeToGo key, 5m cached",
      minMarketCap: MIN_MARKET_CAP,
    },
    diagnostics,
    links: {
      gmgn: `https://gmgn.ai/${chain}/token/${address}`,
      dex: market?.pairUrl || null,
    },
  };
}

export async function GET(request: NextRequest) {
  const chain = String(request.nextUrl.searchParams.get("chain") || "").toLowerCase() as Chain;
  const address = String(request.nextUrl.searchParams.get("address") || "").trim();
  if (!SIGNAL_CHAINS.includes(chain) || !validAddress(chain, address)) {
    return NextResponse.json({ error: "chain/address 参数无效" }, { status: 400 });
  }

  const cacheKey = `${chain}:${address.toLowerCase()}`;
  const now = Date.now();
  pruneDetailCache(now);
  const cached = detailCache.get(cacheKey);
  if (cached && now - cached.at < DETAIL_CACHE_MS) {
    return NextResponse.json(cached.payload, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300", "X-MemeToGo-Detail": "memory-hit" },
    });
  }

  try {
    let promise = detailInFlight.get(cacheKey);
    if (!promise) {
      promise = buildDetail(chain, address)
        .then(payload => {
          detailCache.delete(cacheKey);
          detailCache.set(cacheKey, { at: Date.now(), payload });
          return payload;
        })
        .finally(() => detailInFlight.delete(cacheKey));
      detailInFlight.set(cacheKey, promise);
    }

    const payload = await promise;
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300", "X-MemeToGo-Detail": "fresh-or-deduped" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
