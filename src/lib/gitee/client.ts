/**
 * 以「当前用户解密后的平台 token」调用 Gitee API v5。
 * Gitee 的鉴权方式：access_token 作为 query 参数（非 Bearer 头）。
 */
const BASE = "https://gitee.com/api/v5";

async function giteeGet(token: string, path: string) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}access_token=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`Gitee GET ${path} failed: ${res.status}`);
  return res.json();
}

/** Gitee POST（创建等写操作）：access_token 仍走 query，body 为 JSON */
async function giteePost(token: string, path: string, body: unknown) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gitee POST ${path} failed: ${res.status}`);
  return res.json();
}

export interface GiteeRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
}

/** 当前用户可访问的仓库 */
export function listRepos(token: string, perPage = 100): Promise<GiteeRepo[]> {
  return giteeGet(token, `/user/repos?per_page=${perPage}&sort=updated`);
}

export interface GiteePull {
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  user: { login: string };
  base: { ref: string };
  head: { ref: string; sha: string };
}

/** 某仓库的 PR 列表（state: open|closed|merged|all） */
export function listRepoPulls(token: string, owner: string, repo: string, state = "open"): Promise<GiteePull[]> {
  return giteeGet(token, `/repos/${owner}/${repo}/pulls?state=${state}&per_page=100`);
}

export interface GiteePullDetail {
  number: number;
  state: string;
  merged?: boolean;
  user: { login: string };
  head: { sha: string };
  title: string;
}

/** 单个 PR 详情（判断作者/状态用） */
export function getPull(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<GiteePullDetail> {
  return giteeGet(token, `/repos/${owner}/${repo}/pulls/${number}`);
}

// ── 代码预览（文件树 / 分支 / 文件内容） ──

export interface GiteeRepoInfo {
  default_branch: string;
}

/** 仓库基本信息（默认分支） */
export function getRepoInfo(token: string, owner: string, repo: string): Promise<GiteeRepoInfo> {
  return giteeGet(token, `/repos/${owner}/${repo}`);
}

/** 某仓库的分支列表 */
export function listBranches(token: string, owner: string, repo: string): Promise<{ name: string }[]> {
  return giteeGet(token, `/repos/${owner}/${repo}/branches?per_page=100`);
}

export interface GiteeContentsEntry {
  name: string;
  type: "dir" | "file";
  path: string;
  size: number;
}

export interface GiteeContentsFile {
  name: string;
  path: string;
  size: number;
  encoding: string;
  content: string;
}

/** Gitee Contents API：path 为空表示根目录；目录返回数组，文件返回 base64 content */
export function getContents(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<GiteeContentsEntry[] | GiteeContentsFile> {
  const encoded = path ? path.split("/").map(encodeURIComponent).join("/") : "";
  const suffix = encoded ? `/${encoded}` : "";
  return giteeGet(token, `/repos/${owner}/${repo}/contents${suffix}?ref=${encodeURIComponent(ref)}&per_page=100`);
}

export interface GiteeCommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
  avatar: string | null;
}

/** 某分支最新一次提交（commit 横幅用） */
export async function getLatestCommit(
  token: string,
  owner: string,
  repo: string,
  ref: string,
): Promise<GiteeCommitInfo> {
  const c = await giteeGet(token, `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`);
  return {
    sha: String(c?.sha ?? "").slice(0, 7),
    message: String(c?.commit?.message ?? "").split("\n")[0],
    author: c?.commit?.author?.name || c?.author?.login || "unknown",
    date: c?.commit?.author?.date || "",
    avatar: c?.author?.avatar_url || null,
  };
}

// ── 仓库 Webhook（一键创建 / 状态查询） ──

export interface GiteeHook {
  id: number;
  url: string;
  active?: boolean;
  created_at?: string;
}

/** 某仓库已配置的 Webhook 列表 */
export function listRepoHooks(token: string, owner: string, repo: string): Promise<GiteeHook[]> {
  return giteeGet(token, `/repos/${owner}/${repo}/hooks?per_page=100`);
}

/** 创建仓库 WebHook：password 即验签 token（推送时作为 X-Gitee-Token 发出） */
export function createRepoHook(
  token: string,
  owner: string,
  repo: string,
  input: { url: string; secret: string; events: string[] },
): Promise<GiteeHook> {
  return giteePost(token, `/repos/${owner}/${repo}/hooks`, {
    url: input.url,
    encryption_type: 0,
    password: input.secret,
    push_events: input.events.includes("push"),
    tag_push_events: false,
    issues_events: false,
    note_events: input.events.includes("issue_comment"),
    merge_requests_events: input.events.includes("pull_request"),
    active: true,
  });
}

/** 删除仓库 WebHook（关闭自动审查时销毁平台侧 hook），返回是否成功 */
export async function deleteRepoHook(
  token: string,
  owner: string,
  repo: string,
  hookId: number,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${BASE}/repos/${owner}/${repo}/hooks/${hookId}?access_token=${encodeURIComponent(token)}`,
      { method: "DELETE" },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** 拉取某仓库自 sinceIso 以来的 commit 日期（ISO 串），最多 maxPages 页。
 *  注意：不再传 Gitee 的 author 参数——Gitee 该过滤按提交者用户名匹配，经常匹配不到导致热力图空白，
 *  因此拉全量后由上层按提交者归属近似统计（Gitee 无官方贡献日历）。 */
