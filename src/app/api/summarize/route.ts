import { rateLimited, clientIp } from "@/lib/rate-limit";
import { parseSummary } from "@/lib/summary-parse";
import { chat, hasLlmKey } from "@/lib/llm";

export const runtime = "nodejs";

const SYSTEM = `You write a one-sentence summary of a DuckDB result set for an NFL question, then suggest a few natural follow-up questions.

Output format (exactly this shape):
- First, the one-sentence summary.
- Then a line containing only three dashes: ---
- Then up to 3 follow-up questions, one per line, no numbering or bullets.

Summary rules:
- One sentence. Maximum 30 words.
- Lead with the headline number or the top player/team. Mention the metric in plain English (passing yards, EPA per play, etc.), not the column name.
- Don't restate the question or hedge ("based on the results...", "looks like...").
- Don't make up numbers that aren't in the rows. If the result is empty, say so.
- The data covers the 2020-2025 NFL seasons (regular + post). If a season is in the rows or implied by the question, name it; don't claim anything outside 2020-2025.

Follow-up rules:
- Each must be answerable from the same 2020-2025 play-by-play data (season, down/distance, teams, players, EPA/CPOE/WPA, play type, penalties, score state). Comparing across seasons is a great follow-up.
- Make them a natural next step: drill into a player or team from the result, change the filter, or compare.
- Short and plain-English, like something a fan would type. No numbering.

No Markdown anywhere. Plain text.`;

interface Body {
  question?: string;
  sql?: string;
  columns?: string[];
  rows?: unknown[][];
}

// Cap rows before sending to the model. The headline summary only needs the
// top few, and bigger payloads invite hallucinated trailing rows.
const MAX_ROWS = 20;

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

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (typeof body.question !== "string" || typeof body.sql !== "string") {
    return Response.json({ error: "'question' and 'sql' must be strings" }, { status: 400 });
  }
  const question = body.question.trim();
  const sql = body.sql.trim();
  const columns = Array.isArray(body.columns) ? body.columns.slice(0, 60) : [];
  const rows = Array.isArray(body.rows) ? body.rows : [];

  if (!question || !sql) {
    return Response.json(
      { error: "Missing 'question' or 'sql'" },
      { status: 400 },
    );
  }
  if (question.length > 500 || sql.length > 8000) {
    return Response.json({ error: "Input too large" }, { status: 400 });
  }

  const trimmed = rows.slice(0, MAX_ROWS);
  const tableText =
    rows.length === 0
      ? "(no rows)"
      : [
          columns.join("\t"),
          ...trimmed.map((r) => r.map(stringify).join("\t")),
          rows.length > MAX_ROWS ? `... ${rows.length - MAX_ROWS} more rows` : "",
        ]
          .filter(Boolean)
          .join("\n");

  let res;
  try {
    res = await chat({
      system: SYSTEM,
      user: `Question: ${question}\n\nSQL:\n${sql}\n\nResult:\n${tableText}\n\nOne-sentence summary, then follow-ups:`,
      maxTokens: 250,
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
  const { summary, followups } = parseSummary(res.text);

  return Response.json({
    summary,
    followups,
    usage: {
      input_tokens: res.usage.input,
      output_tokens: res.usage.output,
      cache_read_input_tokens: res.usage.cache,
    },
  });
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toFixed(3);
  }
  return String(v).slice(0, 200); // cap per-cell length so a huge string can't bloat the prompt
}
