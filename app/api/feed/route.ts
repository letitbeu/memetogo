import { NextResponse } from "next/server";
import { fetchRank, fetchSignals, MIN_MARKET_CAP, SIGNAL_CHAINS } from "@/lib/gmgn";
import { buildAlphaProjects } from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let memoryCache: { at: number; payload: unknown } | null = null;
const CACHE_MS = 12_000;

export async function GET() {
  const now = Date.now();
  if (memoryCache && now - memoryCache.at < CACHE_MS) return NextResponse.json(memoryCache.payload);
  try {
    const results = await Promise.all(SIGNAL_CHAINS.map(async chain => {
      const [signalsResult, rankResult] = await Promise.allSettled([fetchSignals(chain), fetchRank(chain)]);
      return {
        chain,
        signals: signalsResult.status === "fulfilled" ? signalsResult.value : [],
        ranks: rankResult.status === "fulfilled" ? rankResult.value : [],
        errors: [signalsResult, rankResult].filter(r => r.status === "rejected").map(r => r.status === "rejected" ? r.reason?.message || String(r.reason) : ""),
      };
    }));
    const signals = results.flatMap(r => r.signals);
    const ranks = results.flatMap(r => r.ranks);
    const projects = buildAlphaProjects(signals, ranks);
    const payload = {
      generatedAt: new Date().toISOString(),
      hardGate: { minMarketCap: MIN_MARKET_CAP, requires: "smart_money_buy OR kol_buy", enabled: true },
      projects,
      diagnostics: results.map(r => ({ chain: r.chain, signalCount: r.signals.length, rankCount: r.ranks.length, errors: r.errors })),
    };
    memoryCache = { at: now, payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), projects: [] }, { status: 500 });
  }
}
