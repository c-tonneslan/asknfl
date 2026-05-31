"use client";

import { useEffect, useState } from "react";
import { runQuery, getDB, type RunResult } from "@/lib/duckdb";
import { EXAMPLES } from "@/lib/examples";

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
    setQuestion(q);
    setSql(null);
    setResult(null);
    setError(null);
    setUsage(null);
    setStage(dbReady ? "generating" : "loading-db");
    try {
      const res = await fetch("/api/sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
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
      setResult(r);
      setStage(r.ok ? "done" : "error");
      if (!r.ok) setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }

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
            disabled={
              !question.trim() || stage === "generating" || stage === "running"
            }
            className="px-4 py-2 rounded-md bg-neutral-900 text-white text-sm disabled:bg-neutral-400"
          >
            {stage === "generating"
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
              disabled={stage === "generating" || stage === "running"}
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
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-neutral-700">
              Generated SQL
            </h2>
            {usage && (
              <span className="text-xs text-neutral-500">
                {usage.input + usage.cache} in · {usage.output} out
                {usage.cache > 0 ? " · cache hit" : ""}
              </span>
            )}
          </div>
          <pre className="mt-2 rounded-md bg-neutral-900 text-neutral-100 text-xs px-3 py-3 overflow-x-auto font-mono">
            {sql}
          </pre>
        </section>
      )}

      {result?.ok && (
        <section className="mt-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-neutral-700">
              Results · {result.rows.length}{" "}
              {result.rows.length === 1 ? "row" : "rows"}
            </h2>
            <span className="text-xs text-neutral-500">
              {result.elapsedMs.toFixed(0)} ms in-browser
            </span>
          </div>
          <ResultTable columns={result.columns} rows={result.rows} />
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
}: {
  columns: string[];
  rows: unknown[][];
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-2 text-sm text-neutral-500">
        Query ran fine but matched no rows.
      </p>
    );
  }
  return (
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
          {rows.map((r, i) => (
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
