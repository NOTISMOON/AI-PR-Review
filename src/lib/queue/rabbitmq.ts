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
  /** 用户偏好的模型（全局设置） */
  preferredModel?: string | null;
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

/** 消费者：订阅队列并逐条处理（用于独立 worker 进程） */
export async function consumeReviewJobs(
  handler: (job: ReviewJobMessage) => Promise<void>,
): Promise<void> {
  const ch = await getChannel();
  if (!ch) {
    console.error("[queue] RabbitMQ 不可用，worker 退出");
    return;
  }
  await ch.consume(
    QUEUE,
    async (msg) => {
      if (!msg) return;
      try {
        const job = JSON.parse(msg.content.toString()) as ReviewJobMessage;
        await handler(job);
        ch.ack(msg);
      } catch (e) {
        console.error("[queue] 处理审查任务失败（已丢弃）:", (e as Error).message);
        // 丢弃避免死循环；重试策略后续可通过重新入队实现
        ch.nack(msg, false, false);
      }
    },
    { noAck: false },
  );
  console.log("[queue] 审查 worker 已启动，等待任务…");
}
