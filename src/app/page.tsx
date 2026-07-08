"use client";

import { useEffect, useRef, useState } from "react";
import { runQuery, getDB, type RunResult } from "@/lib/duckdb";
import { EXAMPLES } from "@/lib/examples";

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

  useEffect(() => {
    getDB().then(
      () => setDbReady(true),
      (e) => {
        setError(e instanceof Error ? e.message : String(e));
        setStage("error");
      },
    );
  }, []);

  async function ask(q: string) {
    const myId = ++reqId.current;
    const current = () => reqId.current === myId;
    setQuestion(q);
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
      if (r.ok) {
        // Fire-and-forget summary; failures don't block the result table.
        setSummarizing(true);
        fetch("/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: q,
            sql: json.sql,
            columns: r.columns,
            rows: r.rows,
          }),
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
            className="underline underline-offset-2"
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
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) ask(question.trim());
        }}
      >
        <label className="text-sm font-medium text-neutral-700" htmlFor="q">
          Your question
        </label>
        <textarea
          id="q"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="e.g. Which team gained the most yards on screen passes?"
          maxLength={500}
          className="w-full border border-neutral-300 rounded-md px-3 py-2 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!question.trim() || busy}
            className="px-4 py-2 rounded-md bg-neutral-900 text-white text-sm disabled:bg-neutral-400"
          >
            {stage === "loading-db"
              ? "Loading data…"
              : stage === "generating"
                ? "Asking Claude…"
                : stage === "running"
                  ? "Running SQL…"
                  : "Ask"}
          </button>
          <span className="text-xs text-neutral-500">
            {dbReady
              ? "DuckDB ready · ~50k 2023 plays loaded"
              : "Loading DuckDB-WASM and the parquet…"}
          </span>
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
              className="text-xs px-3 py-1.5 rounded-full border border-neutral-300 hover:bg-neutral-100 disabled:opacity-50"
              title={ex.question}
            >
              {ex.label}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <section className="mt-8 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="font-medium">Error</div>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs">
            {error}
          </pre>
        </section>
      )}

      {sql && (
        <section className="mt-8">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-neutral-700">
              Generated SQL
            </h2>
            <div className="flex items-center gap-3">
              {usage && (
                <span className="text-xs text-neutral-500">
                  {usage.input + usage.cache} in · {usage.output} out
                  {usage.cache > 0 ? " · cache hit" : ""}
                </span>
              )}
              <CopyButton text={sql} label="Copy SQL" />
            </div>
          </div>
          <pre className="mt-2 rounded-md bg-neutral-900 text-neutral-100 text-xs px-3 py-3 overflow-x-auto font-mono">
            {sql}
          </pre>
        </section>
      )}

      {result?.ok && (summarizing || summary) && (
        <section className="mt-6">
          <p className="text-base text-neutral-800 leading-relaxed">
            {summary ?? (
              <span className="text-neutral-400 italic">summarizing…</span>
            )}
          </p>
        </section>
      )}

      {result?.ok && (
        <section className="mt-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-neutral-700">
              Results · {result.rows.length}{" "}
              {result.rows.length === 1 ? "row" : "rows"}
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-neutral-500">
                {result.elapsedMs.toFixed(0)} ms in-browser
              </span>
              {result.rows.length > 0 && (
                <DownloadCsvButton
                  columns={result.columns}
                  rows={result.rows}
                  question={question}
                />
              )}
            </div>
          </div>
          <ResultTable columns={result.columns} rows={result.rows} truncated={result.truncated} />
        </section>
      )}

      <footer className="mt-16 text-xs text-neutral-500 border-t border-neutral-200 pt-6">
        Data: <a className="underline" href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noreferrer">nflverse-data</a> 2023 pbp · ~50k plays, 57 columns. SQL: Claude Haiku 4.5. Engine: DuckDB-WASM.{" "}
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
  return (
    <>
      <div className="mt-2 overflow-x-auto rounded-md border border-neutral-200">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50 text-neutral-700">
            <tr>
              {columns.map((c) => (
                <th key={c} className="text-left px-3 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="border-t border-neutral-100">
                {r.map((cell, j) => (
                  <td key={j} className="px-3 py-1.5 align-top font-mono">
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
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toString();
    return v.toFixed(3);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
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
