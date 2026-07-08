"use client";

import { useEffect, useRef, useState } from "react";
import { runQuery, getDB, type RunResult } from "@/lib/duckdb";
import { EXAMPLES } from "@/lib/examples";
import { validateGeneratedSql } from "@/lib/sql-validate";
import { SCHEMA_LINES } from "@/lib/schema";

// Cap how many rows we render in the table (materialization is already bounded in
// runQuery); everything is still downloadable via CSV.
const RENDER_CAP = 500;

type Stage = "idle" | "loading-db" | "generating" | "running" | "done" | "error";

export default function Home() {
  const [question, setQuestion] = useState("");
  const [sql, setSql] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dbReady, setDbReady] = useState(false);
  const [usage, setUsage] = useState<{
    input: number;
    output: number;
    cache: number;
  } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  // Monotonic id so a slow response from an earlier question can't overwrite a
  // newer one (the main flow and the fire-and-forget summarize both check it).
  const reqId = useRef(0);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getDB().then(
      () => setDbReady(true),
      (e) => {
        setError(e instanceof Error ? e.message : String(e));
        setStage("error");
      },
    );
  }, []);

  // Shared links: if the page loads with ?q=..., prefill and run it once.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const q = new URLSearchParams(window.location.search).get("q")?.trim();
    if (q) {
      setQuestion(q);
      ask(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll the answer into view once a query starts — on a phone the results
  // render far below the chips, so otherwise a fast query looks like a no-op.
  useEffect(() => {
    if (stage === "running" || stage === "done" || stage === "error") {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [stage]);

  // Reflect the current question in the URL so a result is shareable/bookmarkable
  // (?q=...). replaceState keeps it out of the back-button history.
  function syncUrl(q: string) {
    try {
      window.history.replaceState(null, "", q ? `?q=${encodeURIComponent(q)}` : window.location.pathname);
    } catch {
      // Non-browser / sandboxed contexts: the URL is a nicety, not load-bearing.
    }
  }

  // Fire-and-forget one-sentence summary; failures never block the table.
  function summarize(q: string, sqlText: string, r: RunResult, current: () => boolean) {
    if (!r.ok) return;
    setSummarizing(true);
    fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, sql: sqlText, columns: r.columns, rows: r.rows }),
    })
      .then(async (resp) => {
        const sj = (await resp.json()) as { summary?: string; error?: string };
        if (current() && sj.summary) setSummary(sj.summary);
      })
      .catch(() => {
        // Silent: the summary is a bonus, not the answer.
      })
      .finally(() => {
        if (current()) setSummarizing(false);
      });
  }

  // Re-run SQL the user has edited by hand, straight against DuckDB-WASM —
  // skipping the Claude round-trip. Still validated so the httpfs/read_parquet
  // guard from the API applies to hand-written queries too.
  async function runEditedSql(edited: string) {
    const v = validateGeneratedSql(edited);
    if (!v.ok) {
      setResult(null);
      setError(`That SQL was rejected (${v.reason}). Only a single read-only SELECT is allowed.`);
      setStage("error");
      return;
    }
    const myId = ++reqId.current;
    const current = () => reqId.current === myId;
    setSql(v.sql);
    setError(null);
    setSummary(null);
    setSummarizing(false);
    setStage("running");
    const r = await runQuery(v.sql);
    if (!current()) return;
    setResult(r);
    setStage(r.ok ? "done" : "error");
    if (!r.ok) setError(r.error);
    else summarize(question, v.sql, r, current);
  }

  async function ask(q: string) {
    const myId = ++reqId.current;
    const current = () => reqId.current === myId;
    setQuestion(q);
    syncUrl(q);
    setSql(null);
    setResult(null);
    setError(null);
    setUsage(null);
    setSummary(null);
    setSummarizing(false);
    setStage(dbReady ? "generating" : "loading-db");
    try {
      const res = await fetch("/api/sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!current()) return; // a newer question started
      const json = (await res.json()) as
        | {
            sql: string;
            usage: {
              input_tokens: number;
              output_tokens: number;
              cache_read_input_tokens: number;
            };
          }
        | { error: string };
      if ("error" in json) {
        setError(json.error);
        setStage("error");
        return;
      }
      setSql(json.sql);
      setUsage({
        input: json.usage.input_tokens,
        output: json.usage.output_tokens,
        cache: json.usage.cache_read_input_tokens,
      });
      setStage("running");
      const r = await runQuery(json.sql);
      if (!current()) return; // a newer question started
      setResult(r);
      setStage(r.ok ? "done" : "error");
      if (!r.ok) setError(r.error);
      else summarize(q, json.sql, r, current);
    } catch (e) {
      if (!current()) return;
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }

  const busy =
    stage === "loading-db" || stage === "generating" || stage === "running";

  return (
    <main className="flex-1 px-4 py-10 sm:px-10 max-w-5xl w-full mx-auto">
      <header className="mb-10">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          asknfl
        </h1>
        <p className="mt-2 text-neutral-600 max-w-2xl leading-relaxed">
          Ask a question in English. Claude writes the DuckDB SQL,{" "}
          <a
            className="text-accent hover:text-accent-hover underline underline-offset-2 decoration-accent/40"
            href="https://duckdb.org/docs/api/wasm/overview"
            target="_blank"
            rel="noreferrer"
          >
            DuckDB-WASM
          </a>{" "}
          runs it in your browser against ~50k 2023 nflfastR plays.
        </p>
      </header>

      <form
        className="flex flex-col gap-3"
        aria-busy={busy}
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim() && !busy) ask(question.trim());
        }}
      >
        <label className="text-sm font-medium text-neutral-700" htmlFor="q">
          Your question
        </label>
        <textarea
          id="q"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter submits (plain Enter keeps its newline for long questions).
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && question.trim() && !busy) {
              e.preventDefault();
              ask(question.trim());
            }
          }}
          autoFocus
          rows={2}
          placeholder="e.g. Which team gained the most yards on screen passes?"
          maxLength={500}
          className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!question.trim() || busy}
            className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-md bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover active:bg-accent-hover disabled:bg-neutral-400 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            {busy && <Spinner />}
            {stage === "loading-db"
              ? "Loading data…"
              : stage === "generating"
                ? "Asking Claude…"
                : stage === "running"
                  ? "Running SQL…"
                  : "Ask"}
          </button>
          <span className="hidden sm:inline text-xs text-neutral-400" aria-hidden>
            ⌘↵
          </span>
          <span className="text-xs text-neutral-500">
            {stage === "loading-db" || (!dbReady && stage === "idle")
              ? "Loading DuckDB-WASM and the parquet…"
              : stage === "generating"
                ? "Claude is writing the SQL…"
                : stage === "running"
                  ? "Running in DuckDB-WASM…"
                  : "DuckDB ready · ~50k 2023 plays loaded"}
          </span>
        </div>
        {/* Screen readers hear the async progress + result arrival. */}
        <div aria-live="polite" className="sr-only">
          {stage === "generating"
            ? "Generating SQL."
            : stage === "running"
              ? "Running query."
              : stage === "done" && result?.ok
                ? `Query returned ${result.rows.length} rows. ${summary ?? ""}`
                : stage === "error"
                  ? `Error: ${error ?? "something went wrong"}`
                  : ""}
        </div>
      </form>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-neutral-700 mb-3">
          Try one of these
        </h2>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => ask(ex.question)}
              disabled={busy}
              className="text-xs px-3 py-2 min-h-[36px] rounded-full border border-neutral-300 text-neutral-700 hover:bg-neutral-100 hover:border-neutral-400 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              title={ex.question}
            >
              {ex.label}
            </button>
          ))}
        </div>
        <SchemaDrawer />
      </section>

      <div ref={resultsRef} className="scroll-mt-6">
        {error && (
          <section
            role="alert"
            className="mt-8 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <div className="font-medium">That one didn&apos;t work</div>
            <p className="mt-1 text-red-700">
              {humanizeError(error)}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-red-600/80 select-none">
                Technical detail
              </summary>
              <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-red-700">
                {error}
              </pre>
            </details>
            {question.trim() && (
              <button
                onClick={() => ask(question.trim())}
                disabled={busy}
                className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-red-300 text-red-800 text-xs font-medium hover:bg-red-100 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                {busy && <Spinner className="h-3.5 w-3.5" />}
                Try again
              </button>
            )}
          </section>
        )}

        {result?.ok && (summarizing || summary) && (
          <section className="mt-8 rounded-xl border border-accent/20 bg-accent/5 px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-accent">
              Answer
            </div>
            {summary ? (
              <p className="mt-1 text-lg leading-relaxed text-neutral-900">
                {summary}
              </p>
            ) : (
              <div className="mt-2 h-5 w-2/3 animate-pulse rounded bg-accent/15" />
            )}
          </section>
        )}

        {result?.ok && <Headline columns={result.columns} rows={result.rows} />}

        {result?.ok && <BarChart columns={result.columns} rows={result.rows} />}

        {result?.ok && result.rows.length > 0 && (
          <section className="mt-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium text-neutral-700">
                {result.truncated
                  ? `Results · first ${result.rows.length.toLocaleString()} rows`
                  : `Results · ${result.rows.length.toLocaleString()} ${result.rows.length === 1 ? "row" : "rows"}`}
              </h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-neutral-500">
                  {result.elapsedMs.toFixed(0)} ms in-browser
                </span>
                <ShareButton />
                <DownloadCsvButton
                  columns={result.columns}
                  rows={result.rows}
                  question={question}
                />
              </div>
            </div>
            <ResultTable columns={result.columns} rows={result.rows} truncated={result.truncated} />
          </section>
        )}

        {sql && (
          <details className="mt-6 group">
            <summary className="flex cursor-pointer select-none items-center gap-2 text-sm text-neutral-600 hover:text-neutral-900">
              <span className="text-neutral-400 transition-transform group-open:rotate-90">
                ▸
              </span>
              Show the SQL Claude wrote
            </summary>
            <SqlEditor
              sql={sql}
              usage={usage}
              busy={busy}
              onRun={runEditedSql}
            />
            <p className="mt-1.5 text-xs text-neutral-400">
              Editable — tweak it and re-run against DuckDB-WASM in your browser. Only your question ever leaves the page.
            </p>
          </details>
        )}
      </div>

      <footer className="mt-16 text-xs text-neutral-500 border-t border-neutral-200 pt-6">
        Data: <a className="underline" href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noreferrer">nflverse-data</a> 2023 pbp · ~50k plays, 53 columns. SQL: Claude Haiku 4.5. Engine: DuckDB-WASM.{" "}
        <a className="underline" href="https://github.com/c-tonneslan/asknfl" target="_blank" rel="noreferrer">Source on GitHub</a>.
      </footer>
    </main>
  );
}

