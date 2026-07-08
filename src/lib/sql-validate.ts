// Belt-and-braces check on the SQL the model returns from /api/sql. DuckDB-WASM
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

// DuckDB file/remote table functions. A leading SELECT/WITH is NOT a security
// boundary on its own: DuckDB-WASM has httpfs live (that's how the app loads its
// own parquet), so a plain SELECT can call read_parquet('https://evil/…') and
// make the visitor's browser issue an arbitrary outbound request (SSRF /
// exfiltration via the query string). These are rejected wherever they appear.
const FORBIDDEN_FUNCTIONS = new Set([
  "read_parquet",
  "parquet_scan",
  "parquet_metadata",
  "parquet_schema",
  "read_csv",
  "read_csv_auto",
  "sniff_csv",
  "read_json",
  "read_json_auto",
  "read_json_objects",
  "read_ndjson",
  "read_ndjson_auto",
  "read_ndjson_objects",
  "read_text",
  "read_blob",
  "glob",
  "delta_scan",
  "iceberg_scan",
]);

export function validateGeneratedSql(raw: string): ValidationResult {
  const sql = raw.trim();
  if (!sql) return { ok: false, reason: "empty SQL" };
  if (sql.length > 8000) return { ok: false, reason: "SQL is suspiciously long" };

  const stripped = stripLeadingComments(sql);
  if (!stripped) return { ok: false, reason: "no statement after comments" };

  // Allow an optional run of leading parens (e.g. a parenthesized UNION) before
  // the SELECT/WITH keyword.
  const lead = stripped.replace(/^\(+\s*/, "");
  if (!ALLOWED_LEAD.test(lead)) {
    const firstToken = lead.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0] ?? "";
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

  // Reject DuckDB file/remote functions anywhere in the body (not just the lead)
  // — the real security boundary for a SELECT.
  const bad = scanForForbiddenFunction(sql);
  if (bad) {
    return { ok: false, reason: `refused: ${bad}() is not allowed` };
  }

  return { ok: true, sql };
}

// Extract bare identifier words (outside string/comment context) and return the
// first that is a forbidden file/remote function, or null. Only counts an
// identifier immediately followed by '(' so we don't reject a column that
// happens to share a name.
function scanForForbiddenFunction(sql: string): string | null {
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < sql.length) {
    const c = sql[i];
    if (inSingle) {
      if (c === "'") {
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
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
      const word = sql.slice(i, j).toLowerCase();
      // only a function call (word followed by optional space then '(')
      let k = j;
      while (k < sql.length && (sql[k] === " " || sql[k] === "\t" || sql[k] === "\n" || sql[k] === "\r")) k++;
      if (sql[k] === "(" && FORBIDDEN_FUNCTIONS.has(word)) return word;
      i = j;
      continue;
    }
    i++;
  }
  return null;
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
