import * as github from "@/lib/github/user-client";
import * as gitee from "@/lib/gitee/client";
import type { OAuthProvider } from "@/lib/auth/jwt";

/**
 * 代码预览共享逻辑（对应后端文档 browse）。
 * GitHub / Gitee 均走 Contents API（目录返回数组、文件返回 base64），
 * 一次调用返回分支列表 + 默认分支 + 目标路径（目录条目或文件内容）。
 * 文件树由前端按目录懒加载，避免一次性递归拉全量文件树。
 */

export interface BrowseEntry {
  name: string;
  type: "dir" | "file";
  path: string;
  size: number;
}

export interface BrowseCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  avatar: string | null;
}

export interface BrowseData {
  owner: string;
  repo: string;
  ref: string;
  defaultBranch: string;
  branches: { name: string }[];
  kind: "dir" | "file";
  path: string;
  /** kind=dir */
  entries?: BrowseEntry[];
  /** kind=file */
  content?: string;
  size?: number;
  /** 文件过大 / 无法解码时置 true，前端展示占位提示 */
  tooLarge?: boolean;
  /** 仅 path 为空（根目录）时返回，用于提交横幅 */
  latestCommit?: BrowseCommit | null;
}

export interface BrowseOptions {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
}

function decodeBase64(b64: string): string {
  return Buffer.from(b64 || "", "base64").toString("utf8");
}

export async function buildBrowse(
  provider: OAuthProvider,
  token: string,
  opts: BrowseOptions,
): Promise<BrowseData> {
  const { owner, repo } = opts;
  const path = opts.path || "";
  const ref = opts.ref || "";

  const info =
    provider === "github"
      ? await github.getRepoInfo(token, owner, repo)
      : await gitee.getRepoInfo(token, owner, repo);
  const defaultBranch = info?.default_branch || "main";
  const branch = ref || defaultBranch;

  const branches =
    provider === "github"
      ? await github.listBranches(token, owner, repo)
      : await gitee.listBranches(token, owner, repo);

  // 提交横幅：仅根目录时顺带返回最新 commit（失败不阻塞浏览）
  let latestCommit: BrowseCommit | null = null;
  if (!path) {
    try {
      latestCommit =
        provider === "github"
          ? await github.getLatestCommit(token, owner, repo, branch)
          : await gitee.getLatestCommit(token, owner, repo, branch);
    } catch {
      /* ignore */
    }
  }

  const raw =
    provider === "github"
      ? await github.getContents(token, owner, repo, path, branch)
      : await gitee.getContents(token, owner, repo, path, branch);

  if (Array.isArray(raw)) {
    return {
      owner,
      repo,
      ref: branch,
      defaultBranch,
      branches,
      kind: "dir",
      path,
      entries: raw.map((e) => ({
        name: e.name,
        type: e.type === "dir" ? "dir" : "file",
        path: e.path,
        size: e.size || 0,
      })),
      latestCommit,
    };
  }

  // 文件：Contents API 对 >1MB 文件不返回 content，解码失败时置 tooLarge
  let content = "";
  let tooLarge = false;
  try {
    content = decodeBase64(raw.content || "");
  } catch {
    tooLarge = true;
  }
  return {
    owner,
    repo,
    ref: branch,
    defaultBranch,
    branches,
    kind: "file",
    path,
    content,
    size: raw.size || 0,
    tooLarge,
  };
}