function ResultTable({
  columns,
  rows,
  truncated,
}: {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-2 text-sm text-neutral-500">
        Query ran fine but matched no rows.
      </p>
    );
  }
  const shown = rows.slice(0, RENDER_CAP);
  // Right-align (and number-format) a column when its first non-null value is a
  // number, so ranking tables line up on the decimal instead of ragged-left.
  const numericCol = columns.map((_, j) => {
    const cell = rows.find((r) => r[j] !== null && r[j] !== undefined)?.[j];
    return typeof cell === "number";
  });
  return (
    <>
      <div className="mt-2 overflow-x-auto rounded-md border border-neutral-200">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50 text-neutral-700">
            <tr>
              {columns.map((c, j) => (
                <th
                  key={c}
                  className={`px-3 py-2 font-medium whitespace-nowrap ${numericCol[j] ? "text-right" : "text-left"}`}
                  title={c}
                >
                  {humanizeColumn(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="border-t border-neutral-100 hover:bg-neutral-50/60">
                {r.map((cell, j) => (
                  <td
                    key={j}
                    className={`px-3 py-1.5 align-top ${numericCol[j] ? "text-right font-mono tabular-nums text-neutral-900" : "text-neutral-700"}`}
                  >
                    {formatCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(rows.length > RENDER_CAP || truncated) && (
        <p className="mt-2 text-xs text-neutral-500">
          Showing first {shown.length.toLocaleString()} of {rows.length.toLocaleString()}
          {truncated ? "+ (result capped at 5,000)" : ""} rows — download the CSV for the full set.
        </p>
      )}
    </>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

// Whole numbers get thousands separators; fractional values keep up to 3
// decimals (trailing zeros trimmed) so EPA-style metrics stay readable.
function formatNumber(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return v.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

// Turn snake_case column names into Title Case, with a few NFL-specific
// abbreviations preserved (epa, td, wp...). Falls back gracefully.
const COLUMN_LABELS: Record<string, string> = {
  epa: "EPA",
  wpa: "WPA",
  wp: "Win Prob",
  cpoe: "CPOE",
  td: "TD",
  tds: "TDs",
  yac: "YAC",
  qtr: "Quarter",
  posteam: "Team",
  defteam: "Opponent",
  ydstogo: "Yards To Go",
  ot: "OT",
};

function humanizeColumn(c: string): string {
  if (COLUMN_LABELS[c]) return COLUMN_LABELS[c];
  return c
    .split("_")
    .map((w) => COLUMN_LABELS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// A single scalar result (one row, one numeric column) is the whole answer —
// show it big instead of burying it in a 1x1 table. A one-row, few-column
// result (a single player's line) becomes a row of stat tiles.
function Headline({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  if (rows.length !== 1) return null;
  const row = rows[0];

  if (columns.length === 1 && typeof row[0] === "number") {
    return (
      <section className="mt-4">
        <div className="text-4xl font-semibold tabular-nums text-neutral-900">
          {formatNumber(row[0] as number)}
        </div>
        <div className="mt-1 text-sm text-neutral-500">{humanizeColumn(columns[0])}</div>
      </section>
    );
  }

  if (columns.length >= 2 && columns.length <= 5) {
    return (
      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {columns.map((c, j) => (
          <div key={c} className="rounded-lg border border-neutral-200 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">
              {humanizeColumn(c)}
            </div>
            <div
              className={`mt-0.5 text-lg font-semibold text-neutral-900 ${typeof row[j] === "number" ? "tabular-nums" : ""}`}
            >
              {formatCell(row[j])}
            </div>
          </div>
        ))}
      </section>
    );
  }

  return null;
}

// Translate the raw error strings users can hit into one plain sentence.
function humanizeError(error: string): string {
  const e = error.toLowerCase();
  if (e.includes("rejected")) {
    return "Claude wrote a query that isn't allowed for safety. Try rewording the question.";
  }
  if (e.includes("too many requests") || e.includes("429")) {
    return "You're asking a bit fast — give it a few seconds and try again.";
  }
  if (e.includes("catalog") || e.includes("does not exist") || e.includes("referenced column")) {
    return "The query referenced something that isn't in the data. Try being more specific.";
  }
  if (e.includes("api key") || e.includes("anthropic")) {
    return "The question couldn't reach the model. This is usually temporary — try again.";
  }
  return "Something went wrong running that question. Try rewording it, or ask a simpler version.";
}

// nflverse 3-letter team code -> primary color, for coloring ranking bars.
const TEAM_COLORS: Record<string, string> = {
  ARI: "#97233F", ATL: "#A71930", BAL: "#241773", BUF: "#00338D",
  CAR: "#0085CA", CHI: "#0B162A", CIN: "#FB4F14", CLE: "#311D00",
  DAL: "#003594", DEN: "#FB4F14", DET: "#0076B6", GB: "#203731",
  HOU: "#03202F", IND: "#002C5F", JAX: "#006778", KC: "#E31837",
  LA: "#003594", LAC: "#0080C6", LV: "#000000", MIA: "#008E97",
  MIN: "#4F2683", NE: "#002244", NO: "#D3BC8D", NYG: "#0B2265",
  NYJ: "#125740", PHI: "#004C54", PIT: "#FFB612", SEA: "#002244",
  SF: "#AA0000", TB: "#D50A0A", TEN: "#0C2340", WAS: "#5A1414",
};

// A ranking result (a label column + a numeric column, a handful of rows) reads
// far better as bars than as a table of numbers. Dependency-free: plain divs
// scaled by value. Falls back to nothing when the shape doesn't fit.
function BarChart({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  if (rows.length < 2 || rows.length > 30) return null;

  const labelIdx = columns.findIndex((_, j) => typeof firstDefined(rows, j) === "string");
  const valueIdx = columns.findIndex((_, j) => typeof firstDefined(rows, j) === "number");
  if (labelIdx === -1 || valueIdx === -1) return null;

  const points = rows
    .map((r) => ({ label: r[labelIdx], value: r[valueIdx] }))
    .filter((p) => typeof p.value === "number" && p.label != null) as {
    label: string;
    value: number;
  }[];
  if (points.length < 2) return null;

  const max = Math.max(...points.map((p) => Math.abs(p.value)));
  if (max === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium text-neutral-700 mb-2">
        {humanizeColumn(columns[valueIdx])} by {humanizeColumn(columns[labelIdx])}
      </h2>
      <div className="space-y-1.5">
        {points.map((p, i) => {
          const code = String(p.label).toUpperCase();
          const color = TEAM_COLORS[code] ?? "var(--accent)";
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <div className="w-28 shrink-0 truncate text-right text-neutral-600" title={String(p.label)}>
                {String(p.label)}
              </div>
              <div className="relative h-5 flex-1 rounded bg-neutral-100">
                <div
                  className="absolute inset-y-0 left-0 rounded"
                  style={{ width: `${(Math.abs(p.value) / max) * 100}%`, backgroundColor: color }}
                />
              </div>
              <div className="w-16 shrink-0 text-right font-mono tabular-nums text-neutral-900">
                {formatNumber(p.value)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function firstDefined(rows: unknown[][], j: number): unknown {
  return rows.find((r) => r[j] !== null && r[j] !== undefined)?.[j];
}

// The generated SQL, editable and re-runnable straight against DuckDB-WASM.
function SqlEditor({
  sql,
  usage,
  busy,
  onRun,
}: {
  sql: string;
  usage: { input: number; output: number; cache: number } | null;
  busy: boolean;
  onRun: (sql: string) => void;
}) {
  const [text, setText] = useState(sql);
  // Reset the editor when a new question generates fresh SQL.
  useEffect(() => setText(sql), [sql]);
  const dirty = text.trim() !== sql.trim();

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-neutral-200">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-3 py-1.5">
        <span className="text-xs font-medium text-neutral-500">DuckDB SQL</span>
        <div className="flex items-center gap-3">
          {usage && (
            <span className="text-xs text-neutral-400">
              {usage.input + usage.cache} in · {usage.output} out
              {usage.cache > 0 ? " · cache hit" : ""}
            </span>
          )}
          <CopyButton text={text} label="Copy" />
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={Math.min(12, text.split("\n").length + 1)}
        aria-label="Editable SQL"
        className="block w-full resize-y bg-neutral-900 px-3 py-3 font-mono text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy) {
            e.preventDefault();
            onRun(text);
          }
        }}
      />
      <div className="flex items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50 px-3 py-1.5">
        <span className="text-xs text-neutral-400">
          {dirty ? "Edited — not yet run" : " "}
        </span>
        <button
          type="button"
          onClick={() => onRun(text)}
          disabled={busy || !text.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:bg-neutral-400 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
        >
          {busy && <Spinner className="h-3 w-3" />}
          Run SQL
          <span className="hidden sm:inline text-accent-fg/70">⌘↵</span>
        </button>
      </div>
    </div>
  );
}

// A browsable list of the queryable columns, so people know what's fair game.
function SchemaDrawer() {
  return (
    <details className="mt-4 group">
      <summary className="flex cursor-pointer select-none items-center gap-2 text-sm text-neutral-500 hover:text-neutral-800">
        <span className="text-neutral-400 transition-transform group-open:rotate-90">▸</span>
        Browse the {SCHEMA_LINES.length} columns you can ask about
      </summary>
      <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {SCHEMA_LINES.map((s) => (
          <div key={s.col} className="flex gap-2 text-xs">
            <code className="shrink-0 font-mono text-neutral-800">{s.col}</code>
            <span className="truncate text-neutral-500" title={s.desc}>
              {s.desc}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

// Copy a shareable link to the current question (?q=...).
function ShareButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // No async clipboard: the URL bar already carries ?q=, so sharing
          // still works by copying the address manually.
        }
      }}
      className="text-xs px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-100"
    >
      {copied ? "Link copied" : "Copy link"}
    </button>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Older browsers without the async clipboard API: the user can
          // still select-and-copy from the pre block. Don't pretend it
          // worked.
        }
      }}
      className="text-xs px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-100"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function DownloadCsvButton({
  columns,
  rows,
  question,
}: {
  columns: string[];
  rows: unknown[][];
  question: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        const blob = new Blob([toCsv(columns, rows)], {
          type: "text/csv;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = csvFilename(question);
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }}
      className="text-xs px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-100"
    >
      Download CSV
    </button>
  );
}

function toCsv(columns: string[], rows: unknown[][]): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" || typeof v === "boolean" ? String(v) : String(v);
    // RFC 4180: wrap if the value contains comma, quote, CR, or LF; double
    // any embedded quote.
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.map(escape).join(",");
  const body = rows.map((r) => r.map(escape).join(",")).join("\r\n");
  return header + "\r\n" + body + "\r\n";
}

function csvFilename(question: string): string {
  const slug = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `asknfl-${slug || "results"}.csv`;
}
