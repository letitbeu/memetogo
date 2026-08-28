import { NextRequest, NextResponse } from "next/server";
import { MIN_MARKET_CAP, SIGNAL_CHAINS } from "@/lib/gmgn";
import { researchCulture } from "@/lib/culture";
import { fetchPublicKline, fetchPublicTokenMarket } from "@/lib/marketdata";
import { fetchNewsalertSnapshot, tokenContext } from "@/lib/newsalert";
import { evaluateP0Plus } from "@/lib/wealth";
import type { Chain } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(request: NextRequest) {
  const chain = String(request.nextUrl.searchParams.get("chain") || "").toLowerCase() as Chain;
  const address = String(request.nextUrl.searchParams.get("address") || "").trim();
  if (!SIGNAL_CHAINS.includes(chain) || !validAddress(chain, address)) return NextResponse.json({ error: "chain/address 参数无效" }, { status: 400 });

  try {
    const snapshot = await fetchNewsalertSnapshot();
    const { rank, signals } = tokenContext(snapshot, chain, address);
    const newest = signals[0] || null;
    const diagnostics: string[] = [];

    let market = null;
    try {
      market = await fetchPublicTokenMarket(chain, address);
    } catch (error) {
      diagnostics.push(`DEX Screener: ${error instanceof Error ? error.message : String(error)}`);
    }

    let candles = [];
    if (market?.pairAddress) {
      try {
        candles = await fetchPublicKline(chain, address, market.pairAddress);
      } catch (error) {
        diagnostics.push(`GeckoTerminal K线: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      diagnostics.push("未找到可用于K线的主交易池");
    }

    const info = {
      chain,
      address,
      symbol: rank?.symbol || newest?.symbol || market?.symbol || "UNKNOWN",
      name: rank?.name || newest?.name || market?.name || "UNKNOWN",
      price: market?.price || rank?.price || 0,
      marketCap: market?.marketCap || rank?.marketCap || newest?.marketCap || 0,
      liquidity: market?.liquidity || rank?.liquidity || newest?.liquidity || 0,
      holders: rank?.holders || newest?.holderCount || 0,
      top10Rate: rank?.top10Rate ?? newest?.top10Rate ?? null,
      rugRatio: rank?.rugRatio ?? newest?.rugRatio ?? null,
      bundlerRate: rank?.bundlerRate ?? null,
      insiderRate: rank?.insiderRate ?? null,
      washTrading: rank?.washTrading || newest?.washTrading || false,
      isHoneypot: false,
      launchpad: rank?.launchpad || market?.dexId || "",
      twitter: xUrl(market?.twitter || ""),
      website: market?.website || "",
      telegram: market?.telegram || "",
      description: "",
      imageUrl: market?.imageUrl || "",
      pairUrl: market?.pairUrl || "",
      volume24h: market?.volume24h || 0,
    };

    const culture = await researchCulture(info);
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
    const traders: [] = [];
    const wealth = evaluateP0Plus(riskToken, traders);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      info,
      rank,
      candles,
      traders,
      signals: signals.slice(0, 24),
      smartBuySignals: signals.filter(signal => signal.signalType === 12).length,
      kolBuySignals: signals.filter(signal => signal.signalType === 20).length,
      p0Plus: {
        ...wealth,
        reason: wealth.confirmed
          ? wealth.reason
          : "P0+ Top-Trader财富效应暂不在详情请求中直连GMGN；避免与Newsalert采集器争抢同一API Key配额。",
      },
      culture,
      dataSource: {
        identityFlow: "GMGN via Newsalert shared collector",
        market: "DEX Screener",
        kline: "GeckoTerminal 5m OHLCV",
        topTraders: "paused_shared_key_protection",
        minMarketCap: MIN_MARKET_CAP,
      },
      diagnostics,
      links: {
        gmgn: `https://gmgn.ai/${chain}/token/${address}`,
        dex: market?.pairUrl || null,
      },
    }, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
