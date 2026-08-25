/**
 * 审查 Worker：消费 RabbitMQ review_jobs 队列，执行 LangGraph 自动审查。
 * 运行：pnpm review-worker（需本地 RabbitMQ 在运行；未运行则直接退出）
 */
import { consumeReviewJobs } from "@/lib/queue/rabbitmq";
import { runReviewSafe } from "@/lib/review/graph";

async function main() {
  await consumeReviewJobs(async (job) => {
    console.log(`[worker] 开始审查 ${job.owner}/${job.repo}#${job.prNumber} (depth=${job.depth ?? "standard"})`);
    const started = Date.now();
    const result = await runReviewSafe({
      owner: job.owner,
      repo: job.repo,
      prNumber: job.prNumber,
      depth: job.depth ?? "standard",
      userId: job.userId,
      platform: "github",
      writeReview: false,
      preferredModel: job.preferredModel ?? null,
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
