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

/** 某仓库的 open PR 列表 */
export function listRepoPulls(token: string, owner: string, repo: string): Promise<GiteePull[]> {
  return giteeGet(token, `/repos/${owner}/${repo}/pulls?state=open&per_page=50`);
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

/** 拉取某仓库自 sinceIso 以来、由 author 提交的 commit 日期（ISO 串），最多 maxPages 页 */
export async function listRepoCommits(
  token: string,
  owner: string,
  repo: string,
  sinceIso: string,
  author: string,
  maxPages = 2,
): Promise<string[]> {
  const dates: string[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const items = await giteeGet(
      token,
      `/repos/${owner}/${repo}/commits?author=${encodeURIComponent(author)}&since=${encodeURIComponent(sinceIso)}&per_page=100&page=${page}`,
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