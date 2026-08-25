/**
 * 以「当前用户解密后的平台 token」调用 GitHub API。
 * token 来源：登录接库时存储的加密 access_token（见 src/lib/db/mysql.ts）。
 */
const API = "https://api.github.com";

async function gh(token: string, path: string, opts: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method || "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "ai-pr-review/1.0",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${opts.method || "GET"} ${path} failed: ${res.status}`);
  return res.json();
}

export interface GitHubRepo {
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
export function listRepos(token: string, perPage = 100): Promise<GitHubRepo[]> {
  return gh(token, `/user/repos?per_page=${perPage}&sort=updated&affiliation=owner,collaborator`);
}

export interface GitHubPull {
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  user: { login: string };
  base: { ref: string };
  head: { ref: string; sha: string };
}

/** 某仓库的 PR 列表（state: open|closed|all） */
export function listRepoPulls(token: string, owner: string, repo: string, state = "open"): Promise<GitHubPull[]> {
  return gh(token, `/repos/${owner}/${repo}/pulls?state=${state}&per_page=100`);
}

export interface GitHubPullDetail {
  number: number;
  state: string;
  merged: boolean;
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
): Promise<GitHubPullDetail> {
  return gh(token, `/repos/${owner}/${repo}/pulls/${number}`);
}

export interface GitHubInstallation {
  id: number;
  app_id: number;
  account: { login: string; type: string; avatar_url: string };
  repository_selection: string;
  permissions: Record<string, string>;
}

// ── 代码预览（文件树 / 分支 / 文件内容） ──

export interface GitHubRepoInfo {
  default_branch: string;
}

/** 仓库基本信息（默认分支） */
export function getRepoInfo(token: string, owner: string, repo: string): Promise<GitHubRepoInfo> {
  return gh(token, `/repos/${owner}/${repo}`);
}

/** 某仓库的分支列表 */
export function listBranches(token: string, owner: string, repo: string): Promise<{ name: string }[]> {
  return gh(token, `/repos/${owner}/${repo}/branches?per_page=100`);
}

export interface GitHubContentsEntry {
  name: string;
  type: "dir" | "file";
  path: string;
  size: number;
}

export interface GitHubContentsFile {
  name: string;
  path: string;
  size: number;
  encoding: string;
  content: string;
}

/**
 * GitHub Contents API：path 为空表示根目录。
 * 目录返回数组，文件返回带 base64 content 的对象。
 */
export function getContents(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<GitHubContentsEntry[] | GitHubContentsFile> {
  const encoded = path ? path.split("/").map(encodeURIComponent).join("/") : "";
  const suffix = encoded ? `/${encoded}` : "";
  return gh(token, `/repos/${owner}/${repo}/contents${suffix}?ref=${encodeURIComponent(ref)}`);
}

export interface GitHubCommitInfo {
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
): Promise<GitHubCommitInfo> {
  const c = await gh(token, `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`);
  return {
    sha: String(c?.sha ?? "").slice(0, 7),
    message: String(c?.commit?.message ?? "").split("\n")[0],
    author: c?.commit?.author?.name || c?.author?.login || "unknown",
    date: c?.commit?.author?.date || "",
    avatar: c?.author?.avatar_url || null,
  };
}

// ── 仓库 Webhook（一键创建 / 状态查询，需 repo 写权限） ──

export interface GitHubHook {
  id: number;
  name: string;
  active: boolean;
  events: string[];
  config: { url?: string; content_type?: string };
  created_at?: string;
}

/** 某仓库已配置的 Webhook 列表 */
export function listRepoHooks(token: string, owner: string, repo: string): Promise<GitHubHook[]> {
  return gh(token, `/repos/${owner}/${repo}/hooks?per_page=100`);
}

/** 创建仓库 Webhook（自动回填 URL / Secret / 事件） */
export function createRepoHook(
  token: string,
  owner: string,
  repo: string,
  input: { url: string; secret: string; events: string[] },
): Promise<GitHubHook> {
  return gh(token, `/repos/${owner}/${repo}/hooks`, {
    method: "POST",
    body: {
      name: "web",
      active: true,
      events: input.events.length ? input.events : ["push"],
      config: {
        url: input.url,
        content_type: "json",
        secret: input.secret,
        insecure_ssl: "0",
      },
    },
  });
}

/** 删除仓库 Webhook（关闭自动审查时销毁平台侧 hook），返回是否成功 */
export async function deleteRepoHook(
  token: string,
  owner: string,
  repo: string,
  hookId: number,
): Promise<boolean> {
  const res = await fetch(`${API}/repos/${owner}/${repo}/hooks/${hookId}`, {
    method: "DELETE",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "ai-pr-review/1.0",
    },
  });
  return res.ok;
}

/** 当前用户可访问的 GitHub App 安装（仅当用户授权了 GitHub App 才有数据） */
export async function listInstallations(token: string): Promise<GitHubInstallation[]> {
  const data = await gh(token, "/user/installations?per_page=100");
  return data?.installations ?? [];
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
    const items = await gh(
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

export interface ContributionDay {
  date: string; // YYYY-MM-DD（GitHub 官方日历）
  count: number;
}
export interface ContributionCalendar {
  total: number;
  days: ContributionDay[];
}

/**
 * 用 GitHub GraphQL contributionsCollection 拉取某账号在 [fromIso, toIso] 的官方贡献日历。
 * 与 GitHub 网页热力图完全一致（含 commit/PR/issue/review），是准确性最高的来源。
 */
export async function fetchContributionCalendar(
  token: string,
  login: string,
  fromIso: string,
  toIso: string,
): Promise<ContributionCalendar> {
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks { contributionDays { date contributionCount } }
          }
        }
      }
    }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login, from: fromIso, to: toIso } }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL failed: ${res.status}`);
  const json = (await res.json()) as any;
  const cal = json?.data?.user?.contributionsCollection?.contributionCalendar;
  if (!cal) throw new Error("GitHub contributions not available");
  const days: ContributionDay[] = [];
  for (const w of cal.weeks ?? []) {
    for (const d of w.contributionDays ?? []) {
      days.push({ date: d.date, count: d.contributionCount || 0 });
    }
  }
  return { total: cal.totalContributions || 0, days };
}