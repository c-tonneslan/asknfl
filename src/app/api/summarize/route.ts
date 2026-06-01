import Anthropic from "@anthropic-ai/sdk";

export const runtime = "edge";

const SYSTEM = `You write a one-sentence summary of a DuckDB result set for an NFL question.

Rules:
- One sentence. Maximum 30 words.
- Lead with the headline number or the top player/team. Mention the metric in plain English (passing yards, EPA per play, etc.), not the column name.
- Don't restate the question or hedge ("based on the results...", "looks like...").
- Don't make up numbers that aren't in the rows. If the result is empty, say so.
- The data is the 2023 NFL season (regular + post). Don't claim anything about other years.
- No Markdown. Plain text.`;

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

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const question = body.question?.trim();
  const sql = body.sql?.trim();
  const columns = body.columns ?? [];
  const rows = body.rows ?? [];

  if (!question || !sql) {
    return Response.json(
      { error: "Missing 'question' or 'sql'" },
      { status: 400 },
    );
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
  const res = await client.messages.create({
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

  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    return Response.json({ error: "No text response" }, { status: 502 });
  }
  const summary = block.text.trim();

  return Response.json({
    summary,
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
  return String(v);
}
