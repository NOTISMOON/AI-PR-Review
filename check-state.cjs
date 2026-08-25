const fs = require("fs");
const mysql = require("mysql2/promise");

(async () => {
  const env = fs.readFileSync(".env", "utf8");
  const m = env.match(/^PR_MYSQL_URL=(.+)$/m);
  const conn = await mysql.createConnection({ uri: m[1].trim() });
  const [ev] = await conn.query(
    "SELECT id, event_name, action, pr_number, queue_status, received_at FROM webhook_event ORDER BY id DESC LIMIT 8"
  );
  console.log("EVENTS:", JSON.stringify(ev, null, 2));
  const [job] = await conn.query(
    "SELECT id, repo_full_name, pr_number, status, decision, risk_level, risk_count, created_at FROM ai_review_job ORDER BY id DESC LIMIT 8"
  );
  console.log("JOBS:", JSON.stringify(job, null, 2));
  const [issue] = await conn.query(
    "SELECT COUNT(*) AS c FROM review_issue"
  );
  console.log("ISSUES_COUNT:", JSON.stringify(issue));
  await conn.end();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
