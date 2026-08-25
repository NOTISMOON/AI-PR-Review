/**
 * 审查 Worker：消费 RabbitMQ review_jobs 队列，执行 LangGraph 自动审查。
 * 运行：pnpm review-worker（需本地 RabbitMQ 在运行；未运行则直接退出）
 */
import "dotenv/config"; // tsx 直跑脚本不自动加载 .env，需显式加载
import { consumeReviewJobs } from "@/lib/queue/rabbitmq";
import { runReviewSafe } from "@/lib/review/graph";
import { getUserById, decryptToken } from "@/lib/db/mysql";

async function main() {
  await consumeReviewJobs(async (job) => {
    console.log(`[worker] 开始审查 ${job.owner}/${job.repo}#${job.prNumber} (depth=${job.depth ?? "standard"})`);
    const started = Date.now();

    // 从 MySQL 解密当前用户的平台 token（token 不进队列，消费时现取）
    let token: string | null = null;
    if (job.userId) {
      try {
        const user = await getUserById(job.userId);
        if (user?.accessTokenEnc) token = decryptToken(user.accessTokenEnc);
      } catch (e) {
        console.warn(`[worker] 获取用户 token 失败 (userId=${job.userId}):`, (e as Error).message);
      }
    }

    const result = await runReviewSafe({
      owner: job.owner,
      repo: job.repo,
      prNumber: job.prNumber,
      depth: job.depth ?? "standard",
      userId: job.userId,
      platform: job.platform ?? "github",
      token,
      writeReview: job.writeReview ?? false,
      writeStatus: job.writeStatus ?? false,
      preferredModel: job.preferredModel ?? null,
      riskThreshold: job.riskThreshold ?? "默认",
      temperature: job.temperature ?? 0.1,
      maxComments: job.maxComments ?? 10,
      diffOnly: job.diffOnly ?? false,
    });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (result.error) {
      console.error(`[worker] 审查失败 ${job.owner}/${job.repo}#${job.prNumber}: ${result.error}`);
    } else {
      console.log(`[worker] 审查完成 ${job.owner}/${job.repo}#${job.prNumber} (${secs}s, ${result.risks?.length ?? 0} 问题)`);
    }
  });
}

main().catch((e) => {
  console.error("[worker] 启动失败:", (e as Error).message);
  process.exit(1);
});
