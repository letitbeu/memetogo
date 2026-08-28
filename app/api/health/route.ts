import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: Boolean(process.env.GMGN_API_KEY),
    gmgnConfigured: Boolean(process.env.GMGN_API_KEY),
    deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
    mode: "smart-kol-first",
    minMarketCap: 1_000_000,
  });
}
