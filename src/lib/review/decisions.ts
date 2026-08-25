import type { Risk } from "@/types/analysis";
import * as gitee from "@/lib/gitee/client";

/**
 * 审查决策操作（调用 GitHub API 回写 review / 评论）。
 * 用户在「审查处理中心」对自动审查结果做批准 / 请求变更 / 评论 / 采纳建议 / 关闭 PR。
 * 失败时回传 GitHub 真实 status + message，便于上层透传准确定位（不再笼统报"权限不足"）。
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

export interface GitHubResult {
  ok: boolean;
  status?: number;
  message?: string;
  /** 回写评论成功后平台的评论 id（取消采纳删除用） */
  commentId?: string;
}

/** 统一调用 GitHub API：成功返回 ok（可选解析 comment id），失败解析出 status + 真实 message */
async function apiCall(
  token: string,
  url: string,
  init?: RequestInit,
  withId = false,
): Promise<GitHubResult> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { ...headers(token), ...(init?.headers ?? {}) },
    });
    if (res.ok) {
      if (withId) {
        try {
          const j = (await res.json()) as { id?: number | string };
          if (j?.id != null) return { ok: true, status: res.status, commentId: String(j.id) };
        } catch {
          /* 响应体非 JSON 或缺少 id */
        }
      }
      return { ok: true, status: res.status };
    }
    let message = "";
    try {
      const j = (await res.json()) as { message?: string };
      message = j.message ?? "";
    } catch {
      /* 非 JSON 响应体忽略 */
    }
    return { ok: false, status: res.status, message };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 批准 / 请求变更（PR review 提交事件） */
export async function submitPullReview(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  event: "APPROVE" | "REQUEST_CHANGES",
  body: string,
): Promise<GitHubResult> {
  return apiCall(token, `${API}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
    method: "POST",
    body: JSON.stringify({ body, event }),
  });
}

/** 普通评论（PR 讨论） */
export async function postIssueComment(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<GitHubResult> {
  return apiCall(token, `${API}/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

/** 行内建议评论（把某条 risk 的建议以 inline review comment 提交给作者采纳） */
export async function postInlineComment(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  risk: Risk,
): Promise<GitHubResult> {
  if (!risk.file || !risk.line) {
    return { ok: false, message: "该建议缺少文件或行号，无法生成行内评论" };
  }
  const body = `${risk.title}\n\n${risk.description}${risk.suggestion ? `\n\n**建议**：${risk.suggestion}` : ""}`;
  return apiCall(
    token,
    `${API}/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ path: risk.file, line: risk.line, side: "RIGHT", body }),
    },
    true, // 解析返回的评论 id
  );
}

/** 删除 GitHub 行内评论（取消采纳时撤销回写） */
export async function deleteInlineComment(
  token: string,
  owner: string,
  repo: string,
  commentId: string,
): Promise<GitHubResult> {
  return apiCall(token, `${API}/repos/${owner}/${repo}/pulls/comments/${commentId}`, {
    method: "DELETE",
  });
}

/** 关闭 PR（硬关闭；与"请求变更"的软拒绝不同） */
export async function closePullRequest(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GitHubResult> {
  return apiCall(token, `${API}/repos/${owner}/${repo}/pulls/${prNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed" }),
  });
}

// ── Gitee 决策回写（Gitee 无"拒绝/请求变更"的 review action：approve 走审查接口，打回映射为评论） ──

/** Gitee 审查通过（approve）；带评论时先发评论再审查通过 */
export async function giteeApprovePull(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  comment?: string,
): Promise<GitHubResult> {
  if (comment) {
    const c = await gitee.createPullComment(token, owner, repo, prNumber, comment);
    if (!c.ok) return c;
  }
  return gitee.reviewPullRequest(token, owner, repo, prNumber);
}

/** Gitee 打回（无 reject action，映射为发表评论说明需修改的问题） */
export async function giteeRequestChanges(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  comment?: string,
): Promise<GitHubResult> {
  return gitee.createPullComment(
    token,
    owner,
    repo,
    prNumber,
    comment || "AI 审查发现需修复的问题，请处理后再合并。",
  );
}

/** Gitee 普通评论 */
export async function giteeCommentPull(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  comment?: string,
): Promise<GitHubResult> {
  return gitee.createPullComment(token, owner, repo, prNumber, comment || "AI 审查评论");
}

/** Gitee 关闭 PR */
export async function giteeClosePull(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GitHubResult> {
  return gitee.closePullRequest(token, owner, repo, prNumber);
}
