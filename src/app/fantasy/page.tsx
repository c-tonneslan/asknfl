"use client";

import { useEffect, useMemo, useState } from "react";
import { getFantasyDB, runFantasyQuery, type RunResult } from "@/lib/duckdb";
import { SiteNav } from "@/components/SiteNav";
import { LineChart } from "@/components/charts";
import { formatNumber } from "@/lib/format";
import {
  buildBoard,
  optimalRoster,
  DEFAULT_LEAGUE,
  FORMAT_LABELS,
  type PlayerSeason,
  type Position,
  type Format,
  type Projection,
} from "@/lib/fantasy";

// Aggregate the weekly rows to one row per player-season with the raw components
// the scoring engine needs (points are computed client-side per format).
const AGG_SQL = `
  SELECT season, player_id AS playerId, any_value(player) AS player, any_value(position) AS pos,
    COUNT(*) AS games,
    SUM(passing_yards) AS passYd, SUM(passing_tds) AS passTd, SUM(passing_interceptions) AS ints,
    SUM(rushing_yards) AS rushYd, SUM(rushing_tds) AS rushTd,
    SUM(receptions) AS rec, SUM(receiving_yards) AS recYd, SUM(receiving_tds) AS recTd,
    SUM(COALESCE(passing_2pt_conversions,0)+COALESCE(rushing_2pt_conversions,0)+COALESCE(receiving_2pt_conversions,0)) AS twoPt,
    SUM(COALESCE(rushing_fumbles_lost,0)+COALESCE(receiving_fumbles_lost,0)+COALESCE(sack_fumbles_lost,0)) AS fumLost,
    AVG(COALESCE(target_share,0)) AS targetShare
  FROM player_week
  GROUP BY season, player_id`;

function toSeasons(res: Extract<RunResult, { ok: true }>): PlayerSeason[] {
  const idx = Object.fromEntries(res.columns.map((c, i) => [c, i]));
  const num = (r: unknown[], k: string) => Number(r[idx[k]] ?? 0);
  return res.rows.map((r) => ({
    playerId: String(r[idx.playerId]),
    player: String(r[idx.player]),
    pos: String(r[idx.pos]) as Position,
    season: num(r, "season"),
    games: num(r, "games"),
    passYd: num(r, "passYd"), passTd: num(r, "passTd"), ints: num(r, "ints"),
    rushYd: num(r, "rushYd"), rushTd: num(r, "rushTd"),
    rec: num(r, "rec"), recYd: num(r, "recYd"), recTd: num(r, "recTd"),
    twoPt: num(r, "twoPt"), fumLost: num(r, "fumLost"), targetShare: num(r, "targetShare"),
  }));
}

type View = "board" | "compare" | "roster";
const POSITIONS: (Position | "ALL")[] = ["ALL", "QB", "RB", "WR", "TE"];

export default function FantasyPage() {
  const [seasons, setSeasons] = useState<PlayerSeason[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<Format>("ppr");
  const [view, setView] = useState<View>("board");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getFantasyDB();
        const res = await runFantasyQuery(AGG_SQL);
        if (cancelled) return;
        if (!res.ok) setError(res.error);
        else setSeasons(toSeasons(res));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { projectFor, board } = useMemo(
    () => (seasons ? buildBoard(seasons, format) : { projectFor: 0, board: [] as Projection[] }),
    [seasons, format],
  );

  return (
    <main className="flex-1 px-4 py-10 sm:px-10 max-w-6xl w-full mx-auto">
      <SiteNav />
      <header className="mb-6">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Fantasy</h1>
        <p className="mt-2 text-neutral-600 max-w-3xl leading-relaxed">
          {projectFor ? `${projectFor} ` : ""}projections from 2020&ndash;2024 fantasy production.
          Points-per-game is recency-weighted and regressed to a positional prior, projected over
          expected games, then valued over replacement (VBD). All computed in your browser &mdash; no model calls.
        </p>
      </header>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 pb-3">
        <div className="flex gap-1">
          {(["board", "compare", "roster"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={
                v === view
                  ? "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
                  : "rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
              }
            >
              {v === "board" ? "Draft Board" : v === "compare" ? "Compare" : "Optimal Roster"}
            </button>
          ))}
        </div>
        <label className="ml-auto text-xs text-neutral-500">
          <span className="mr-2">Scoring</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as Format)}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {(Object.keys(FORMAT_LABELS) as Format[]).map((f) => (
              <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div role="alert" className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="font-medium">Couldn&apos;t load the fantasy data</div>
          <p className="mt-1 text-red-700">Check your connection and refresh.</p>
        </div>
      )}

      {!seasons && !error && (
        <div className="mt-6 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-neutral-100" />
          ))}
        </div>
      )}

      {seasons && !error && (
        <div className="mt-6">
          {view === "board" && <DraftBoard board={board} />}
          {view === "compare" && <Compare board={board} />}
          {view === "roster" && <OptimalRoster board={board} />}
        </div>
      )}

      <footer className="mt-16 text-xs text-neutral-500 border-t border-neutral-200 pt-6">
        Projections are a transparent model (recency-weighted PPG, empirical-Bayes shrinkage, VBD),
        not a guarantee. No rookies without NFL history, and no injury/depth-chart adjustments.
        Data: <a className="underline" href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noreferrer">nflverse</a> weekly player stats.
      </footer>
    </main>
  );
}

