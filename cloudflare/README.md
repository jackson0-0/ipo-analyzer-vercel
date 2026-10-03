# Cloudflare hosting

Production: https://ipo-analyzer.jackson-docqueue.workers.dev

The Worker serves the existing React build and `/api/*`. D1 stores calendar snapshots, SEC analyses, verified issuer identities, financial facts and short-lived filing caches. An hourly Cron Trigger refreshes the past twelve calendar months. Failed refreshes preserve the last successful snapshot and its timestamp.

## Deploy

From this directory (Node 22 or newer):

```sh
npm ci
npm --prefix ../frontend ci
npm test
npx wrangler d1 migrations apply ipo-analyzer --remote
npm run deploy
```

The deploy script builds the frontend with `VITE_API_URL=/api`. Secrets `ANTHROPIC_API_KEY` and `SEC_USER_AGENT` are stored in Cloudflare; never put them in frontend variables or Git. Set or rotate them with `npx wrangler secret put NAME`. Local development can use a gitignored `.dev.vars` file plus `npx wrangler d1 migrations apply ipo-analyzer --local` and `npm run dev` after building the frontend.

API routes: `/api/health`, `/api/calendar?month=YYYY-MM`, `/api/ipos?month=YYYY-MM`, `/api/analyze/COMPANY?ticker=...&amount=...&status=...`.

## Migration and rollback

The initial migration copied all 62 existing PostgreSQL records: 7 legacy analyses, 32 SEC analyses, 12 calendars, 6 issuer identities and 5 reported-fact records. Existing fresher Cloudflare calendar snapshots were retained. The original Python backend is retained for rollback. Neither the Railway services nor the Vercel project was deleted.

The Worker uses a new analysis cache namespace because its text parsing and serialization differ from Python. Existing research is preserved in D1, but an analysis may regenerate once on the new runtime. Repeated requests for identical evidence, IPO details reuse the saved result; changed evidence can regenerate it. A database lease prevents concurrent duplicate AI requests.

Watchlists live in browser localStorage, not PostgreSQL/D1. They remain on the old origin and do not automatically transfer to a different hostname.

Future deployments use the command above; automatic GitHub deployment is not configured. The Vercel hostname belongs to Vercel and cannot be served directly by Cloudflare. Use the Cloudflare URL or add an owned custom domain.

## Validation

`npm test` covers SEC name/path/date validation, hidden-text filtering, exact-accession financial facts, evidence validation, durable calendar caching and stale fallback. Live checks should include fresh calendar data and an SEC analysis, then an identical repeat to confirm cache reuse. `/api/health` confirms Worker and D1 connectivity.

## Research and price refreshes

A separate five-minute Cron Trigger checks one queued IPO at a time across the latest twelve saved months, newest first. Successfully checked companies become due again after 24 hours; source failures retry after six hours. D1 leases prevent duplicate jobs. `BACKGROUND_DAILY_LIMIT=10` caps background Anthropic attempts per UTC day (failed attempts also count). On-demand requests are separate from this background cap. Once saved in `analysis_index`, research is returned immediately with its last-checked timestamp. New or changed filing evidence can generate a new assessment; an unchanged filing no longer regenerates solely because the calendar day changed. An initial backlog fills gradually, not all at once.

Quotes are cached for five minutes, and daily history for one hour. Open pages refresh their quotes every five minutes while visible. Background jobs also rotate through cached calendar tickers for quote warming. Upcoming IPOs show no trading quote. Nasdaq company name and symbol must match before prices are accepted.

The offer price comes from the calendar's `proposedSharePrice` field; it is not the first traded price. Since-IPO changes compare the latest daily close with the offer price. Week and month comparisons use the last available daily close on or before the target date (at most seven days earlier), and only after the IPO date. One day means the preceding trading close, not exactly 24 hours. These are **unadjusted price changes**, not total returns; splits and dividends are not accounted for. Missing prices, ranges, or insufficient history stay unavailable, never zero. Nasdaq quote timestamps and historical daily close dates are shown separately as supplied.

Nasdaq website endpoints are not a guaranteed free redistribution license or supported public API. Confirm permitted market-data usage before a public/commercial launch; the data adapter should be replaced with an appropriately licensed feed if required.

The research view shows the company overview, SEC industry classification, positives, risks, structured financials, and information gaps without disclosure clicks. Only the verbatim supporting excerpts are collapsible. Structured facts still cover a limited set of standard US-GAAP concepts and may be missing even when the full filing contains financial statements.
