const fs = require("fs");
const mysql = require("mysql2/promise");

(async () => {
  const env = fs.readFileSync(".env", "utf8");
  const m = env.match(/^PR_MYSQL_URL=(.+)$/m);
  const conn = await mysql.createConnection({ uri: m[1].trim() });
  const [cols] = await conn.query(
    "SELECT IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_review_job' AND COLUMN_NAME = 'repository_id'"
  );
  console.log("BEFORE:", JSON.stringify(cols));
  await conn.query("ALTER TABLE ai_review_job MODIFY COLUMN repository_id BIGINT UNSIGNED DEFAULT NULL");
  const [after] = await conn.query(
    "SELECT IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_review_job' AND COLUMN_NAME = 'repository_id'"
  );
  console.log("AFTER:", JSON.stringify(after));
  await conn.end();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
