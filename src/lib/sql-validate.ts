// Belt-and-braces check on the SQL Claude returns from /api/sql. DuckDB-WASM
// runs in the browser against a parquet, so there's nothing to actually
// destroy — but we still don't want the API echoing back DROP, INSERT, or
// multi-statement payloads. The system prompt asks for one SELECT; this
// confirms it before we hand the string to the client.

export type ValidationResult =
  | { ok: true; sql: string }
  | { ok: false; reason: string };

const ALLOWED_LEAD = /^(select|with)\b/i;

// Things that aren't a SELECT and have no business being here.
const FORBIDDEN_LEAD = [
  "insert",
  "update",
  "delete",
  "drop",
  "create",
  "alter",
  "attach",
  "detach",
  "copy",
  "vacuum",
  "pragma",
  "set",
  "load",
  "install",
  "export",
  "import",
];

export function validateGeneratedSql(raw: string): ValidationResult {
  const sql = raw.trim();
  if (!sql) return { ok: false, reason: "empty SQL" };
  if (sql.length > 8000) return { ok: false, reason: "SQL is suspiciously long" };

  const stripped = stripLeadingComments(sql);
  if (!stripped) return { ok: false, reason: "no statement after comments" };

  if (!ALLOWED_LEAD.test(stripped)) {
    const firstToken = stripped.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0] ?? "";
    const lower = firstToken.toLowerCase();
    if (FORBIDDEN_LEAD.includes(lower)) {
      return { ok: false, reason: `refused: ${lower.toUpperCase()} is not allowed` };
    }
    return { ok: false, reason: "expected a SELECT or WITH statement" };
  }

  // A semicolon is fine at the very end; anywhere else it suggests a second
  // statement. Walk the string respecting single-quoted strings and -- / /* */
  // comments so we don't false-positive on a literal that contains ';'.
  if (hasExtraStatement(sql)) {
    return { ok: false, reason: "only one statement allowed" };
  }

  return { ok: true, sql };
}

function stripLeadingComments(sql: string): string {
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    return sql.slice(i);
  }
  return "";
}

function hasExtraStatement(sql: string): boolean {
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < sql.length) {
    const c = sql[i];
    if (inSingle) {
      if (c === "'") {
        // SQL escape: '' is a literal quote.
        if (sql[i + 1] === "'") { i += 2; continue; }
        inSingle = false;
      }
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      i++;
      continue;
    }
    if (c === "'") { inSingle = true; i++; continue; }
    if (c === '"') { inDouble = true; i++; continue; }
    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (c === ";") {
      // Trailing semicolon plus whitespace/comments is fine.
      const rest = stripLeadingComments(sql.slice(i + 1));
      return rest.length > 0;
    }
    i++;
  }
  return false;
}
