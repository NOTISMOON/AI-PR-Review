import { connect, type Channel, type ChannelModel } from "amqplib";

/**
 * RabbitMQ 轻量任务队列：自动审查任务。
 * webhook 触发审查 → 发布到 review_jobs 队列 → 独立 worker 消费执行。
 * RabbitMQ 不可用时 publishReviewJob 返回 false，由调用方降级为直接执行。
 * 注意：amqplib v2 中连接对象类型为 ChannelModel（非 Connection）。
 */

const QUEUE = "review_jobs";

export interface ReviewJobMessage {
  owner: string;
  repo: string;
  prNumber: number;
  depth?: "fast" | "standard" | "deep";
  /** MySQL user.id（审查结果落库与通知） */
  userId: number | null;
  /** 平台（github | gitee） */
  platform?: "github" | "gitee";
  /** 用户偏好的模型（全局设置） */
  preferredModel?: string | null;
  /** 风险阈值：宽松 | 默认 | 严格 */
  riskThreshold?: string | null;
  /** 自动回写 review（switches.auto_write，仅 GitHub） */
  writeReview?: boolean;
  /** 采样温度（全局设置） */
  temperature?: number;
  /** 单次最大评论数（全局设置） */
  maxComments?: number;
  /** 仅审查变更行（switches.diff_only） */
  diffOnly?: boolean;
  /** 设置提交状态检查（switches.set_status，仅 GitHub） */
  writeStatus?: boolean;
  /** 内部重试计数（失败重新入队时递增，最多 3 次） */
  retryCount?: number;
}

let model: ChannelModel | null = null;

async function getChannel(): Promise<Channel | null> {
  if (!process.env.RABBITMQ_URL) return null;
  try {
    if (!model) model = await connect(process.env.RABBITMQ_URL);
    const ch = await model.createChannel();
    await ch.assertQueue(QUEUE, { durable: true });
    return ch;
  } catch (e) {
    console.warn("[queue] RabbitMQ 不可用:", (e as Error).message);
    return null;
  }
}

/** 发布审查任务到队列；返回是否真正入队（false = RabbitMQ 不可用） */
export async function publishReviewJob(job: ReviewJobMessage): Promise<boolean> {
  try {
    const ch = await getChannel();
    if (!ch) return false;
    ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(job)), { persistent: true });
    return true;
  } catch {
    return false;
  }
}

/** 消费者：订阅队列并逐条处理（用于独立 worker 进程）。失败自动重试（最多 3 次，指数退避） */
export async function consumeReviewJobs(
  handler: (job: ReviewJobMessage) => Promise<void>,
): Promise<void> {
  const ch = await getChannel();
  if (!ch) {
    console.error("[queue] RabbitMQ 不可用，worker 退出");
    return;
  }
  const MAX_RETRY = 3;
  await ch.consume(
    QUEUE,
    async (msg) => {
      if (!msg) return;
      let job: ReviewJobMessage;
      try {
        job = JSON.parse(msg.content.toString()) as ReviewJobMessage;
      } catch {
        ch.ack(msg);
        return;
      }
      const retryCount = Number(job.retryCount ?? 0);
      try {
        await handler(job);
        ch.ack(msg);
      } catch (e) {
        console.error(`[queue] 审查任务失败（第 ${retryCount + 1} 次）:`, (e as Error).message);
        if (retryCount < MAX_RETRY - 1) {
          // 丢弃原消息，指数退避后重新入队（retryCount + 1）
          ch.ack(msg);
          const delay = 5000 * Math.pow(2, retryCount);
          setTimeout(() => {
            const next: ReviewJobMessage = { ...job, retryCount: retryCount + 1 };
            try {
              ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(next)), { persistent: true });
            } catch (re) {
              console.error("[queue] 重新入队失败:", (re as Error).message);
            }
          }, delay);
        } else {
          console.error(`[queue] 审查任务 ${MAX_RETRY} 次失败，已放弃`);
          ch.ack(msg);
        }
      }
    },
    { noAck: false },
  );
  console.log("[queue] 审查 worker 已启动，等待任务…");
}
