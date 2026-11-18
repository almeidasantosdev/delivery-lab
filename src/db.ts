import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const sqlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "sql", "001_init.sql");

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  migrate(): Promise<void>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function loadSchemaSql(): string {
  return fs.readFileSync(sqlPath, "utf8");
}

export function createPgDb(databaseUrl: string): Db {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    query: (sql, params) => pool.query(sql, params),
    async migrate() {
      await pool.query(loadSchemaSql());
    },
    async transaction(fn) {
      const client: PoolClient = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
