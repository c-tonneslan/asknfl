# asknfl

Ask a question in plain English about the 2020&ndash;2025 NFL seasons. Llama 3.3 (via Groq's free API) writes the DuckDB SQL, DuckDB-WASM runs it in your browser against ~295,000 plays from [nflverse-data](https://github.com/nflverse/nflverse-data). No server-side database, no Postgres, no warehouse, the data ships as a ~16 MB parquet, the SQL runs locally on your machine.

Live demo: [asknfl.vercel.app](https://asknfl.vercel.app)

## What's in here

```
src/
  app/
    api/sql/route.ts        Server route: question + schema to SQL via the LLM
    api/summarize/route.ts  Server route: results to a headline + follow-ups
    page.tsx                The Ask view (text-to-SQL) + DuckDB-WASM client
    dashboards/page.tsx     Curated analytics dashboards
  components/
    charts.tsx              Dependency-free SVG charts (bar/line/scatter/KPI)
    SiteNav.tsx             Ask / Dashboards nav
  lib/
    schema.ts               Trimmed nflfastR schema (54 cols) used in the prompt
    duckdb.ts               Browser DuckDB loader + query runner
    llm.ts                  Provider-agnostic LLM client (Groq by default)
    dashboards.ts           Dashboard + panel definitions (fixed SQL)
    format.ts               Formatting + chart-shape detection
    sql-validate.ts         Guards the generated SQL (single read-only SELECT)
    rate-limit.ts           Best-effort per-IP limit on the LLM endpoints
    examples.ts             The buttons on the landing page
scripts/
  build_pbp.py              Rebuilds the parquet from nflverse season releases
public/
  pbp.parquet               2020-2025 play-by-play (~16 MB, ZSTD, one row per play)
```

## How it works

1. You type a question (or click an example).
2. The server route (`/api/sql`) sends your question + the table schema to Llama 3.3 70B on [Groq](https://groq.com)'s free tier, through a thin provider-agnostic wrapper (`lib/llm.ts`) that speaks the OpenAI chat API — so swapping to Gemini, Together, a local vLLM, or back to a paid model is a one-file change.
3. The model returns one `SELECT` statement. The route strips fences and trailing semicolons, then `sql-validate.ts` confirms it's a single read-only SELECT before it reaches the browser (DuckDB-WASM has `httpfs`, so an unchecked `read_parquet('http://...')` would be a client-side exfiltration vector).
4. The browser hands the SQL to DuckDB-WASM, which runs it directly against the parquet at `/pbp.parquet`. First query also pays for the parquet download (~16 MB) and the WASM bundle; after that every query is local.
5. The answer leads: `/api/summarize` turns the rows into a one-sentence headline plus a few clickable follow-up questions. A single number renders big, a ranking renders as team-colored bars, and everything is backed by a results table. The generated SQL sits in a collapsible drawer where you can edit it and re-run it locally.

The point is that there's no backend query path. After the SQL comes back, your laptop is the database.

## Why this is the right shape

- **Free to host.** Vercel free tier + a static parquet + Groq's free inference tier. No paid API in the path.
- **Fast.** DuckDB-WASM does the ~295k-row aggregations in a few hundred ms, on par with a warm Postgres on the same dataset.
- **Inspectable.** The generated SQL is shown next to the results. You can copy it and run it yourself, or open the browser dev tools and read the query plan.
- **Reproducible.** No "trust me, the model said so" answers, every number on screen comes from a SQL query you can read.
- **Shareable.** Each question is reflected in the URL (`?q=...`), so any answer is a link you can send or bookmark; opening it re-runs the query.

## Two ways in

- **Ask** (`/`) — the open-ended text-to-SQL view. Results render answer-first: a one-sentence headline, then the right visual for the shape (a big number, team-colored ranking bars, a season trend line, or a scatter), then the table, with the editable SQL tucked below.
- **Dashboards** (`/dashboards`) — curated analytics: *Season Leaderboards*, *Team Profile*, and *League Trends*. Every panel is a fixed, hand-written SQL query run locally in DuckDB-WASM, so these are deterministic, instant, and cost nothing (no model in the loop). See [src/lib/dashboards.ts](src/lib/dashboards.ts).

Both share one **dependency-free chart layer** ([src/components/charts.tsx](src/components/charts.tsx)) — bar / line / scatter / KPI tiles as inline SVG, auto-selected from the result shape by [src/lib/format.ts](src/lib/format.ts). No charting library: small bundle, CSP-safe. The DuckDB instance is a module singleton, so navigating between the two tabs reuses the same loaded parquet.

## Schema

The full nflfastR pbp has 372 columns. I trimmed to 54 that cover the questions people actually ask: season, down/distance, posteam/defteam, EPA/CPOE/WPA, player names, play type, penalty, score state. See [src/lib/schema.ts](src/lib/schema.ts). The nflfastR flag columns (touchdown, sack, ...) ship as 0/1 doubles; they're cast to real booleans on load so the schema the model sees is honest.

## Prompt engineering notes

The system prompt encodes the conventions that turn vague football questions into precise SQL:

- "Red zone" = `yardline_100 <= 20`
- "Long" 3rd down = `down = 3 AND ydstogo >= 7`
- "Garbage time" = `abs(score_differential) >= 17 in qtr 4`
- "Scoring play" = `touchdown OR field_goal_result = 'made' OR ...`

Without these, every other question turns into a 20-line conditional. With them, the model reaches for the obvious aggregate.

The few-shot block has three examples that show: a top-N with grouping, a single-row aggregate, and a head-to-head filter. Three was enough to anchor the output style; more started costing tokens without changing the answer.

## Local development

```bash
npm install
cp .env.example .env.local
# Add your free Groq API key (https://console.groq.com/keys) to .env.local
npm run dev
```

The dev server runs at http://localhost:3000.

## Deploy

This is a one-click Vercel deploy. The only required env var is `GROQ_API_KEY` (free from [console.groq.com](https://console.groq.com/keys)). Optionally set `LLM_BASE_URL` / `LLM_MODEL` to use a different OpenAI-compatible provider.

## Caveats

- The data is the **regular and post-season, 2020 through 2025**. Anything outside that window is out of scope, and the model is told so; when you don't name a season it defaults to the latest (2025). Rebuild/extend the window with `python3 scripts/build_pbp.py <years…>`.
- The model can still write a bad query if your question is ambiguous; it tries the most charitable read.
- DuckDB-WASM is heavy on first load (~6 MB of WASM + ~16 MB of parquet). After that, queries are local.
- No multi-turn yet. Each question starts fresh (though you can hand-edit the SQL and re-run it).

## What's next

- Eval set: 30 questions with gold SQL + tolerance bands on the numbers, so I can measure prompt regressions.
- 2024 data once it's stable on nflverse.
- Genuine multi-turn: thread the previous question and result into the next SQL prompt.

## License

MIT.
