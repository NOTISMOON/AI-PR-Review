import { drizzle as drizzleMySql2, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { schema, type Schema } from "./schema";

/**
 * Drizzle ORM 实例：复用 mysql2 连接池。
 * 由 mysql.ts 统一拿到 pool / db，所有数据读写走类型化 API。
 * 未配置 PR_MYSQL_URL 时返回 null（不阻断登录，便于本地/原型运行）。
 */
let pool: mysql.Pool | null = null;
let db: MySql2Database<Schema> | null = null;

export function initPool() {
  if (pool && db) return;
  // 并发调 initPool 时避免重复建池
  if (!process.env.PR_MYSQL_URL) return;
  pool = mysql.createPool({
    uri: process.env.PR_MYSQL_URL,
    connectionLimit: 5,
    waitForConnections: true,
    namedPlaceholders: true,
  });
  db = drizzleMySql2(pool, { schema, mode: "default" });
}

/** Drizzle 实例（未配置 PR_MYSQL_URL 时为 null） */
export function getDb(): MySql2Database<Schema> | null {
  initPool();
  return db;
}

/** mysql2 连接池（供 DDL / 特殊 SQL 使用，未配置时为 null） */
export function getPool(): mysql.Pool | null {
  initPool();
  return pool;
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}