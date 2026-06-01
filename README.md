# asknfl

Ask a question in plain English about the 2023 NFL season. Claude writes the DuckDB SQL, DuckDB-WASM runs it in your browser against ~50,000 plays from [nflverse-data](https://github.com/nflverse/nflverse-data). No server-side database, no Postgres, no warehouse, the data ships as a 3 MB parquet, the SQL runs locally on your machine.

Live demo: [asknfl.vercel.app](https://asknfl.vercel.app)

## What's in here

```
src/
  app/
    api/sql/route.ts      Edge function: question + schema to SQL via Claude
    page.tsx              The UI, DuckDB-WASM client
  lib/
    schema.ts             Trimmed nflfastR schema (57 cols) used in the prompt
    duckdb.ts             Browser DuckDB loader + query runner
    examples.ts           The 10 buttons on the landing page
public/
  pbp_2023.parquet        Reduced 2023 play-by-play (3.2 MB, ZSTD)
```

## How it works

1. You type a question (or click an example).
2. The Edge function (`/api/sql`) sends your question + the table schema to Claude Haiku 4.5. The schema and the few-shot block are wrapped in `cache_control` so a warm Vercel region pays one round of token cost per cold start and then it's pennies per query.
3. Claude returns one `SELECT` statement. The route handler strips fences and trailing semicolons.
4. The browser hands the SQL to DuckDB-WASM, which runs it directly against the parquet at `/pbp_2023.parquet`. First query also pays for the parquet download (~3 MB) and the WASM bundle.
5. The results render as a table, with the generated SQL collapsed above it.

The point is that there's no backend query path. After the SQL comes back, your laptop is the database.

## Why this is the right shape

- **Cheap to host.** Vercel free tier + a static parquet. The only real cost is the Anthropic API.
- **Fast.** DuckDB-WASM does the 50k-row aggregations in a few hundred ms, on par with a warm Postgres on the same dataset.
- **Inspectable.** The generated SQL is shown next to the results. You can copy it and run it yourself, or open the browser dev tools and read the query plan.
- **Reproducible.** No "trust me, the model said so" answers, every number on screen comes from a SQL query you can read.

## Schema

The full nflfastR pbp has 372 columns. I trimmed to 57 that cover the questions people actually ask: down/distance, posteam/defteam, EPA/CPOE/WPA, player names, play type, penalty, score state. See [src/lib/schema.ts](src/lib/schema.ts).

## Prompt engineering notes

The system prompt encodes the conventions that turn vague football questions into precise SQL:

- "Red zone" = `yardline_100 <= 20`
- "Long" 3rd down = `down = 3 AND ydstogo >= 7`
- "Garbage time" = `abs(score_differential) >= 17 in qtr 4`
- "Scoring play" = `touchdown OR field_goal_result = 'made' OR ...`

Without these, every other question turns into a 20-line conditional. With them, Claude reaches for the obvious aggregate.

The few-shot block has three examples that show: a top-N with grouping, a single-row aggregate, and a head-to-head filter. Three was enough to anchor the output style; more started costing tokens without changing the answer.

## Local development

```bash
npm install
cp .env.example .env.local
# Add your Anthropic API key to .env.local
npm run dev
```

The dev server runs at http://localhost:3000.

## Deploy

This is a one-click Vercel deploy. The only required env var is `ANTHROPIC_API_KEY`.

## Caveats

- The data is the **regular and post-season 2023** only. Anything older or newer is out of scope, and Claude is told so in the system prompt.
- The model can still write a bad query if your question is ambiguous; it tries the most charitable read.
- DuckDB-WASM is heavy on first load (~6 MB of WASM + ~3 MB of parquet). After that, queries are local.
- No multi-turn yet. Each question starts fresh.

## What's next

- A small bar chart for top-N aggregates.
- Eval set: 30 questions with gold SQL + tolerance bands on the numbers, so I can measure prompt regressions.
- 2024 data once it's stable on nflverse.

## License

MIT.
