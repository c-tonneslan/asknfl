// Column descriptions for the text-to-SQL prompt. Trimmed from the 372-column
// nflfastR play-by-play to the ~50 most-asked fields so the model has every
// signal it needs without drowning in metadata. Data covers the 2020-2025
// seasons; `season` distinguishes them.

export const TABLE_NAME = "pbp";

export const SCHEMA_LINES: { col: string; type: string; desc: string }[] = [
  { col: "season", type: "INTEGER", desc: "NFL season year, 2020 through 2025" },
  { col: "play_id", type: "BIGINT", desc: "Unique play id within a game" },
  { col: "game_id", type: "VARCHAR", desc: "Game id, e.g. 2023_01_DET_KC" },
  { col: "home_team", type: "VARCHAR", desc: "Home team 3-letter code" },
  { col: "away_team", type: "VARCHAR", desc: "Away team 3-letter code" },
  { col: "week", type: "INTEGER", desc: "Week 1-18 regular, 19-22 playoffs" },
  { col: "season_type", type: "VARCHAR", desc: "'REG' or 'POST'" },
  { col: "posteam", type: "VARCHAR", desc: "Team with the ball" },
  { col: "defteam", type: "VARCHAR", desc: "Team on defense" },
  { col: "yardline_100", type: "INTEGER", desc: "Yards to the end zone (1-99)" },
  { col: "qtr", type: "INTEGER", desc: "Quarter, 1-4 (5 = OT)" },
  { col: "down", type: "INTEGER", desc: "1-4, NULL on kickoffs/extra points" },
  { col: "ydstogo", type: "INTEGER", desc: "Yards needed for first down" },
  { col: "goal_to_go", type: "BOOLEAN", desc: "True when 1st down would be a TD" },
  { col: "game_seconds_remaining", type: "INTEGER", desc: "0 = game end, 3600 = kickoff" },
  { col: "play_type", type: "VARCHAR", desc: "pass, run, punt, field_goal, kickoff, extra_point, qb_kneel, qb_spike, no_play" },
  { col: "desc", type: "VARCHAR", desc: "Free-text play description" },
  { col: "yards_gained", type: "INTEGER", desc: "Net yards on the play" },
  { col: "pass_length", type: "VARCHAR", desc: "'short' or 'deep' on pass plays" },
  { col: "pass_location", type: "VARCHAR", desc: "'left', 'middle', 'right' on pass plays" },
  { col: "air_yards", type: "INTEGER", desc: "Yards in the air before catch" },
  { col: "yards_after_catch", type: "INTEGER", desc: "YAC, NULL on incompletions" },
  { col: "run_location", type: "VARCHAR", desc: "'left', 'middle', 'right' on runs" },
  { col: "run_gap", type: "VARCHAR", desc: "'guard', 'tackle', 'end' on runs" },
  { col: "shotgun", type: "BOOLEAN", desc: "Snap from shotgun" },
  { col: "no_huddle", type: "BOOLEAN", desc: "Snap with no huddle" },
  { col: "qb_scramble", type: "BOOLEAN", desc: "QB scramble" },
  { col: "field_goal_result", type: "VARCHAR", desc: "'made', 'missed', 'blocked'" },
  { col: "kick_distance", type: "INTEGER", desc: "Field goal or punt distance" },
  { col: "extra_point_result", type: "VARCHAR", desc: "'good', 'failed', 'blocked', 'aborted'" },
  { col: "two_point_conv_result", type: "VARCHAR", desc: "'success' or 'failure'" },
  { col: "sack", type: "BOOLEAN", desc: "Sack on the play" },
  { col: "interception", type: "BOOLEAN", desc: "Pass intercepted" },
  { col: "fumble", type: "BOOLEAN", desc: "Ball fumbled" },
  { col: "fumble_lost", type: "BOOLEAN", desc: "Fumble recovered by defense" },
  { col: "touchdown", type: "BOOLEAN", desc: "Any kind of TD" },
  { col: "pass_touchdown", type: "BOOLEAN", desc: "Passing TD" },
  { col: "rush_touchdown", type: "BOOLEAN", desc: "Rushing TD" },
  { col: "penalty", type: "BOOLEAN", desc: "Penalty called on this play" },
  { col: "penalty_team", type: "VARCHAR", desc: "Team that committed the penalty" },
  { col: "penalty_type", type: "VARCHAR", desc: "Penalty name (e.g. 'Holding')" },
  { col: "penalty_yards", type: "INTEGER", desc: "Penalty yardage" },
  { col: "passer_player_name", type: "VARCHAR", desc: "Passer name, e.g. 'P.Mahomes'" },
  { col: "rusher_player_name", type: "VARCHAR", desc: "Rusher name" },
  { col: "receiver_player_name", type: "VARCHAR", desc: "Targeted receiver" },
  { col: "epa", type: "DOUBLE", desc: "Expected points added on this play" },
  { col: "wpa", type: "DOUBLE", desc: "Win probability added" },
  { col: "cpoe", type: "DOUBLE", desc: "Completion percent over expected (pass)" },
  { col: "success", type: "BOOLEAN", desc: "Successful play (EPA > 0)" },
  { col: "first_down", type: "BOOLEAN", desc: "Play resulted in a first down" },
  { col: "posteam_score", type: "INTEGER", desc: "Offense score at snap" },
  { col: "defteam_score", type: "INTEGER", desc: "Defense score at snap" },
  { col: "score_differential", type: "INTEGER", desc: "posteam_score - defteam_score at snap" },
  { col: "wp", type: "DOUBLE", desc: "Win probability for posteam at snap" },
];

export function schemaPrompt(): string {
  const lines = SCHEMA_LINES.map(
    (s) => `  ${s.col.padEnd(28)} ${s.type.padEnd(10)} -- ${s.desc}`,
  ).join("\n");
  return `CREATE TABLE ${TABLE_NAME} (\n${lines}\n);`;
}
