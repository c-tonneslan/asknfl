// Fantasy projection + valuation engine. Pure and deterministic so it can be
// unit-tested and run in the browser. The methodology is intentionally
// transparent (no black box):
//   1. Fantasy points per player-season from raw stat components (format toggle).
//   2. Project next season's points-per-game as a recency-weighted average of a
//      player's last few seasons, shrunk toward a positional prior (empirical-
//      Bayes regression to the mean) by sample size.
//   3. Project games (durability) from recent availability, clamped.
//   4. Value over replacement (VOR / VBD) for cross-position value, then convert
//      to auction dollars and a greedy optimal starting roster.

export type Position = "QB" | "RB" | "WR" | "TE";
export type Format = "ppr" | "half" | "std";

export const FORMAT_LABELS: Record<Format, string> = {
  ppr: "PPR",
  half: "Half-PPR",
  std: "Standard",
};

const RECEPTION_PT: Record<Format, number> = { ppr: 1, half: 0.5, std: 0 };

// One player's aggregated stats for a single season.
export interface PlayerSeason {
  playerId: string;
  player: string;
  pos: Position;
  season: number;
  games: number;
  passYd: number;
  passTd: number;
  ints: number;
  rushYd: number;
  rushTd: number;
  rec: number;
  recYd: number;
  recTd: number;
  twoPt: number;
  fumLost: number;
  targetShare: number; // 0..1, averaged over games
}

export function fantasyPoints(s: PlayerSeason, fmt: Format): number {
  return (
    0.04 * s.passYd +
    4 * s.passTd -
    2 * s.ints +
    0.1 * s.rushYd +
    6 * s.rushTd +
    0.1 * s.recYd +
    6 * s.recTd +
    RECEPTION_PT[fmt] * s.rec +
    2 * s.twoPt -
    2 * s.fumLost
  );
}

export interface LeagueSettings {
  teams: number;
  budget: number; // auction dollars per team
  starters: Record<Position, number>;
  flexSlots: number; // RB/WR/TE-eligible flex spots per team
  benchPerTeam: number;
}

export const DEFAULT_LEAGUE: LeagueSettings = {
  teams: 12,
  budget: 200,
  starters: { QB: 1, RB: 2, WR: 2, TE: 1 },
  flexSlots: 1,
  benchPerTeam: 6,
};

// How flex spots split across positions (typical usage).
const FLEX_SHARE: Record<Position, number> = { QB: 0, RB: 0.4, WR: 0.45, TE: 0.15 };

export interface SeasonLine {
  season: number;
  games: number;
  points: number;
  ppg: number;
}

export interface Projection {
  playerId: string;
  player: string;
  pos: Position;
  projPPG: number;
  projGames: number;
  projPoints: number;
  posRank: number;
  vor: number; // value over replacement (points)
  auction: number; // estimated auction dollars
  sampleGames: number; // games behind the projection
  history: SeasonLine[]; // recent seasons, oldest -> newest
}

const RECENCY_WEIGHT = [1, 2, 3]; // oldest -> newest of the window
const WINDOW = 3;
const SHRINK_K = 10; // "games" of prior mixed into every projection

