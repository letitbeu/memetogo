import { NextResponse } from "next/server";
import { MIN_MARKET_CAP } from "@/lib/gmgn";
import { fetchIndependentSnapshot } from "@/lib/gmgn_independent";
import { buildAlphaProjects } from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let memoryCache: { at: number; payload: unknown } | null = null;
const RESPONSE_CACHE_MS = 8_000;

export async function GET() {
  const now = Date.now();
  if (memoryCache && now - memoryCache.at < RESPONSE_CACHE_MS) return NextResponse.json(memoryCache.payload);

  try {
    const snapshot = await fetchIndependentSnapshot();
    const projects = buildAlphaProjects(snapshot.signals, snapshot.ranks);
    const identityEvents = snapshot.signals
      .filter(signal => signal.signalType === 12 || signal.signalType === 20)
      .map(signal => ({
        id: signal.id,
        chain: signal.chain,
        address: signal.address,
        signalType: signal.signalType,
        triggerEpoch: signal.triggerEpoch,
        tradeUsd: signal.tradeUsd || 0,
        identitySource: signal.identitySource || null,
      }));

    const payload = {
      generatedAt: new Date().toISOString(),
      source: {
        mode: "memetogo-independent-gmgn",
        collectorCapturedAt: snapshot.capturedAt,
        refreshSeconds: 120,
        apiKeyScope: "memetogo-only",
      },
      hardGate: {
        minMarketCap: MIN_MARKET_CAP,
        requires: "smart_money_buy OR kol_buy",
        enabled: true,
      },
      projects,
      identityEvents,
      diagnostics: snapshot.diagnostics,
    };

    memoryCache = { at: now, payload };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=8, stale-while-revalidate=20" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error), projects: [], identityEvents: [] },
      { status: 500 },
    );
  }
}
