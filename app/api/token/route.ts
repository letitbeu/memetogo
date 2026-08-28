import { NextRequest, NextResponse } from "next/server";
import { fetchKline, fetchRank, fetchSignals, fetchTokenInfo, fetchTopTraders, SIGNAL_CHAINS } from "@/lib/gmgn";
import { researchCulture } from "@/lib/culture";
import { evaluateP0Plus } from "@/lib/wealth";
import type { Chain } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validAddress(chain: Chain, address: string) {
  if (chain === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  if (chain === "bsc") return /^0x[a-fA-F0-9]{40}$/.test(address);
  return address.length >= 8 && address.length <= 128 && !/[\s/?#]/.test(address);
}

export async function GET(request: NextRequest) {
  const chain = String(request.nextUrl.searchParams.get("chain") || "").toLowerCase() as Chain;
  const address = String(request.nextUrl.searchParams.get("address") || "").trim();
  if (!SIGNAL_CHAINS.includes(chain) || !validAddress(chain, address)) return NextResponse.json({ error: "chain/address 参数无效" }, { status: 400 });
  try {
    const [info, candles, traders, signals, ranks] = await Promise.all([
      fetchTokenInfo(chain, address),
      fetchKline(chain, address, "5m", 24),
      fetchTopTraders(chain, address),
      fetchSignals(chain),
      fetchRank(chain),
    ]);
    const rank = ranks.find(row => row.address.toLowerCase() === address.toLowerCase());
    const tokenSignals = signals.filter(row => row.address.toLowerCase() === address.toLowerCase()).sort((a, b) => b.triggerEpoch - a.triggerEpoch);
    const riskToken = {
      marketCap: info.marketCap || rank?.marketCap || 0,
      liquidity: info.liquidity || rank?.liquidity || 0,
      washTrading: info.washTrading || rank?.washTrading || false,
      isHoneypot: info.isHoneypot,
      top10Rate: info.top10Rate ?? rank?.top10Rate ?? null,
      rugRatio: info.rugRatio ?? rank?.rugRatio ?? null,
      bundlerRate: info.bundlerRate ?? rank?.bundlerRate ?? null,
      insiderRate: info.insiderRate ?? rank?.insiderRate ?? null,
    };
    const [culture] = await Promise.all([researchCulture(info)]);
    const wealth = evaluateP0Plus(riskToken, traders);
    return NextResponse.json({
      generatedAt: new Date().toISOString(), info, rank: rank || null, candles, traders: traders.slice(0, 12), signals: tokenSignals.slice(0, 24),
      smartBuySignals: tokenSignals.filter(s => s.signalType === 12).length,
      kolBuySignals: tokenSignals.filter(s => s.signalType === 20).length,
      p0Plus: wealth,
      culture,
      links: { gmgn: `https://gmgn.ai/${chain}/token/${address}` },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
