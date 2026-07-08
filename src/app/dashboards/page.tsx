"use client";

import { useEffect, useState } from "react";
import { getDB, runQuery, type RunResult } from "@/lib/duckdb";
import { SiteNav } from "@/components/SiteNav";
import { BarChart, LineChart, ScatterChart, KpiTiles, CompactTable } from "@/components/charts";
import { DASHBOARDS, SEASONS, TEAMS, type Panel, type Params } from "@/lib/dashboards";

export default function DashboardsPage() {
  const [activeId, setActiveId] = useState(DASHBOARDS[0].id);
  const [season, setSeason] = useState(2024);
  const [team, setTeam] = useState("KC");
  const [results, setResults] = useState<Record<string, RunResult>>({});
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);

  const dashboard = DASHBOARDS.find((d) => d.id === activeId)!;

  useEffect(() => {
    let cancelled = false;
    const params: Params = { season, team };
    setLoading(true);
    setDbError(null);
    (async () => {
      try {
        await getDB();
        const entries = await Promise.all(
          dashboard.panels.map(async (p) => [p.id, await runQuery(p.sql(params))] as const),
        );
        if (!cancelled) {
          setResults(Object.fromEntries(entries));
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setDbError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, season, team, dashboard.panels]);

  return (
    <main className="flex-1 px-4 py-10 sm:px-10 max-w-6xl w-full mx-auto">
      <SiteNav />
      <header className="mb-6">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Dashboards</h1>
        <p className="mt-2 text-neutral-600 max-w-2xl leading-relaxed">
          Curated analytics over the 2020&ndash;2025 seasons. Every panel is a fixed SQL query
          run locally in DuckDB-WASM &mdash; no model calls, instant, and free.
        </p>
      </header>

      {/* Dashboard tabs */}
      <div className="flex flex-wrap gap-2 border-b border-neutral-200 pb-3">
        {DASHBOARDS.map((d) => (
          <button
            key={d.id}
            onClick={() => setActiveId(d.id)}
            className={
              d.id === activeId
                ? "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
                : "rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
            }
          >
            {d.title}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <p className="text-sm text-neutral-500 mr-auto max-w-md">{dashboard.description}</p>
        {dashboard.controls.includes("season") && (
          <label className="text-xs text-neutral-500">
            <span className="block mb-1">Season</span>
            <select
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {SEASONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        {dashboard.controls.includes("team") && (
          <label className="text-xs text-neutral-500">
            <span className="block mb-1">Team</span>
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {TEAMS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {dbError && (
        <div role="alert" className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="font-medium">Couldn&apos;t load the data</div>
          <p className="mt-1 text-red-700">
            The dataset (~16 MB) failed to load into DuckDB-WASM. Check your connection and refresh.
          </p>
        </div>
      )}

      {/* Panels */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {dashboard.panels.map((panel) => (
          <PanelCard
            key={panel.id}
            panel={panel}
            result={results[panel.id]}
            loading={loading}
          />
        ))}
      </div>

      <footer className="mt-16 text-xs text-neutral-500 border-t border-neutral-200 pt-6">
        Data: <a className="underline" href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noreferrer">nflverse-data</a> 2020&ndash;2025 pbp. Charts are dependency-free SVG. Engine: DuckDB-WASM.
      </footer>
    </main>
  );
}

function PanelCard({ panel, result, loading }: { panel: Panel; result?: RunResult; loading: boolean }) {
  const span = panel.span === 2 ? "lg:col-span-2" : "";
  return (
    <section className={`rounded-xl border border-neutral-200 p-4 ${span}`}>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-neutral-800">{panel.title}</h2>
        {panel.note && <p className="mt-0.5 text-xs text-neutral-400">{panel.note}</p>}
      </div>
      {loading || !result ? (
        <div className="h-40 animate-pulse rounded-md bg-neutral-100" />
      ) : !result.ok ? (
        <p className="text-sm text-red-700">Query failed: {result.error}</p>
      ) : result.rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No data for this selection.</p>
      ) : (
        <PanelViz panel={panel} result={result} />
      )}
    </section>
  );
}

function PanelViz({ panel, result }: { panel: Panel; result: Extract<RunResult, { ok: true }> }) {
  const { columns, rows } = result;
  switch (panel.viz) {
    case "kpi":
      return <KpiTiles columns={columns} rows={rows} />;
    case "bar":
      return <BarChart columns={columns} rows={rows} title="" />;
    case "line":
      return <LineChart columns={columns} rows={rows} title="" />;
    case "scatter":
      return <ScatterChart columns={columns} rows={rows} title="" />;
    case "table":
      return <CompactTable columns={columns} rows={rows} />;
  }
}
