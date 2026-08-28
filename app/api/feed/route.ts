import { NextResponse } from "next/server";
import { MIN_MARKET_CAP } from "@/lib/gmgn";
import { fetchNewsalertSnapshot } from "@/lib/newsalert";
import { buildAlphaProjects } from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let memoryCache: { at: number; payload: unknown } | null = null;
const CACHE_MS = 8_000;

export async function GET() {
  const now = Date.now();
  if (memoryCache && now - memoryCache.at < CACHE_MS) return NextResponse.json(memoryCache.payload);
  try {
    const snapshot = await fetchNewsalertSnapshot();
    const projects = buildAlphaProjects(snapshot.signals, snapshot.ranks);
    const signalErrors = snapshot.status.signal_chain_errors && typeof snapshot.status.signal_chain_errors === "object"
      ? snapshot.status.signal_chain_errors as Record<string, string>
      : {};
    const rankErrors = snapshot.status.rank_chain_errors && typeof snapshot.status.rank_chain_errors === "object"
      ? snapshot.status.rank_chain_errors as Record<string, string>
      : {};
    const chains = Array.from(new Set([
      ...snapshot.signals.map(row => row.chain),
      ...snapshot.ranks.map(row => row.chain),
      ...(Array.isArray(snapshot.status.chains) ? snapshot.status.chains.map(String) : []),
    ]));
    const payload = {
      generatedAt: new Date().toISOString(),
      source: {
        mode: "newsalert-shared-collector",
        collectorLastCheckAt: snapshot.status.last_check_at || null,
        collectorLastRankCheckAt: snapshot.status.last_rank_check_at || null,
        healthy: Boolean(snapshot.health.healthy),
        state: snapshot.health.service_state || "unknown",
      },
      hardGate: { minMarketCap: MIN_MARKET_CAP, requires: "smart_money_buy OR kol_buy", enabled: true },
      projects,
      diagnostics: chains.map(chain => ({
        chain,
        signalCount: snapshot.signals.filter(row => row.chain === chain).length,
        rankCount: snapshot.ranks.filter(row => row.chain === chain).length,
        errors: [signalErrors[chain], rankErrors[chain]].filter(Boolean),
      })),
    };
    memoryCache = { at: now, payload };
    return NextResponse.json(payload, { headers: { "Cache-Control": "public, s-maxage=8, stale-while-revalidate=20" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), projects: [] }, { status: 500 });
  }
}
