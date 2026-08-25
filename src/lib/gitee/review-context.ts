import type { CollectedContext, FileChange, PRInfo } from "@/types/analysis";

/**
 * Gitee 审查上下文收集器：拉取 PR 详情 + 变更文件 + diff（patch.diff 拼接），
 * 构建 LangGraph 审查所需的 CollectedContext。Gitee 无官方贡献日历/diff 聚合，
 * 这里用 files API 的 patch.diff 拼出完整 diff。
 */

const BASE = "https://gitee.com/api/v5";

async function giteeGet(token: string, path: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}access_token=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`Gitee GET ${path} failed: ${res.status}`);
  return res.json();
}

interface GiteePullFile {
  filename: string;
  status: string | null;
  additions: string | number;
  deletions: string | number;
  patch?: { diff?: string };
}

interface GiteePullDetail {
  number: number;
  title: string;
  state: string;
  body: string | null;
  user?: { login: string };
  head?: { ref: string; sha: string; label: string };
  base?: { ref: string; sha: string; label: string };
}

export async function fetchGiteePullInfo(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GiteePullDetail> {
  return giteeGet(token, `/repos/${owner}/${repo}/pulls/${prNumber}`);
}

export async function fetchGiteePullFiles(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GiteePullFile[]> {
  const files = await giteeGet(token, `/repos/${owner}/${repo}/pulls/${prNumber}/files`);
  return Array.isArray(files) ? files : [];
}

function toNum(v: string | number | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 构建 Gitee PR 审查上下文（diff 由各文件 patch.diff 拼接，含文件头） */
export async function collectGiteeContext(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<CollectedContext> {
  const [detail, files] = await Promise.all([
    fetchGiteePullInfo(token, owner, repo, prNumber),
    fetchGiteePullFiles(token, owner, repo, prNumber),
  ]);

  const additions = files.reduce((s, f) => s + toNum(f.additions), 0);
  const deletions = files.reduce((s, f) => s + toNum(f.deletions), 0);

  const prInfo: PRInfo = {
    title: detail.title ?? "",
    number: detail.number ?? prNumber,
    author: detail.user?.login ?? "",
    branch: detail.head?.ref ?? detail.head?.label ?? "",
    filesChanged: files.length,
    additions,
    deletions,
    body: detail.body ?? "",
    headSha: detail.head?.sha ?? "",
    baseBranch: detail.base?.ref ?? "",
  };

  const fileChanges: FileChange[] = files.map((f) => ({
    file: f.filename,
    additions: toNum(f.additions),
    deletions: toNum(f.deletions),
    status: (f.status as FileChange["status"]) ?? "modified",
  }));

  // 补文件头拼接完整 diff
  const diff = files
    .map((f) => `diff --git a/${f.filename} b/${f.filename}\n${f.patch?.diff ?? ""}`)
    .join("\n");

  return {
    prInfo,
    fileChanges,
    commits: [],
    diff,
    filesWithContext: [],
    dependencyGraph: null,
    repoStructure: [],
    prComments: [],
    languageConfigs: {},
    relatedFiles: [],
  };
}
