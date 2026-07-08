import Anthropic from "@anthropic-ai/sdk";
import { rateLimited, clientIp } from "@/lib/rate-limit";
import { parseSummary } from "@/lib/summary-parse";

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
- The data is the 2023 NFL season (regular + post). Don't claim anything about other years.

Follow-up rules:
- Each must be answerable from the same 2023 play-by-play data (down/distance, teams, players, EPA/CPOE/WPA, play type, penalties, score state).
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Server missing ANTHROPIC_API_KEY" },
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

  const client = new Anthropic({ apiKey });
  let res;
  try {
    res = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 150,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Question: ${question}\n\nSQL:\n${sql}\n\nResult:\n${tableText}\n\nOne-sentence summary:`,
        },
      ],
    });
  } catch (e) {
    return Response.json(
      { error: `Claude call failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    return Response.json({ error: "No text response" }, { status: 502 });
  }
  const { summary, followups } = parseSummary(block.text);

  return Response.json({
    summary,
    followups,
    usage: {
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
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
