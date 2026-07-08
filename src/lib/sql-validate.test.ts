import { describe, expect, it } from "vitest";

import { validateGeneratedSql } from "./sql-validate";

describe("validateGeneratedSql", () => {
  it("accepts a plain SELECT", () => {
    const r = validateGeneratedSql("SELECT * FROM pbp LIMIT 10");
    expect(r.ok).toBe(true);
  });

  it("accepts a WITH/CTE", () => {
    const r = validateGeneratedSql("WITH t AS (SELECT 1) SELECT * FROM t");
    expect(r.ok).toBe(true);
  });

  it("accepts SELECT prefixed with whitespace and a comment", () => {
    const r = validateGeneratedSql(
      "   -- comment\n  /* block */\n  SELECT 1",
    );
    expect(r.ok).toBe(true);
  });

  it("accepts a trailing semicolon", () => {
    const r = validateGeneratedSql("SELECT 1;");
    expect(r.ok).toBe(true);
  });

  it("accepts a trailing semicolon followed by whitespace and a comment", () => {
    const r = validateGeneratedSql("SELECT 1; -- trailing");
    expect(r.ok).toBe(true);
  });

  it("rejects a SELECT that reads a remote file (read_parquet — SSRF vector)", () => {
    const r = validateGeneratedSql("SELECT * FROM read_parquet('https://evil.example/x.parquet')");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/read_parquet/i);
  });

  it("rejects read_csv/read_json/glob embedded anywhere, including inside a CTE", () => {
    for (const fn of ["read_csv", "read_csv_auto", "read_json", "read_text", "glob"]) {
      const direct = validateGeneratedSql(`SELECT * FROM ${fn}('http://x')`);
      expect(direct.ok, `${fn} direct`).toBe(false);
      const inCte = validateGeneratedSql(`WITH t AS (SELECT * FROM ${fn}('http://x')) SELECT * FROM t`);
      expect(inCte.ok, `${fn} in CTE`).toBe(false);
    }
  });

  it("does NOT reject a column/string that merely contains a forbidden word", () => {
    // not a function call, and inside a string literal — must still pass
    expect(validateGeneratedSql("SELECT passer_player_name FROM pbp WHERE desc = 'read_parquet note'").ok).toBe(true);
  });

  it("accepts a parenthesized leading SELECT (e.g. a parenthesized UNION)", () => {
    const r = validateGeneratedSql("(SELECT 1) UNION (SELECT 2)");
    expect(r.ok).toBe(true);
  });

  it("rejects empty SQL", () => {
    const r = validateGeneratedSql("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/);
  });

  it("rejects whitespace-only SQL", () => {
    const r = validateGeneratedSql("   \n\t  ");
    expect(r.ok).toBe(false);
  });

  it("rejects suspiciously long SQL", () => {
    const huge = "SELECT * FROM pbp WHERE x IN (" + "1,".repeat(5000) + "1)";
    const r = validateGeneratedSql(huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/long/);
  });

  it("names DROP in the rejection reason", () => {
    const r = validateGeneratedSql("DROP TABLE pbp");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/DROP/);
  });

  it("names INSERT in the rejection reason", () => {
    const r = validateGeneratedSql("INSERT INTO pbp VALUES (1)");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/INSERT/);
  });

  it("rejects PRAGMA", () => {
    const r = validateGeneratedSql("PRAGMA cache_size = 100000");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/PRAGMA/);
  });

  it("rejects ATTACH", () => {
    const r = validateGeneratedSql("ATTACH 'evil.db' AS evil");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/ATTACH/);
  });

  it("rejects a non-SQL-statement starter", () => {
    const r = validateGeneratedSql("foo bar baz");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/SELECT/);
  });

  it("rejects a SELECT followed by a second statement", () => {
    const r = validateGeneratedSql("SELECT 1; DROP TABLE pbp");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/one statement/);
  });

  it("rejects a SELECT with a second statement after a comment", () => {
    const r = validateGeneratedSql("SELECT 1; /* sneaky */ DELETE FROM pbp");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/one statement/);
  });

  it("does not flag a semicolon inside a single-quoted literal", () => {
    const r = validateGeneratedSql("SELECT 'a;b' AS x");
    expect(r.ok).toBe(true);
  });

  it("does not flag a semicolon inside a SQL-escaped quote", () => {
    // SQL string with embedded apostrophe via double-single-quote: 'it''s'
    const r = validateGeneratedSql("SELECT 'it''s;ok' AS x");
    expect(r.ok).toBe(true);
  });

  it("does not flag a semicolon inside a double-quoted identifier", () => {
    const r = validateGeneratedSql('SELECT "weird;col" FROM pbp');
    expect(r.ok).toBe(true);
  });

  it("does not flag a semicolon inside a line comment", () => {
    const r = validateGeneratedSql("SELECT 1 -- ;\nFROM pbp");
    expect(r.ok).toBe(true);
  });

  it("does not flag a semicolon inside a block comment", () => {
    const r = validateGeneratedSql("SELECT /* ; */ 1 FROM pbp");
    expect(r.ok).toBe(true);
  });

  it("case-insensitive on SELECT and reserved-word rejects", () => {
    expect(validateGeneratedSql("select 1").ok).toBe(true);
    const r = validateGeneratedSql("drop table pbp");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/DROP/);
  });
});
