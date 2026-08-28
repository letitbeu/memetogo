import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: Boolean(process.env.GMGN_API_KEY),
    gmgnConfigured: Boolean(process.env.GMGN_API_KEY),
    deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
    mode: "smart-kol-first",
    architecture: "memetogo-independent-gmgn-v1",
    gmgnKeyScope: "memetogo-only",
    collectorRefreshSeconds: 60,
    minMarketCap: 1_000_000,
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    vercelEnv: process.env.VERCEL_ENV || null,
  });
}
