import { describe, it, expect } from "vitest";
import {
  fantasyPoints,
  buildBoard,
  optimalRoster,
  DEFAULT_LEAGUE,
  type PlayerSeason,
  type Position,
} from "./fantasy";

function season(
  playerId: string,
  pos: Position,
  yr: number,
  over: Partial<PlayerSeason> = {},
): PlayerSeason {
  return {
    playerId,
    player: playerId,
    pos,
    season: yr,
    games: 16,
    passYd: 0, passTd: 0, ints: 0,
    rushYd: 0, rushTd: 0,
    rec: 0, recYd: 0, recTd: 0,
    twoPt: 0, fumLost: 0, targetShare: 0,
    ...over,
  };
}

describe("fantasyPoints", () => {
  it("scores receptions by format", () => {
    const wr = season("x", "WR", 2024, { recYd: 100, rec: 10, recTd: 1 });
    expect(fantasyPoints(wr, "ppr")).toBeCloseTo(26, 5); // 10 + 10 + 6
    expect(fantasyPoints(wr, "half")).toBeCloseTo(21, 5); // 10 + 5 + 6
    expect(fantasyPoints(wr, "std")).toBeCloseTo(16, 5); // 10 + 0 + 6
  });

  it("scores passing with the interception penalty", () => {
    const qb = season("q", "QB", 2024, { passYd: 300, passTd: 3, ints: 1 });
    // 0.04*300 + 4*3 - 2*1 = 12 + 12 - 2
    expect(fantasyPoints(qb, "ppr")).toBeCloseTo(22, 5);
  });
});

describe("buildBoard", () => {
  const seasons: PlayerSeason[] = [
    // A rising WR: better every year -> projection weighted to recent.
    season("rise", "WR", 2022, { recYd: 800, rec: 60, recTd: 4 }),
    season("rise", "WR", 2023, { recYd: 1100, rec: 90, recTd: 8 }),
    season("rise", "WR", 2024, { recYd: 1500, rec: 110, recTd: 12 }),
    // A fading WR.
    season("fade", "WR", 2022, { recYd: 1400, rec: 100, recTd: 10 }),
    season("fade", "WR", 2023, { recYd: 900, rec: 70, recTd: 5 }),
    season("fade", "WR", 2024, { recYd: 500, rec: 40, recTd: 2 }),
    // Filler WRs so replacement level is meaningful.
    ...Array.from({ length: 40 }, (_, i) =>
      season(`wr${i}`, "WR", 2024, { recYd: 300 + i * 10, rec: 25 + i, recTd: 1 }),
    ),
  ];

  it("projects the next season and weights recency", () => {
    const { projectFor, board } = buildBoard(seasons, "ppr");
    expect(projectFor).toBe(2025);
    const rise = board.find((p) => p.playerId === "rise")!;
    const fade = board.find((p) => p.playerId === "fade")!;
    // Both averaged the same three-year total, but recency weighting should
    // project the riser well above the fader.
    expect(rise.projPoints).toBeGreaterThan(fade.projPoints);
  });

  it("gives the top player positive VOR and replacement-level ~0", () => {
    const { board } = buildBoard(seasons, "ppr");
    expect(board[0].vor).toBeGreaterThan(0);
    // Someone near the bottom of startable WRs sits around replacement.
    const minVor = Math.min(...board.map((p) => p.vor));
    expect(minVor).toBeLessThanOrEqual(0);
  });

  it("assigns auction dollars only to positive-VOR players and stays within budget", () => {
    const { board } = buildBoard(seasons, "ppr");
    expect(board[0].auction).toBeGreaterThan(1);
    for (const p of board) expect(p.auction).toBeGreaterThanOrEqual(0);
    const spent = board.reduce((s, p) => s + p.auction, 0);
    expect(spent).toBeLessThanOrEqual(DEFAULT_LEAGUE.teams * DEFAULT_LEAGUE.budget);
  });
});

describe("optimalRoster", () => {
  it("fills every starting slot without reusing a player", () => {
    const seasons: PlayerSeason[] = [
      ...["QB", "RB", "WR", "TE"].flatMap((pos) =>
        Array.from({ length: 30 }, (_, i) =>
          season(`${pos}${i}`, pos as Position, 2024, { rushYd: 500 + i * 20, rushTd: i, recYd: pos === "WR" ? 800 : 0, rec: pos === "WR" ? 60 : 0 }),
        ),
      ),
    ];
    const { board } = buildBoard(seasons, "ppr");
    const { slots, total } = optimalRoster(board, DEFAULT_LEAGUE);
    // 1 QB + 2 RB + 2 WR + 1 TE + 1 FLEX = 7 slots
    expect(slots).toHaveLength(7);
    const filled = slots.filter((s) => s.player).map((s) => s.player!.playerId);
    expect(new Set(filled).size).toBe(filled.length); // no duplicates
    expect(total).toBeGreaterThan(0);
  });
});