// Build the full draft board: projections + VOR + auction values, ranked.
export function buildBoard(
  seasons: PlayerSeason[],
  format: Format,
  league: LeagueSettings = DEFAULT_LEAGUE,
): { projectFor: number; board: Projection[]; replacement: Record<Position, number> } {
  const latest = Math.max(...seasons.map((s) => s.season));
  const projectFor = latest + 1;
  const windowSeasons = new Set(
    Array.from({ length: WINDOW }, (_, i) => latest - i),
  );

  // Group a player's in-window seasons.
  const byPlayer = new Map<string, PlayerSeason[]>();
  for (const s of seasons) {
    if (!windowSeasons.has(s.season)) continue;
    if (!byPlayer.has(s.playerId)) byPlayer.set(s.playerId, []);
    byPlayer.get(s.playerId)!.push(s);
  }

  // First pass: raw recency-weighted PPG + projected games (no shrinkage yet).
  type Raw = {
    playerId: string; player: string; pos: Position;
    rawPPG: number; projGames: number; sampleGames: number; history: SeasonLine[];
  };
  const raws: Raw[] = [];
  for (const [playerId, list] of byPlayer) {
    list.sort((a, b) => a.season - b.season);
    const history: SeasonLine[] = list.map((s) => {
      const points = fantasyPoints(s, format);
      return { season: s.season, games: s.games, points, ppg: s.games ? points / s.games : 0 };
    });
    let wPPG = 0, wGames = 0, wSum = 0, sampleGames = 0;
    for (const h of history) {
      const w = RECENCY_WEIGHT[Math.max(0, WINDOW - 1 - (latest - h.season))];
      wPPG += w * h.ppg;
      wGames += w * h.games;
      wSum += w;
      sampleGames += h.games;
    }
    const rawPPG = wSum ? wPPG / wSum : 0;
    const projGames = clamp(wSum ? wGames / wSum : 0, 8, 17);
    raws.push({
      playerId,
      player: list[list.length - 1].player,
      pos: list[list.length - 1].pos,
      rawPPG,
      projGames,
      sampleGames,
      history,
    });
  }

  // Positional prior = median raw PPG among rotation-level players (>= 8 sample
  // games) at the position. Small-sample players get pulled toward it.
  const priorByPos = {} as Record<Position, number>;
  for (const pos of ["QB", "RB", "WR", "TE"] as Position[]) {
    const ppgs = raws.filter((r) => r.pos === pos && r.sampleGames >= 8).map((r) => r.rawPPG);
    priorByPos[pos] = median(ppgs);
  }

  // Second pass: shrink PPG toward the prior, compute projected points.
  const projections: Projection[] = raws.map((r) => {
    const n = r.sampleGames;
    const projPPG = (n * r.rawPPG + SHRINK_K * priorByPos[r.pos]) / (n + SHRINK_K);
    const projPoints = projPPG * r.projGames;
    return {
      playerId: r.playerId, player: r.player, pos: r.pos,
      projPPG, projGames: r.projGames, projPoints,
      posRank: 0, vor: 0, auction: 0, sampleGames: n, history: r.history,
    };
  });

  // Replacement level per position (VBD baseline: last startable player).
  const replacement = replacementLevels(projections, league);

  // Rank within position + VOR.
  for (const pos of ["QB", "RB", "WR", "TE"] as Position[]) {
    const group = projections.filter((p) => p.pos === pos).sort((a, b) => b.projPoints - a.projPoints);
    group.forEach((p, i) => {
      p.posRank = i + 1;
      p.vor = p.projPoints - replacement[pos];
    });
  }

  assignAuctionValues(projections, league);
  projections.sort((a, b) => b.vor - a.vor);
  return { projectFor, board: projections, replacement };
}

// Baseline rank per position (starters + a share of flex), then the projected
// points of the player at that rank is "replacement level".
export function replacementLevels(
  projections: Projection[],
  league: LeagueSettings,
): Record<Position, number> {
  const out = {} as Record<Position, number>;
  for (const pos of ["QB", "RB", "WR", "TE"] as Position[]) {
    const baseline = Math.round(
      league.teams * (league.starters[pos] + FLEX_SHARE[pos] * league.flexSlots),
    );
    const ranked = projections
      .filter((p) => p.pos === pos)
      .sort((a, b) => b.projPoints - a.projPoints);
    const idx = Math.min(baseline, ranked.length) - 1;
    out[pos] = idx >= 0 && ranked[idx] ? ranked[idx].projPoints : 0;
  }
  return out;
}

// Convert VOR to auction dollars: the league's spendable money above the $1
// minimum per roster spot is distributed in proportion to positive VOR.
function assignAuctionValues(projections: Projection[], league: LeagueSettings): void {
  const rosterSpots =
    league.starters.QB + league.starters.RB + league.starters.WR + league.starters.TE +
    league.flexSlots + league.benchPerTeam;
  const draftablePool = league.teams * rosterSpots;
  const positive = projections
    .filter((p) => p.vor > 0)
    .sort((a, b) => b.vor - a.vor)
    .slice(0, draftablePool);
  const totalVor = positive.reduce((s, p) => s + p.vor, 0);
  const totalBudget = league.teams * league.budget;
  const spendable = totalBudget - draftablePool; // reserve $1 per drafted spot
  const perVor = totalVor > 0 ? spendable / totalVor : 0;
  const pool = new Set(positive.map((p) => p.playerId));
  for (const p of projections) {
    p.auction = pool.has(p.playerId) ? Math.max(1, Math.round(1 + p.vor * perVor)) : 0;
  }
}

// Greedy optimal starting lineup by VOR (fill required slots, then flex).
export interface RosterSlot { slot: string; player: Projection | null }
export function optimalRoster(board: Projection[], league: LeagueSettings): {
  slots: RosterSlot[]; total: number;
} {
  const taken = new Set<string>();
  const slots: RosterSlot[] = [];
  const bestAvailable = (positions: Position[]) =>
    board
      .filter((p) => positions.includes(p.pos) && !taken.has(p.playerId))
      .sort((a, b) => b.projPoints - a.projPoints)[0] ?? null;

  const fill = (label: string, positions: Position[]) => {
    const p = bestAvailable(positions);
    if (p) taken.add(p.playerId);
    slots.push({ slot: label, player: p });
  };

  for (const pos of ["QB", "RB", "WR", "TE"] as Position[]) {
    for (let i = 0; i < league.starters[pos]; i++) fill(pos, [pos]);
  }
  for (let i = 0; i < league.flexSlots; i++) fill("FLEX", ["RB", "WR", "TE"]);

  const total = slots.reduce((s, x) => s + (x.player?.projPoints ?? 0), 0);
  return { slots, total };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
