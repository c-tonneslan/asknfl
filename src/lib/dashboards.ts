// Curated analytics dashboards. Each panel is a fixed, hand-written SQL query
// run client-side in DuckDB-WASM — deterministic, instant, and free (no LLM in
// the loop). The `Ask` tab is for open questions; this is the guided view.

export type Viz = "kpi" | "bar" | "line" | "scatter" | "table";

export interface Params {
  season: number;
  team: string;
}

export interface Panel {
  id: string;
  title: string;
  viz: Viz;
  span?: 1 | 2; // grid columns on wide screens
  note?: string;
  sql: (p: Params) => string;
}

export interface Dashboard {
  id: string;
  title: string;
  description: string;
  controls: Array<"season" | "team">;
  panels: Panel[];
}

export const SEASONS = [2025, 2024, 2023, 2022, 2021, 2020];

export const TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET",
  "GB", "HOU", "IND", "JAX", "KC", "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO",
  "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
];

// Offense/defense plays we treat as "scrimmage" for rate stats.
const SCRIMMAGE = "play_type IN ('pass','run')";

export const DASHBOARDS: Dashboard[] = [
  {
    id: "leaderboards",
    title: "Season Leaderboards",
    description: "The season's statistical leaders and the offense-vs-defense landscape.",
    controls: ["season"],
    panels: [
      {
        id: "kpi",
        title: "Season at a glance",
        viz: "kpi",
        span: 2,
        sql: ({ season }) => `
          SELECT
            COUNT(DISTINCT game_id) AS games,
            COUNT(*) AS plays,
            COUNT(*) FILTER (WHERE touchdown) AS touchdowns,
            ROUND(AVG(epa) FILTER (WHERE ${SCRIMMAGE}), 3) AS epa_per_play,
            ROUND(100.0 * COUNT(*) FILTER (WHERE play_type = 'pass')
              / NULLIF(COUNT(*) FILTER (WHERE ${SCRIMMAGE}), 0), 1) AS pass_rate_pct,
            ROUND(AVG(yards_gained) FILTER (WHERE ${SCRIMMAGE}), 2) AS yards_per_play
          FROM pbp WHERE season = ${season}`,
      },
      {
        id: "epa-landscape",
        title: "Offense vs defense (EPA per play)",
        viz: "scatter",
        span: 2,
        note: "Up and to the right is good offense and stingy defense. Defense axis is flipped so higher = better.",
        sql: ({ season }) => `
          SELECT o.team, o.off_epa, ROUND(-d.def_epa, 3) AS def_epa_saved
          FROM (
            SELECT posteam AS team, ROUND(AVG(epa), 3) AS off_epa
            FROM pbp WHERE season = ${season} AND posteam IS NOT NULL AND ${SCRIMMAGE}
            GROUP BY 1
          ) o
          JOIN (
            SELECT defteam AS team, ROUND(AVG(epa), 3) AS def_epa
            FROM pbp WHERE season = ${season} AND defteam IS NOT NULL AND ${SCRIMMAGE}
            GROUP BY 1
          ) d ON o.team = d.team`,
      },
      {
        id: "pass-yards",
        title: "Passing yards",
        viz: "bar",
        sql: ({ season }) => `
          SELECT passer_player_name AS player, SUM(yards_gained) AS passing_yards
          FROM pbp WHERE season = ${season} AND play_type = 'pass' AND passer_player_name IS NOT NULL
          GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      },
      {
        id: "rush-yards",
        title: "Rushing yards",
        viz: "bar",
        sql: ({ season }) => `
          SELECT rusher_player_name AS player, SUM(yards_gained) AS rushing_yards
          FROM pbp WHERE season = ${season} AND play_type = 'run' AND rusher_player_name IS NOT NULL
          GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      },
      {
        id: "rec-yards",
        title: "Receiving yards",
        viz: "bar",
        sql: ({ season }) => `
          SELECT receiver_player_name AS player, SUM(yards_gained) AS receiving_yards
          FROM pbp WHERE season = ${season} AND play_type = 'pass' AND receiver_player_name IS NOT NULL
          GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      },
      {
        id: "td-passes",
        title: "Touchdown passes",
        viz: "bar",
        sql: ({ season }) => `
          SELECT passer_player_name AS player, COUNT(*) FILTER (WHERE pass_touchdown) AS td_passes
          FROM pbp WHERE season = ${season} AND play_type = 'pass' AND passer_player_name IS NOT NULL
          GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      },
    ],
  },
  {
    id: "team",
    title: "Team Profile",
    description: "One team's season: efficiency, week-by-week form, and top skill players.",
    controls: ["season", "team"],
    panels: [
      {
        id: "kpi",
        title: "Efficiency",
        viz: "kpi",
        span: 2,
        sql: ({ season, team }) => `
          SELECT
            ROUND(AVG(epa) FILTER (WHERE posteam = '${team}' AND ${SCRIMMAGE}), 3) AS off_epa,
            ROUND(AVG(epa) FILTER (WHERE defteam = '${team}' AND ${SCRIMMAGE}), 3) AS def_epa,
            ROUND(100.0 * COUNT(*) FILTER (WHERE posteam = '${team}' AND play_type = 'pass')
              / NULLIF(COUNT(*) FILTER (WHERE posteam = '${team}' AND ${SCRIMMAGE}), 0), 1) AS pass_rate_pct,
            ROUND(100.0 * COUNT(*) FILTER (WHERE posteam = '${team}' AND down = 3 AND first_down)
              / NULLIF(COUNT(*) FILTER (WHERE posteam = '${team}' AND down = 3 AND ${SCRIMMAGE}), 0), 1) AS third_down_pct,
            ROUND(100.0 * COUNT(*) FILTER (WHERE posteam = '${team}' AND yardline_100 <= 20 AND touchdown)
              / NULLIF(COUNT(*) FILTER (WHERE posteam = '${team}' AND yardline_100 <= 20 AND ${SCRIMMAGE}), 0), 1) AS rz_td_pct,
            COUNT(*) FILTER (WHERE (posteam = '${team}' OR defteam = '${team}')) AS plays
          FROM pbp WHERE season = ${season}`,
      },
      {
        id: "weekly-epa",
        title: "Offensive EPA per play, by week",
        viz: "line",
        span: 2,
        sql: ({ season, team }) => `
          SELECT week, ROUND(AVG(epa), 3) AS off_epa
          FROM pbp WHERE season = ${season} AND posteam = '${team}' AND ${SCRIMMAGE}
          GROUP BY week ORDER BY week`,
      },
      {
        id: "top-receivers",
        title: "Top receivers",
        viz: "bar",
        sql: ({ season, team }) => `
          SELECT receiver_player_name AS player, SUM(yards_gained) AS receiving_yards
          FROM pbp WHERE season = ${season} AND posteam = '${team}' AND play_type = 'pass' AND receiver_player_name IS NOT NULL
          GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      },
      {
        id: "top-rushers",
        title: "Top rushers",
        viz: "bar",
        sql: ({ season, team }) => `
          SELECT rusher_player_name AS player, SUM(yards_gained) AS rushing_yards
          FROM pbp WHERE season = ${season} AND posteam = '${team}' AND play_type = 'run' AND rusher_player_name IS NOT NULL
          GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      },
    ],
  },
  {
    id: "trends",
    title: "League Trends",
    description: "How the NFL has changed across the 2020-2025 seasons.",
    controls: [],
    panels: [
      {
        id: "epa",
        title: "EPA per play",
        viz: "line",
        sql: () => `
          SELECT season, ROUND(AVG(epa), 3) AS epa_per_play
          FROM pbp WHERE ${SCRIMMAGE} GROUP BY season ORDER BY season`,
      },
      {
        id: "pass-rate",
        title: "Pass rate",
        viz: "line",
        sql: () => `
          SELECT season, ROUND(100.0 * COUNT(*) FILTER (WHERE play_type = 'pass')
            / NULLIF(COUNT(*) FILTER (WHERE ${SCRIMMAGE}), 0), 1) AS pass_rate_pct
          FROM pbp GROUP BY season ORDER BY season`,
      },
      {
        id: "ypp",
        title: "Yards per play",
        viz: "line",
        sql: () => `
          SELECT season, ROUND(AVG(yards_gained) FILTER (WHERE ${SCRIMMAGE}), 2) AS yards_per_play
          FROM pbp GROUP BY season ORDER BY season`,
      },
      {
        id: "scoring",
        title: "Touchdowns per game",
        viz: "line",
        sql: () => `
          SELECT season, ROUND(1.0 * COUNT(*) FILTER (WHERE touchdown) / COUNT(DISTINCT game_id), 2) AS tds_per_game
          FROM pbp GROUP BY season ORDER BY season`,
      },
    ],
  },
];
