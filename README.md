# MemeToGo — Smart Money / KOL First Alpha Radar

MemeToGo is a standalone GMGN on-chain Alpha discovery dashboard extracted from the GMGN alert logic in `letitbeu/Newsalert`.

The product rule is intentionally stricter than a generic trending board:

> **A token is not listed unless its current market cap is at least $1,000,000 AND GMGN reports a recent Smart Money buy or KOL buy signal.**

Price spikes, volume bursts and market-cap breakouts are secondary evidence. They can improve a token's score, but can never bypass the identity-money gate.

## What v0.1 implements

- Rolling Alpha project feed, refreshed every 15 seconds.
- Hard gate: `market cap >= $1M` and `Smart Money buy (type 12) OR KOL buy (type 20)`.
- GMGN 5-minute volume rank merged into every project when available.
- Smart Money/KOL signals dominate the Alpha score.
- Newsalert P0 logic retained as strength features:
  - $5M market-cap breakout proxy.
  - 5m volume momentum.
  - Smart Money resonance.
  - GMGN large-buy / multi-large-buy native P0 context.
  - Buy-pressure confirmation.
- Existing risk rules remain visible and reduce the score instead of being hidden.
- Click any project for:
  - 24h / 5m meme candlestick chart via GMGN K-line.
  - Smart Money/KOL signal summary.
  - Newsalert P0 and P0+ wealth-effect verification.
  - Top trader PnL table.
  - Contract / concentration / rug / bundler / insider risk context.
  - Evidence-constrained meme culture research; optional DeepSeek synthesis.
- Browser-side rolling history (12h / 120 tokens) so the feed remains useful across upstream snapshots.

## P0+ adaptation

The P0+ wealth engine keeps the Newsalert profit/ROI and safety thresholds, with the **market-cap floor deliberately lowered from $10M to $1M** for this early-Alpha product. Liquidity floor remains $100k.

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

Import this repository into Vercel, add `GMGN_API_KEY` (and optionally `DEEPSEEK_API_KEY`) in Environment Variables, then deploy. The app uses Next.js Route Handlers and Node.js runtime.

## Current chain scope

The identity-buy gate uses GMGN token-signal coverage for `sol`, `bsc`, and `robinhood`. This is deliberate: Base/ETH should not be added to the visible feed until we have an equally reliable *recent Smart Money/KOL buy* source. Holdings alone are not treated as buys.

## Architecture

```text
GMGN token_signal (identity buys)
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
                                  |-> Kline
                                  |-> P0/P0+ wealth
                                  |-> Top traders
                                  |-> Meme culture
                                  |-> Risk radar
```

See `docs/ALPHA_MODEL.md` for the scoring model and next expansion priorities.

## Important limitation of v0.1

The server is stateless. Rolling history is persisted in browser `localStorage`; therefore v0.1 is excellent for an always-open research terminal, but not yet a durable institutional signal archive. The next production milestone should persist every identity-buy event and forward return to Postgres/Supabase/Neon and calibrate the score with real outcomes.

This is a research tool, not investment advice or an automated trading system.
