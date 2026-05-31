// Browser-side DuckDB-WASM loader. Lazy-initialises once per page load.

"use client";

import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

let dbPromise: Promise<AsyncDuckDB> | null = null;

async function init(): Promise<AsyncDuckDB> {
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

  const parquetUrl = `${window.location.origin}/pbp_2023.parquet`;
  const conn = await db.connect();
  await conn.query(
    `CREATE OR REPLACE TABLE pbp AS SELECT * FROM read_parquet('${parquetUrl}')`,
  );
  await conn.close();

  return db;
}

export function getDB(): Promise<AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = init();
  }
  return dbPromise;
}

export type RunResult =
  | { ok: true; columns: string[]; rows: unknown[][]; elapsedMs: number }
  | { ok: false; error: string };

export async function runQuery(sql: string): Promise<RunResult> {
  let conn: AsyncDuckDBConnection | null = null;
  const start = performance.now();
  try {
    const db = await getDB();
    conn = await db.connect();
    const table = await conn.query(sql);
    const columns = table.schema.fields.map((f) => f.name);
    const rows: unknown[][] = [];
    for (const row of table.toArray()) {
      rows.push(columns.map((c) => normalize(row[c])));
    }
    return { ok: true, columns, rows, elapsedMs: performance.now() - start };
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