function PosBadge({ pos }: { pos: Position }) {
  const bg: Record<Position, string> = {
    QB: "#ef4444", RB: "#22c55e", WR: "#3b82f6", TE: "#f59e0b",
  };
  return (
    <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: bg[pos] }}>
      {pos}
    </span>
  );
}

function DraftBoard({ board }: { board: Projection[] }) {
  const [pos, setPos] = useState<Position | "ALL">("ALL");
  const rows = board.filter((p) => pos === "ALL" || p.pos === pos).slice(0, 150);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {POSITIONS.map((p) => (
          <button
            key={p}
            onClick={() => setPos(p)}
            className={
              p === pos
                ? "rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white"
                : "rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
            }
          >
            {p}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-neutral-400">
          Ranked by value over replacement · top {rows.length}
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              {["#", "Player", "Pos", "Proj Pts", "PPG", "VOR", "Value"].map((h, i) => (
                <th key={h} className={`px-3 py-2 font-medium whitespace-nowrap ${i >= 3 ? "text-right" : "text-left"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.playerId} className="border-t border-neutral-100 hover:bg-neutral-50">
                <td className="px-3 py-1.5 text-neutral-400 tabular-nums">{i + 1}</td>
                <td className="px-3 py-1.5 font-medium text-neutral-900">{p.player}</td>
                <td className="px-3 py-1.5"><PosBadge pos={p.pos} /> <span className="text-xs text-neutral-400">{p.pos}{p.posRank}</span></td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-neutral-900">{formatNumber(Math.round(p.projPoints))}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-neutral-600">{p.projPPG.toFixed(1)}</td>
                <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${p.vor >= 0 ? "text-emerald-700" : "text-neutral-400"}`}>
                  {p.vor >= 0 ? "+" : ""}{Math.round(p.vor)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-neutral-900">
                  {p.auction > 0 ? `$${p.auction}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Compare({ board }: { board: Projection[] }) {
  const [aId, setAId] = useState(board[0]?.playerId ?? "");
  const [bId, setBId] = useState(board[1]?.playerId ?? "");
  const a = board.find((p) => p.playerId === aId);
  const b = board.find((p) => p.playerId === bId);

  const options = useMemo(
    () => [...board].sort((x, y) => x.player.localeCompare(y.player)),
    [board],
  );

  // Long-format rows for a two-line PPG-by-season chart.
  const trendRows = useMemo(() => {
    const rows: unknown[][] = [];
    for (const p of [a, b]) {
      if (!p) continue;
      for (const h of p.history) rows.push([h.season, p.player, Math.round(h.ppg * 10) / 10]);
    }
    return rows;
  }, [a, b]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-4">
        {[[aId, setAId], [bId, setBId]].map(([id, set], i) => (
          <select
            key={i}
            value={id as string}
            onChange={(e) => (set as (v: string) => void)(e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {options.map((p) => (
              <option key={p.playerId} value={p.playerId}>{p.player} ({p.pos})</option>
            ))}
          </select>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        {[a, b].map((p, i) => (
          <div key={i} className="rounded-xl border border-neutral-200 p-4">
            {p ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold text-neutral-900">{p.player}</span>
                  <PosBadge pos={p.pos} />
                  <span className="text-xs text-neutral-400">{p.pos}{p.posRank}</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <Stat label="Proj points" value={formatNumber(Math.round(p.projPoints))} />
                  <Stat label="Proj PPG" value={p.projPPG.toFixed(1)} />
                  <Stat label="VOR" value={`${p.vor >= 0 ? "+" : ""}${Math.round(p.vor)}`} />
                  <Stat label="Auction $" value={p.auction > 0 ? `$${p.auction}` : "—"} />
                </dl>
              </>
            ) : (
              <p className="text-sm text-neutral-500">Pick a player.</p>
            )}
          </div>
        ))}
      </div>

      {trendRows.length > 1 && (
        <div className="mt-4 rounded-xl border border-neutral-200 p-4">
          <LineChart columns={["season", "player", "ppg"]} rows={trendRows} title="Points per game" />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-neutral-100 pb-1">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-mono tabular-nums text-neutral-900">{value}</dd>
    </div>
  );
}

function OptimalRoster({ board }: { board: Projection[] }) {
  const { slots, total } = useMemo(() => optimalRoster(board, DEFAULT_LEAGUE), [board]);
  return (
    <div className="max-w-xl">
      <p className="mb-3 text-sm text-neutral-500">
        The highest-projected legal starting lineup for a {DEFAULT_LEAGUE.teams}-team league
        (1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX) &mdash; a ceiling, not a draftable team.
      </p>
      <div className="overflow-hidden rounded-md border border-neutral-200">
        <table className="w-full text-sm">
          <tbody>
            {slots.map((s, i) => (
              <tr key={i} className="border-t border-neutral-100 first:border-t-0">
                <td className="w-16 px-3 py-2 text-xs font-semibold text-neutral-400">{s.slot}</td>
                <td className="px-3 py-2">
                  {s.player ? (
                    <span className="flex items-center gap-2">
                      <PosBadge pos={s.player.pos} />
                      <span className="font-medium text-neutral-900">{s.player.player}</span>
                    </span>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-900">
                  {s.player ? formatNumber(Math.round(s.player.projPoints)) : ""}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-neutral-300 bg-neutral-50">
              <td className="px-3 py-2 text-xs font-semibold text-neutral-500" colSpan={2}>Projected total</td>
              <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-neutral-900">
                {formatNumber(Math.round(total))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
