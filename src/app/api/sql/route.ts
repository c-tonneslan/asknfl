import { schemaPrompt, TABLE_NAME } from "@/lib/schema";
import { validateGeneratedSql } from "@/lib/sql-validate";
import { rateLimited, clientIp } from "@/lib/rate-limit";
import { chat, hasLlmKey } from "@/lib/llm";

export const runtime = "nodejs";

const SYSTEM = `You translate plain-English questions about NFL play-by-play data into a single DuckDB SQL query.

Schema (one table called ${TABLE_NAME}):

${schemaPrompt()}

Rules:
- Output exactly one SELECT statement. No prose, no Markdown fences, no semicolons.
- One table only; refer to it as ${TABLE_NAME}. No CTEs unless the question genuinely needs them.
- Use FILTER (WHERE ...) or CASE WHEN ... for conditional aggregations. Prefer COUNT(*), SUM, AVG, ARG_MAX over window functions where possible.
- Round floats to 3 decimal places.
- Cap rows: always include LIMIT 100 unless the question asks for a single row.
- Cast text columns with LOWER() before comparing to avoid case mismatches on team codes (the data is already uppercase, but be defensive).
- ydstogo, yards_gained, score_differential can be negative; do not coerce.
- The BOOLEAN flag columns (touchdown, pass_touchdown, rush_touchdown, sack, interception, fumble, fumble_lost, first_down, success, shotgun, no_huddle, qb_scramble, penalty, goal_to_go) are real booleans: filter with WHERE col (or col = TRUE) and count with COUNT(*) FILTER (WHERE col). Never SUM() a boolean — you cannot sum a boolean in DuckDB.
- A "scoring play" means touchdown OR field_goal_result = 'made' OR (extra_point_result = 'good' AND play_type = 'extra_point') OR two_point_conv_result = 'success'.
- "Red zone" is yardline_100 <= 20. "Goal-to-go" already has its own column.
- "Long" 3rd down means down = 3 AND ydstogo >= 7. "Short" means ydstogo <= 2.
- "Garbage time" is abs(score_differential) >= 17 in the 4th quarter.
- The data covers the 2023 NFL season only (regular and postseason). Don't claim anything about other years.

If the question is ambiguous, pick the most charitable single SQL query and return it. Do not ask follow-up questions.`;

const examples = [
  {
    q: "Most passing TDs in the red zone",
    sql: `SELECT passer_player_name, COUNT(*) AS red_zone_pass_tds\nFROM ${TABLE_NAME}\nWHERE play_type = 'pass'\n  AND pass_touchdown = TRUE\n  AND yardline_100 <= 20\nGROUP BY passer_player_name\nORDER BY red_zone_pass_tds DESC\nLIMIT 100`,
  },
  {
    q: "Average EPA on 3rd-and-long this season",
    sql: `SELECT ROUND(AVG(epa), 3) AS avg_epa\nFROM ${TABLE_NAME}\nWHERE down = 3 AND ydstogo >= 7`,
  },
  {
    q: "Eagles vs Cowboys: total yards on the ground",
    sql: `SELECT posteam, SUM(yards_gained) AS rush_yards\nFROM ${TABLE_NAME}\nWHERE play_type = 'run'\n  AND ((posteam = 'PHI' AND defteam = 'DAL') OR (posteam = 'DAL' AND defteam = 'PHI'))\nGROUP BY posteam\nORDER BY rush_yards DESC`,
  },
];

function exampleBlock(): string {
  return examples
    .map((e) => `Q: ${e.q}\nSQL:\n${e.sql}`)
    .join("\n\n");
}

export async function POST(req: Request) {
  if (!hasLlmKey()) {
    return Response.json(
      { error: "Server missing GROQ_API_KEY" },
      { status: 500 },
    );
  }

  if (rateLimited(clientIp(req))) {
    return Response.json({ error: "Too many requests. Try again in a moment." }, { status: 429 });
  }

  let body: { question?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (typeof body.question !== "string") {
    return Response.json({ error: "'question' must be a string" }, { status: 400 });
  }
  const question = body.question.trim();
  if (!question) {
    return Response.json({ error: "Missing 'question'" }, { status: 400 });
  }
  if (question.length > 500) {
    return Response.json(
      { error: "Keep questions under 500 characters" },
      { status: 400 },
    );
  }

  let res;
  try {
    res = await chat({
      system: SYSTEM,
      user: `Here are a few good examples:\n\n${exampleBlock()}\n\nNow answer this one. Return only the SQL.\n\nQ: ${question}\nSQL:`,
      maxTokens: 600,
    });
  } catch (e) {
    return Response.json(
      { error: `Model call failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  if (!res.text) {
    return Response.json({ error: "No text response" }, { status: 502 });
  }
  let sql = res.text;

  // Strip the occasional fence + trailing semicolon
  sql = sql.replace(/^```(?:sql)?\s*/i, "").replace(/```\s*$/i, "").trim();
  sql = sql.replace(/;+\s*$/, "").trim();

  const v = validateGeneratedSql(sql);
  if (!v.ok) {
    return Response.json(
      { error: `Generated SQL was rejected (${v.reason}). Try rewording the question.` },
      { status: 502 },
    );
  }
  sql = v.sql;

  return Response.json({
    sql,
    usage: {
      input_tokens: res.usage.input,
      output_tokens: res.usage.output,
      cache_read_input_tokens: res.usage.cache,
    },
  });
}
