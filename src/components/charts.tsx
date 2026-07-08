"use client";

// Dependency-free charts (inline SVG / divs) shared by the Q&A view and the
// dashboards. No charting library: keeps the bundle small, works under a strict
// CSP, and renders the same server- or client-side.

import {
  formatNumber,
  humanizeColumn,
  teamColor,
  firstDefined,
  numericColumns,
  detectChart,
} from "@/lib/format";

// A small qualitative palette for non-team series.
const PALETTE = [
  "var(--accent)", "#2563eb", "#db2777", "#d97706", "#7c3aed", "#0891b2",
  "#16a34a", "#dc2626",
];

// ---------------------------------------------------------------------------
// Bar chart — a label column + a numeric column, a handful of rows.
// ---------------------------------------------------------------------------
export function BarChart({
  columns,
  rows,
  title,
}: {
  columns: string[];
  rows: unknown[][];
  title?: string;
}) {
  const numeric = numericColumns(columns, rows);
  const labelIdx = numeric.findIndex((n) => !n);
  const valueIdx = numeric.findIndex((n) => n);
  if (labelIdx === -1 || valueIdx === -1) return null;

  const points = rows
    .map((r) => ({ label: r[labelIdx], value: r[valueIdx] }))
    .filter((p) => typeof p.value === "number" && p.label != null) as {
    label: string;
    value: number;
  }[];
  if (points.length < 1) return null;

  const max = Math.max(...points.map((p) => Math.abs(p.value)));
  if (max === 0) return null;

  return (
    <figure>
      {title !== "" && (
        <figcaption className="text-sm font-medium text-neutral-700 mb-2">
          {title ?? `${humanizeColumn(columns[valueIdx])} by ${humanizeColumn(columns[labelIdx])}`}
        </figcaption>
      )}
      <div className="space-y-1.5">
        {points.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-28 shrink-0 truncate text-right text-neutral-600" title={String(p.label)}>
              {String(p.label)}
            </div>
            <div className="relative h-5 flex-1 rounded bg-neutral-100">
              <div
                className="absolute inset-y-0 left-0 rounded"
                style={{
                  width: `${(Math.abs(p.value) / max) * 100}%`,
                  backgroundColor: teamColor(p.label) ?? "var(--accent)",
                }}
              />
            </div>
            <div className="w-16 shrink-0 text-right font-mono tabular-nums text-neutral-900">
              {formatNumber(p.value)}
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Line chart — an ordinal x-axis (season/week) + one or more numeric series.
// Supports "wide" data (x + N numeric columns) and "long" data (x, key, value).
// ---------------------------------------------------------------------------
type Series = { name: string; points: { x: unknown; y: number }[] };

function toSeries(columns: string[], rows: unknown[][]): { xLabels: unknown[]; series: Series[] } | null {
  const numeric = numericColumns(columns, rows);
  // x = a named axis column if present, else the first column.
  const axisNames = ["season", "week", "qtr", "down", "year"];
  let xIdx = columns.findIndex((c) => axisNames.includes(c.toLowerCase()));
  if (xIdx === -1) xIdx = 0;

  const numericY = columns.flatMap((_, j) => (numeric[j] && j !== xIdx ? [j] : []));
  const stringCols = columns.flatMap((_, j) => (!numeric[j] && j !== xIdx ? [j] : []));

  // Long format: x + one string key + one numeric value -> pivot on the key.
  if (columns.length === 3 && stringCols.length === 1 && numericY.length === 1) {
    const keyIdx = stringCols[0];
    const valIdx = numericY[0];
    const xs = [...new Set(rows.map((r) => r[xIdx]))];
    const groups = new Map<string, { x: unknown; y: number }[]>();
    for (const r of rows) {
      const k = String(r[keyIdx]);
      if (typeof r[valIdx] !== "number") continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push({ x: r[xIdx], y: r[valIdx] as number });
    }
    const series = [...groups.entries()]
      .slice(0, 8)
      .map(([name, points]) => ({ name, points }));
    return { xLabels: xs, series };
  }

  // Wide format: each numeric column (besides x) is a series.
  if (numericY.length >= 1) {
    const xs = rows.map((r) => r[xIdx]);
    const series = numericY.slice(0, 8).map((j) => ({
      name: columns[j],
      points: rows.map((r) => ({ x: r[xIdx], y: r[j] as number })),
    }));
    return { xLabels: xs, series };
  }
  return null;
}

export function LineChart({
  columns,
  rows,
  title,
}: {
  columns: string[];
  rows: unknown[][];
  title?: string;
}) {
  const parsed = toSeries(columns, rows);
  if (!parsed) return null;
  const { xLabels, series } = parsed;
  const allY = series.flatMap((s) => s.points.map((p) => p.y)).filter((y) => typeof y === "number");
  if (allY.length < 2) return null;

  const W = 560, H = 220, L = 46, R = 14, T = 14, B = 30;
  const plotW = W - L - R, plotH = H - T - B;
  const n = xLabels.length;
  let yMin = Math.min(...allY), yMax = Math.max(...allY);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const pad = (yMax - yMin) * 0.08;
  yMin -= pad; yMax += pad;

  const xAt = (i: number) => L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => T + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => yMin + (i / ticks) * (yMax - yMin));

  const single = series.length === 1;
  const colorFor = (name: string, i: number) => teamColor(name) ?? PALETTE[i % PALETTE.length];
  const axisNames = ["season", "week", "qtr", "down", "year"];
  const xNameIdx = columns.findIndex((c) => axisNames.includes(c.toLowerCase()));
  const xName = humanizeColumn(columns[xNameIdx === -1 ? 0 : xNameIdx]);

  return (
    <figure>
      {title !== "" && (
        <figcaption className="text-sm font-medium text-neutral-700 mb-2">
          {title ?? (single ? humanizeColumn(series[0].name) : "Trend")}{" "}
          <span className="text-neutral-400 font-normal">by {xName}</span>
        </figcaption>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
        {tickVals.map((tv, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={yAt(tv)} y2={yAt(tv)} stroke="#e5e5e5" strokeWidth="1" />
            <text x={L - 6} y={yAt(tv) + 3} textAnchor="end" fontSize="9" fill="#9ca3af">
              {formatNumber(Math.round(tv * 1000) / 1000)}
            </text>
          </g>
        ))}
        {xLabels.map((xl, i) =>
          n <= 8 || i % 2 === 0 ? (
            <text key={i} x={xAt(i)} y={H - 10} textAnchor="middle" fontSize="9" fill="#9ca3af">
              {String(xl)}
            </text>
          ) : null,
        )}
        {series.map((s, si) => {
          const color = colorFor(s.name, si);
          const d = s.points
            .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.y).toFixed(1)}`)
            .join(" ");
          return (
            <g key={si}>
              <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {s.points.map((p, i) => (
                <circle key={i} cx={xAt(i)} cy={yAt(p.y)} r="2.5" fill={color}>
                  <title>{`${s.name} @ ${xLabels[i]}: ${formatNumber(p.y)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      {!single && (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s, si) => (
            <span key={si} className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: colorFor(s.name, si) }} />
              {humanizeColumn(s.name)}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Scatter chart — a label + two numeric columns (a relationship).
// ---------------------------------------------------------------------------
export function ScatterChart({
  columns,
  rows,
  title,
}: {
  columns: string[];
  rows: unknown[][];
  title?: string;
}) {
  const numeric = numericColumns(columns, rows);
  const numericIdx = numeric.flatMap((n, j) => (n ? [j] : []));
  const labelIdx = numeric.findIndex((n) => !n);
  if (numericIdx.length < 2) return null;
  const xi = numericIdx[0], yi = numericIdx[1];

  const pts = rows
    .map((r) => ({ label: labelIdx === -1 ? "" : r[labelIdx], x: r[xi], y: r[yi] }))
    .filter((p) => typeof p.x === "number" && typeof p.y === "number") as {
    label: string; x: number; y: number;
  }[];
  if (pts.length < 2) return null;

  const W = 560, H = 300, L = 46, R = 14, T = 14, B = 34;
  const plotW = W - L - R, plotH = H - T - B;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  let xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (xMin === xMax) { xMin -= 1; xMax += 1; }
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const px = (xMax - xMin) * 0.06, py = (yMax - yMin) * 0.06;
  xMin -= px; xMax += px; yMin -= py; yMax += py;
  const xAt = (v: number) => L + ((v - xMin) / (xMax - xMin)) * plotW;
  const yAt = (v: number) => T + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  return (
    <figure>
      {title !== "" && (
        <figcaption className="text-sm font-medium text-neutral-700 mb-2">
          {title ?? `${humanizeColumn(columns[yi])} vs ${humanizeColumn(columns[xi])}`}
        </figcaption>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
          const yv = yMin + t * (yMax - yMin);
          return (
            <g key={i}>
              <line x1={L} x2={W - R} y1={yAt(yv)} y2={yAt(yv)} stroke="#f0f0f0" strokeWidth="1" />
              <text x={L - 6} y={yAt(yv) + 3} textAnchor="end" fontSize="9" fill="#9ca3af">
                {formatNumber(Math.round(yv * 1000) / 1000)}
              </text>
            </g>
          );
        })}
        {pts.map((p, i) => {
          const c = teamColor(p.label) ?? "var(--accent)";
          return (
            <g key={i}>
              <circle cx={xAt(p.x)} cy={yAt(p.y)} r="4" fill={c} fillOpacity="0.75">
                <title>{`${p.label ? p.label + ": " : ""}${humanizeColumn(columns[xi])} ${formatNumber(p.x)}, ${humanizeColumn(columns[yi])} ${formatNumber(p.y)}`}</title>
              </circle>
              {pts.length <= 24 && p.label && (
                <text x={xAt(p.x) + 5} y={yAt(p.y) + 3} fontSize="8" fill="#6b7280">{p.label}</text>
              )}
            </g>
          );
        })}
        <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="#9ca3af">
          {humanizeColumn(columns[xi])}
        </text>
      </svg>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// AutoChart — pick the most honest chart for the result shape (or nothing).
// ---------------------------------------------------------------------------
export function AutoChart({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  const kind = detectChart(columns, rows);
  if (kind === "line") return <LineChart columns={columns} rows={rows} />;
  if (kind === "scatter") return <ScatterChart columns={columns} rows={rows} />;
  if (kind === "bar") return <BarChart columns={columns} rows={rows} />;
  return null;
}

// ---------------------------------------------------------------------------
// KPI tiles — a single row of headline numbers.
// ---------------------------------------------------------------------------
export function KpiTiles({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  if (rows.length === 0) return null;
  const row = rows[0];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {columns.map((c, j) => (
        <div key={c} className="rounded-lg border border-neutral-200 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-neutral-400">{humanizeColumn(c)}</div>
          <div className={`mt-0.5 text-lg font-semibold text-neutral-900 ${typeof row[j] === "number" ? "tabular-nums" : ""}`}>
            {typeof row[j] === "number" ? formatNumber(row[j] as number) : String(row[j] ?? "—")}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact table for dashboard panels.
// ---------------------------------------------------------------------------
export function CompactTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  const numeric = numericColumns(columns, rows);
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200">
      <table className="w-full text-xs">
        <thead className="bg-neutral-50 text-neutral-600">
          <tr>
            {columns.map((c, j) => (
              <th key={c} className={`px-3 py-1.5 font-medium whitespace-nowrap ${numeric[j] ? "text-right" : "text-left"}`}>
                {humanizeColumn(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-neutral-100">
              {r.map((cell, j) => (
                <td key={j} className={`px-3 py-1 ${numeric[j] ? "text-right font-mono tabular-nums text-neutral-900" : "text-neutral-700"}`}>
                  {typeof cell === "number" ? formatNumber(cell) : String(cell ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
