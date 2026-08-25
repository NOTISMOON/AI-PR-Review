import { NextRequest, NextResponse } from "next/server";
import { handleWebhookDelivery } from "@/lib/platform/webhook";

export const runtime = "nodejs";

/** GitHub Webhook 接收端点：验签（X-Hub-Signature-256）+ 幂等 + 写日志 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const result = await handleWebhookDelivery("github", raw, req.headers);
  return NextResponse.json(result.body, { status: result.status });
}
