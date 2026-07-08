// Pure formatting + result-shape helpers shared by the Q&A view, the charts,
// and the dashboards. No React here.

// Whole numbers get thousands separators; fractional values keep up to 3
// decimals (trailing zeros trimmed) so EPA-style metrics stay readable.
export function formatNumber(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return v.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
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
  rz: "Red Zone",
  pct: "%",
};

export function humanizeColumn(c: string): string {
  if (COLUMN_LABELS[c]) return COLUMN_LABELS[c];
  return c
    .split("_")
    .map((w) => COLUMN_LABELS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// nflverse 3-letter team code -> primary color, for coloring bars/points/lines.
export const TEAM_COLORS: Record<string, string> = {
  ARI: "#97233F", ATL: "#A71930", BAL: "#241773", BUF: "#00338D",
  CAR: "#0085CA", CHI: "#0B162A", CIN: "#FB4F14", CLE: "#311D00",
  DAL: "#003594", DEN: "#FB4F14", DET: "#0076B6", GB: "#203731",
  HOU: "#03202F", IND: "#002C5F", JAX: "#006778", KC: "#E31837",
  LA: "#003594", LAC: "#0080C6", LV: "#000000", MIA: "#008E97",
  MIN: "#4F2683", NE: "#002244", NO: "#D3BC8D", NYG: "#0B2265",
  NYJ: "#125740", PHI: "#004C54", PIT: "#FFB612", SEA: "#002244",
  SF: "#AA0000", TB: "#D50A0A", TEN: "#0C2340", WAS: "#5A1414",
};

export function teamColor(label: unknown): string | null {
  if (typeof label !== "string") return null;
  return TEAM_COLORS[label.toUpperCase()] ?? null;
}

export function firstDefined(rows: unknown[][], j: number): unknown {
  return rows.find((r) => r[j] !== null && r[j] !== undefined)?.[j];
}

// Which columns are numeric (by their first non-null value).
export function numericColumns(columns: string[], rows: unknown[][]): boolean[] {
  return columns.map((_, j) => typeof firstDefined(rows, j) === "number");
}

// Columns whose name reads like an ordinal x-axis we'd plot a trend over.
const AXIS_COLS = new Set(["season", "week", "qtr", "down", "year"]);

export type ChartKind = "line" | "scatter" | "bar" | null;

// Pick the most honest chart for a result shape. Order matters:
//  - an ordinal axis (season/week) + numeric(s)  -> line (trend)
//  - a label + two numerics                      -> scatter (relationship)
//  - a label + one numeric, few rows             -> bar (ranking)
export function detectChart(columns: string[], rows: unknown[][]): ChartKind {
  if (rows.length < 2) return null;
  const numeric = numericColumns(columns, rows);
  const numericIdx = numeric.flatMap((n, j) => (n ? [j] : []));
  const labelIdx = numeric.flatMap((n, j) => (!n ? [j] : []));

  const axisIdx = columns.findIndex(
    (c, j) => numeric[j] && AXIS_COLS.has(c.toLowerCase()),
  );
  if (axisIdx !== -1 && numericIdx.some((j) => j !== axisIdx) && rows.length <= 40) {
    return "line";
  }
  if (labelIdx.length >= 1 && numericIdx.length >= 2 && rows.length <= 200) {
    return "scatter";
  }
  if (labelIdx.length >= 1 && numericIdx.length >= 1 && rows.length <= 30) {
    return "bar";
  }
  return null;
}
