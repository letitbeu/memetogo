# MemeToGo — Smart Money / KOL First Alpha Radar

MemeToGo is a standalone GMGN on-chain Alpha discovery dashboard. Its scoring logic is derived from the P0/P0+ research framework originally developed in `letitbeu/Newsalert`, but the runtime architecture is now fully independent.

> **MemeToGo uses its own `GMGN_API_KEY`. It does not read Newsalert data, state, scheduler or API quota.**

The product rule is intentionally stricter than a generic trending board:

> **A token is not listed unless its current market cap is at least $1,000,000 AND GMGN reports a recent Smart Money buy or KOL buy signal.**

Price spikes, volume bursts and market-cap breakouts are secondary evidence. They can improve a token's score, but can never bypass the identity-money gate.

## What v0.2 implements

- Rolling Alpha project feed; browser refresh remains 15 seconds.
- Independent GMGN collector snapshot cached server-side for 60 seconds to protect the dedicated MemeToGo key from burst-rate limits.
- GMGN calls are paced sequentially across `sol`, `bsc`, and `robinhood` instead of firing six requests simultaneously.
- Hard gate: `market cap >= $1M` and `Smart Money buy (type 12) OR KOL buy (type 20)`.
- GMGN 5-minute volume rank merged into every project when available.
- Smart Money/KOL signals dominate the Alpha score.
- Original P0 logic retained as strength features:
  - $5M market-cap breakout proxy.
  - 5m volume momentum.
  - Smart Money resonance.
  - GMGN large-buy / multi-large-buy native P0 context.
  - Buy-pressure confirmation.
- Existing risk rules remain visible and reduce the score instead of being hidden.
- Click any project for:
  - 24h / 5m candlestick chart via GeckoTerminal.
  - DEX market data via DEX Screener.
  - Smart Money/KOL signal summary from MemeToGo's own GMGN collector.
  - P0 and P0+ wealth-effect verification.
  - GMGN Top Trader PnL table, cached for 5 minutes per token.
  - Contract / concentration / rug / bundler / insider risk context.
  - Evidence-constrained meme culture research with optional DeepSeek synthesis.
- Browser-side rolling history (12h / 120 tokens).

## P0+ adaptation

The P0+ wealth engine keeps the original profit/ROI and safety thresholds, with the **market-cap floor deliberately lowered from $10M to $1M** for this early-Alpha product. Liquidity floor remains $100k.

The detail page verifies:

- realized wealth: cost >= $2k, sold >= $20k, then one of `+$50k & >=5x`, `+$150k & >=3x`, `+$500k & >=2x`;
- paper wealth: `unrealized >= $250k & >=10x`, or `total >= $500k & >=3x`, or `current value >= $500k with cost <= $50k and >=10x`;
- multi-wallet wealth: at least two qualifying wallets, aggregate profit >= $500k and aggregate ROI >= 3x;
- safety: no wash trading/honeypot, Top10 <= 50%, rug/bundler/insider <= 30%.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Required:

```text
GMGN_API_KEY=...
```

Optional:

```text
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-chat
```

Without DeepSeek, the dashboard still works. The culture module falls back to a conservative checklist and explicitly says when origin evidence is not available rather than hallucinating a meme story.

## Deploy to Vercel

Import this repository into Vercel, add MemeToGo's own `GMGN_API_KEY` and optionally `DEEPSEEK_API_KEY`, then deploy. No Newsalert environment variable or endpoint is required.

## Current chain scope

The identity-buy gate uses GMGN token-signal coverage for `sol`, `bsc`, and `robinhood`. Holdings alone are not treated as buys.

## Architecture

```text
MemeToGo dedicated GMGN_API_KEY
          |
          v
Independent 60s server cache
          |
          +---- paced token_signal requests
          +---- paced 5m rank requests
          |
          v
$1M + Smart/KOL HARD GATE  <---- cannot be bypassed
          |
          +------ GMGN 5m rank / microstructure
          |             |
          |             +-- volume / buys-sells / liquidity / holder quality
          |             +-- smart_degen_count / renowned_count
          |             +-- rug / concentration / bundler / insider
          v
     Alpha Score
          |
          v
 Rolling Project Feed ----click----> Token Detail
                                  |-> DEX Screener market data
                                  |-> GeckoTerminal Kline
                                  |-> GMGN Top Traders (5m cache)
                                  |-> P0/P0+ wealth
                                  |-> DeepSeek meme culture
                                  |-> Risk radar
```

See `docs/ALPHA_MODEL.md` for the scoring model and next expansion priorities.

## Important limitation of v0.2

The Alpha event history is still browser-local. The server-side GMGN cache protects API quota but is not yet a durable institutional signal archive. The next production milestone should persist every identity-buy event and forward return to Postgres/Supabase/Neon and calibrate the score with real outcomes.

This is a research tool, not investment advice or an automated trading system.
