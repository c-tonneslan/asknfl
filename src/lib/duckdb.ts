// Browser-side DuckDB-WASM loader. Lazy-initialises once per page load.

"use client";

import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { SCHEMA_LINES } from "./schema";

// nflfastR stores flag columns as 0/1 DOUBLE, but the prompt schema describes
// them as BOOLEAN. Cast them to real BOOLEAN on load (via SELECT * REPLACE) so
// the schema is honest and boolean-only ops (bool_and/bool_or, WHERE col) work.
const BOOL_COLS = SCHEMA_LINES.filter((s) => s.type === "BOOLEAN").map((s) => s.col);

// The DuckDB-WASM instance is created once and shared; each dataset (pbp for
// Ask/Dashboards, fantasy for the Fantasy tab) is loaded into its own table
// lazily, so a page only downloads the parquet it needs.
let instancePromise: Promise<AsyncDuckDB> | null = null;
let pbpPromise: Promise<AsyncDuckDB> | null = null;
let fantasyPromise: Promise<AsyncDuckDB> | null = null;

async function getInstance(): Promise<AsyncDuckDB> {
  const duckdb = await import("@duckdb/duckdb-wasm");
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], {
      type: "text/javascript",
    }),
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  return db;
}

function instance(): Promise<AsyncDuckDB> {
  if (!instancePromise) {
    instancePromise = getInstance().catch((e) => {
      instancePromise = null;
      throw e;
    });
  }
  return instancePromise;
}

async function loadTable(db: AsyncDuckDB, table: string, select: string, file: string) {
  const url = `${window.location.origin}/${file}`;
  const conn = await db.connect();
  await conn.query(`CREATE OR REPLACE TABLE ${table} AS ${select} FROM read_parquet('${url}')`);
  await conn.close();
}

// Instance with the play-by-play table ready (Ask + Dashboards).
export function getDB(): Promise<AsyncDuckDB> {
  if (!pbpPromise) {
    // Reset the cache on failure so a transient CDN/parquet fetch error doesn't
    // poison the whole page — a later query can re-init instead of returning the
    // same rejected promise forever.
    pbpPromise = (async () => {
      const db = await instance();
      const replace = BOOL_COLS.length
        ? ` REPLACE (${BOOL_COLS.map((c) => `CAST(${c} AS BOOLEAN) AS ${c}`).join(", ")})`
        : "";
      await loadTable(db, "pbp", `SELECT *${replace}`, "pbp.parquet");
      return db;
    })().catch((e) => {
      pbpPromise = null;
      throw e;
    });
  }
  return pbpPromise;
}

// Instance with the fantasy weekly-stats table ready (Fantasy tab).
export function getFantasyDB(): Promise<AsyncDuckDB> {
  if (!fantasyPromise) {
    fantasyPromise = (async () => {
      const db = await instance();
      await loadTable(db, "player_week", "SELECT *", "fantasy.parquet");
      return db;
    })().catch((e) => {
      fantasyPromise = null;
      throw e;
    });
  }
  return fantasyPromise;
}

// Hard cap on rows the browser materializes/renders, so an unbounded result set
// (or a cross join that slips past the prompt's LIMIT rule) can't hang the tab.
const MAX_ROWS = 5000;

export type RunResult =
  | { ok: true; columns: string[]; rows: unknown[][]; elapsedMs: number; truncated: boolean }
  | { ok: false; error: string };

export async function runQuery(sql: string): Promise<RunResult> {
  return runOn(await promiseOrError(getDB), sql);
}

// Same executor against the fantasy dataset.
export async function runFantasyQuery(sql: string): Promise<RunResult> {
  return runOn(await promiseOrError(getFantasyDB), sql);
}

async function promiseOrError(get: () => Promise<AsyncDuckDB>): Promise<AsyncDuckDB | Error> {
  try {
    return await get();
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

async function runOn(db: AsyncDuckDB | Error, sql: string): Promise<RunResult> {
  if (db instanceof Error) return { ok: false, error: db.message };
  let conn: AsyncDuckDBConnection | null = null;
  try {
    conn = await db.connect();
    // Time only the query + materialization — not DB init / the 3MB parquet load
    // on the first Ask (that would show a bogus multi-second "in-browser" number).
    const start = performance.now();
    // Bound execution with an outer LIMIT (a no-op once the inner query already
    // returns few rows). Strip a trailing ';' the validator permits so the wrap
    // stays valid.
    const inner = sql.trim().replace(/;\s*$/, "");
    const capped = `SELECT * FROM (\n${inner}\n) AS _asknfl_capped LIMIT ${MAX_ROWS}`;
    const table = await conn.query(capped);
    const columns = table.schema.fields.map((f) => f.name);
    const rows: unknown[][] = [];
    for (const row of table.toArray()) {
      rows.push(columns.map((c) => normalize(row[c])));
    }
    return {
      ok: true,
      columns,
      rows,
      elapsedMs: performance.now() - start,
      truncated: rows.length >= MAX_ROWS,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (conn) {
      await conn.close().catch(() => {});
    }
  }
}

function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  return v;
}
