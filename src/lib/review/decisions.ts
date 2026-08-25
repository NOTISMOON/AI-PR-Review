import type { Risk } from "@/types/analysis";

/**
 * 审查决策操作（调用 GitHub API 回写 review / 评论）。
 * 用户在「审查处理中心」对自动审查结果做批准 / 请求变更 / 评论 / 采纳建议。
 */

const API = "https://api.github.com";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "ai-pr-review/1.0",
  };
}

/** 批准 / 请求变更（PR review 提交事件） */
export async function submitPullReview(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  event: "APPROVE" | "REQUEST_CHANGES",
  body: string,
): Promise<boolean> {
  const res = await fetch(`${API}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ body, event }),
  });
  return res.ok;
}

/** 普通评论（PR 讨论） */
export async function postIssueComment(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<boolean> {
  const res = await fetch(`${API}/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ body }),
  });
  return res.ok;
}

/** 行内建议评论（把某条 risk 的建议以 inline review comment 提交给作者采纳） */
export async function postInlineComment(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  risk: Risk,
): Promise<boolean> {
  if (!risk.file || !risk.line) return false;
  const body = `${risk.title}\n\n${risk.description}${risk.suggestion ? `\n\n**建议**：${risk.suggestion}` : ""}`;
  const res = await fetch(`${API}/repos/${owner}/${repo}/pulls/${prNumber}/comments`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ path: risk.file, line: risk.line, side: "RIGHT", body }),
  });
  return res.ok;
}

/** 关闭 PR（拒绝合并） */
export async function closePullRequest(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<boolean> {
  const res = await fetch(`${API}/repos/${owner}/${repo}/pulls/${prNumber}`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify({ state: "closed" }),
  });
  return res.ok;
}