export async function listRepoCommits(
  token: string,
  owner: string,
  repo: string,
  sinceIso: string,
  maxPages = 2,
): Promise<string[]> {
  const dates: string[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const items = await giteeGet(
      token,
      `/repos/${owner}/${repo}/commits?since=${encodeURIComponent(sinceIso)}&per_page=100&page=${page}`,
    );
    if (!Array.isArray(items) || items.length === 0) break;
    for (const c of items as any[]) {
      const d = c?.commit?.author?.date;
      if (d) dates.push(String(d));
    }
    if (items.length < 100) break;
  }
  return dates;
}

// ── 决策回写（审查通过 / PR 评论 / 关闭 PR，供「审查处理中心」使用） ──

export interface GiteeApiResult {
  ok: boolean;
  status?: number;
  message?: string;
  /** 回写评论成功后平台的评论 id（取消采纳删除用） */
  commentId?: string;
}

/** 统一包装 Gitee 写接口：成功返回 ok（可选解析 comment id），失败解析出 status + 真实 message */
async function giteeCall(
  token: string,
  url: string,
  init?: RequestInit,
  withId = false,
): Promise<GiteeApiResult> {
  try {
    const res = await fetch(url, init);
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
      /* 非 JSON 忽略 */
    }
    return { ok: false, status: res.status, message };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 处理 PR 审查（审查通过）。Gitee v5 该接口按 formData 接收，仅 force 字段（强制通过，忽略分支保护审查/测试规则） */
export async function reviewPullRequest(
  token: string,
  owner: string,
  repo: string,
  number: number,
  force = false,
): Promise<GiteeApiResult> {
  const form = new URLSearchParams();
  form.set("access_token", token);
  if (force) form.set("force", "true");
  return giteeCall(token, `${BASE}/repos/${owner}/${repo}/pulls/${number}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString(),
  });
}

/** 提交 PR 评论（返回评论 id 供取消采纳删除） */
export async function createPullComment(
  token: string,
  owner: string,
  repo: string,
  number: number,
  body: string,
): Promise<GiteeApiResult> {
  return giteeCall(
    token,
    `${BASE}/repos/${owner}/${repo}/pulls/${number}/comments?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ body }),
    },
    true, // 解析返回的评论 id
  );
}

/** 删除 PR 评论（取消采纳时撤销回写） */
export async function deletePullComment(
  token: string,
  owner: string,
  repo: string,
  commentId: string,
): Promise<GiteeApiResult> {
  return giteeCall(
    token,
    `${BASE}/repos/${owner}/${repo}/pulls/comments/${commentId}?access_token=${encodeURIComponent(token)}`,
    { method: "DELETE" },
  );
}

/** 关闭 PR（PATCH state=closed） */
export async function closePullRequest(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<GiteeApiResult> {
  return giteeCall(
    token,
    `${BASE}/repos/${owner}/${repo}/pulls/${number}?access_token=${encodeURIComponent(token)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ state: "closed" }),
    },
  );
}