"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  X,
} from "lucide-react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Entrance, SplitTitle } from "@/app/components/motion";
import { usePlatform } from "@/app/components/platform";
import { authFetch } from "@/lib/client/auth-fetch";

import { Badge } from "@/app/components/ui/badge";
import { cn } from "@/app/components/ui/utils";

gsap.registerPlugin(useGSAP);

/* ── 语法高亮（轻量安全 tokenizer：React 渲染自动转义，无 innerHTML） ── */
type TokenClass = "kw" | "str" | "fn" | "var" | "type" | "cm";

interface Tok {
  t: string;
  c?: TokenClass;
}

const TOKEN_CLASS: Record<TokenClass, string> = {
  kw: "text-[var(--red)]",
  str: "text-[var(--green)]",
  fn: "text-[var(--violet)]",
  var: "text-[var(--cyan)]",
  type: "text-[var(--amber)]",
  cm: "text-[var(--text-3)] italic",
};

type Lang = "js" | "py" | "go" | "java" | "rust" | "c" | "sh" | "html" | "css" | "sql" | "text";

const LANG_BY_EXT: Record<string, Lang> = {
  js: "js", jsx: "js", mjs: "js", cjs: "js", ts: "js", tsx: "js",
  py: "py", go: "go", java: "java", kt: "java", rs: "rust",
  c: "c", h: "c", cpp: "c", hpp: "c", cc: "c", css: "css", scss: "css", less: "css",
  sh: "sh", bash: "sh", zsh: "sh", html: "html", htm: "html", xml: "html", svg: "html",
  sql: "sql", md: "text", json: "js", yml: "js", yaml: "js", toml: "js",
};

function languageOf(path: string): Lang {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANG_BY_EXT[ext] ?? "text";
}

const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "elif", "for", "while", "do", "class",
  "interface", "type", "enum", "import", "from", "export", "default", "async", "await", "new", "this",
  "super", "null", "undefined", "true", "false", "try", "catch", "throw", "finally", "switch", "case",
  "break", "continue", "extends", "implements", "public", "private", "protected", "static", "readonly",
  "package", "yield", "in", "of", "void", "typeof", "instanceof", "delete", "get", "set",
  "def", "lambda", "pass", "with", "as", "global", "nonlocal", "and", "or", "not", "is", "None", "self",
  "struct", "impl", "fn", "mut", "use", "mod", "pub", "match", "move", "ref", "func", "select", "chan",
  "go", "defer", "range", "map", "int", "float", "string", "bool", "byte", "rune", "nil", "abstract",
  "final", "synchronized", "volatile", "native", "trait", "where", "unsafe", "extern", "macro", "print", "len",
]);

/** 单行 tokenizer：字符串 / 注释 / 关键字 / 类型 / 函数调用 / 数字，其余原样 */
function tokenizeLine(line: string, lang: Lang): Tok[] {
  const toks: Tok[] = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    const ch = line[i];
    if (/\s/.test(ch)) {
      let j = i;
      while (j < n && /\s/.test(line[j])) j++;
      toks.push({ t: line.slice(i, j) });
      i = j;
      continue;
    }
    // 注释
    if (ch === "/" && line[i + 1] === "/") {
      toks.push({ t: line.slice(i), c: "cm" });
      break;
    }
    if (ch === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      toks.push({ t: line.slice(i, stop), c: "cm" });
      i = stop;
      continue;
    }
    if (ch === "#" && (lang === "py" || lang === "sh")) {
      toks.push({ t: line.slice(i), c: "cm" });
      break;
    }
    if (ch === "-" && line[i + 1] === "-" && lang === "sql") {
      toks.push({ t: line.slice(i), c: "cm" });
      break;
    }
    // 字符串
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      let esc = false;
      while (j < n) {
        if (line[j] === quote && !esc) break;
        if (line[j] === "\\" && !esc) esc = true;
        else esc = false;
        j++;
      }
      toks.push({ t: line.slice(i, Math.min(j + 1, n)), c: "str" });
      i = j + 1;
      continue;
    }
    // 数字
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[\w.]/.test(line[j])) j++;
      toks.push({ t: line.slice(i, j), c: "var" });
      i = j;
      continue;
    }
    // 标识符
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[\w$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      const next = line[j];
      if (KEYWORDS.has(word)) toks.push({ t: word, c: "kw" });
      else if (/^[A-Z]/.test(word)) toks.push({ t: word, c: "type" });
      else if (next === "(") toks.push({ t: word, c: "fn" });
      else toks.push({ t: word, c: "var" });
      i = j;
      continue;
    }
    toks.push({ t: ch });
    i++;
  }
  return toks;
}

/* ── 浏览数据模型 ── */
interface BrowseEntry {
  name: string;
  type: "dir" | "file";
  path: string;
  size: number;
}

interface BrowseCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  avatar: string | null;
}

interface TreeNode extends BrowseEntry {
  children?: TreeNode[];
  loaded?: boolean;
}

interface OpenFile {
  path: string;
  content: string;
  size: number;
  tooLarge?: boolean;
}

const MAX_LINES = 2000;

/** 递归地把某个目录节点的 children 填充进文件树 */
function patchTree(nodes: TreeNode[], path: string, children: BrowseEntry[]): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === path) return { ...n, loaded: true, children };
    if (n.children) return { ...n, children: patchTree(n.children, path, children) };
    return n;
  });
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

export default function RepoPage() {
  const { provider } = usePlatform();
  const [repos, setRepos] = useState<{ full_name: string; name: string }[]>([]);
  const [sel, setSel] = useState<{ owner: string; repo: string }>({ owner: "", repo: "" });

  const [branches, setBranches] = useState<{ name: string }[]>([]);
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [ref, setRef] = useState("");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [openPaths, setOpenPaths] = useState<Set<string>>(new Set());
  const [activePath, setActivePath] = useState("");
  const [file, setFile] = useState<OpenFile | null>(null);
  const [latestCommit, setLatestCommit] = useState<BrowseCommit | null>(null);

  const [loadingRoot, setLoadingRoot] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [rootError, setRootError] = useState("");

  /** 加载某仓库某个分支的根目录（同时带回分支列表 / 默认分支 / 最新提交） */
  const loadRoot = useCallback(
    async (owner: string, repo: string, branch?: string) => {
      setLoadingRoot(true);
      setRootError("");
      setTree([]);
      setFile(null);
      setActivePath("");
      setOpenPaths(new Set());
      setLatestCommit(null);
      try {
        const q = new URLSearchParams({ owner, repo });
        if (branch) q.set("ref", branch);
        const res = await authFetch(`/api/${provider}/browse?${q.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        setBranches(d.branches ?? []);
        setDefaultBranch(d.defaultBranch || "main");
        setRef(d.ref || branch || d.defaultBranch || "main");
        setTree(d.entries ?? []);
        setLatestCommit(d.latestCommit ?? null);
      } catch (e) {
        setRootError((e as Error).message || "加载失败");
      } finally {
        setLoadingRoot(false);
      }
    },
    [provider],
  );

  // 1) 加载仓库列表，确定默认选中的仓库（支持 ?owner/repo 定位）
  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams(window.location.search);
    const qo = q.get("owner");
    const qr = q.get("repo");
    authFetch(`/api/${provider}/repos`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const list: { full_name: string; name: string }[] = (d.repos ?? []).map((x: any) => ({
          full_name: x.full_name,
          name: x.name,
        }));
        setRepos(list);
        if (qo && qr) setSel({ owner: qo, repo: qr });
        else if (list.length) {
          const [o, n] = list[0].full_name.split("/");
          setSel({ owner: o, repo: n });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [provider]);

  // 2) 选中仓库变化时加载根目录（初始 URL 带 ref 时沿用）
  useEffect(() => {
    if (!sel.owner || !sel.repo) return;
    const q = new URLSearchParams(window.location.search);
    loadRoot(sel.owner, sel.repo, q.get("ref") || undefined);
  }, [sel, loadRoot]);

  function switchTo(fullName: string) {
    const [o, n] = fullName.split("/");
    setSel({ owner: o, repo: n });
    window.history.replaceState(null, "", `/repo?owner=${encodeURIComponent(o)}&repo=${encodeURIComponent(n)}`);
  }

  function changeBranch(name: string) {
    if (name === ref || !sel.owner) return;
    setRef(name);
    loadRoot(sel.owner, sel.repo, name);
    window.history.replaceState(
      null,
      "",
      `/repo?owner=${encodeURIComponent(sel.owner)}&repo=${encodeURIComponent(sel.repo)}&ref=${encodeURIComponent(name)}`,
    );
  }

  /** 展开/折叠目录：首次展开时懒加载子目录 */
  async function toggleDir(node: TreeNode) {
    const next = new Set(openPaths);
    if (next.has(node.path)) {
      next.delete(node.path);
      setOpenPaths(next);
      return;
    }
    next.add(node.path);
    setOpenPaths(next);
    if (node.loaded || node.children) return;
    try {
      const q = new URLSearchParams({ owner: sel.owner, repo: sel.repo, ref, path: node.path });
      const res = await authFetch(`/api/${provider}/browse?${q.toString()}`);
      if (!res.ok) throw new Error("加载失败");
      const d = await res.json();
      setTree((t) => patchTree(t, node.path, d.entries ?? []));
    } catch {
      /* 拉取失败允许折叠重试 */
    }
  }

  /** 点击文件：加载真实内容 */
  async function openFile(node: TreeNode) {
    setActivePath(node.path);
    setLoadingFile(true);
    try {
      const q = new URLSearchParams({ owner: sel.owner, repo: sel.repo, ref, path: node.path });
      const res = await authFetch(`/api/${provider}/browse?${q.toString()}`);
      if (!res.ok) throw new Error("加载失败");
      const d = await res.json();
      if (d.kind === "file") {
        setFile({ path: node.path, content: d.content || "", size: d.size || 0, tooLarge: !!d.tooLarge });
      }
    } catch {
      setFile(null);
    } finally {
      setLoadingFile(false);
    }
  }

  /** 递归渲染文件树 */
  function renderNodes(nodes: TreeNode[], depth: number) {
    return nodes.map((n) => {
      const isDir = n.type === "dir";
      const isOpen = openPaths.has(n.path);
      const isActive = !isDir && activePath === n.path;
      return (
        <div key={n.path}>
          <button
            type="button"
            onClick={() => (isDir ? toggleDir(n) : openFile(n))}
            className={cn(
              "flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 font-mono text-[12.5px] text-left transition-colors",
              isActive
                ? "bg-[var(--amber-soft)] text-[var(--amber)]"
                : "text-face-2 hover:bg-ink-850 hover:text-foreground",
            )}
            style={{ paddingLeft: 6 + depth * 14 }}
            aria-expanded={isDir ? isOpen : undefined}
          >
            <span className="flex w-3.5 shrink-0 justify-center">
              {isDir ? (
                isOpen ? (
                  <ChevronDown className="size-3.5 text-face-3" />
                ) : (
                  <ChevronRight className="size-3.5 text-face-3" />
                )
              ) : null}
            </span>
            {isDir ? (
              isOpen ? (
                <FolderOpen className="size-3.5 shrink-0 text-[var(--amber)]" />
              ) : (
                <Folder className="size-3.5 shrink-0 text-[var(--amber)]" />
              )
            ) : (
              <FileCode2 className="size-3.5 shrink-0 text-face-3" />
            )}
            <span className="min-w-0 truncate">{n.name}</span>
          </button>
          {isDir && isOpen && n.children && renderNodes(n.children, depth + 1)}
        </div>
      );
    });
  }

  const fileLines = useMemo(() => (file ? file.content.split("\n") : []), [file]);
  const lang = file ? languageOf(file.path) : "text";
  const crumbPath = activePath.split("/").filter(Boolean);

  return (
    <Entrance className="space-y-5">
      {/* 面包屑 */}
      <nav aria-label="路径" className="flex flex-wrap items-center font-mono text-[12.5px] text-face-3">
        <span className="opacity-70">控制台</span>
        <span className="mx-1.5 opacity-40">/</span>
        <b className="text-face-2">
          {sel.owner || "—"} / {sel.repo || "—"}
        </b>
        <span className="mx-1.5 opacity-40">/</span>
        <span className="opacity-80">{ref || defaultBranch}</span>
        {crumbPath.map((seg, i) => (
          <span key={i} className="contents">
            <span className="mx-1.5 opacity-40">/</span>
            <span className={i === crumbPath.length - 1 ? "text-face-1" : "opacity-80"}>{seg}</span>
          </span>
        ))}
      </nav>

      {/* 页头 */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0">
          <SplitTitle
            key={`${sel.owner}/${sel.repo}`}
            className="font-display text-[clamp(26px,3vw,34px)] font-semibold leading-tight tracking-[-0.02em]"
          >
            {sel.owner || "—"} / <b className="text-amber">{sel.repo || "—"}</b>
          </SplitTitle>
          <p className="mt-1.5 text-[13px] text-face-3">
            {branches.length} 个分支 · 默认分支 <b className="text-face-2">{defaultBranch}</b>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <select
            value={sel.owner && sel.repo ? `${sel.owner}/${sel.repo}` : ""}
            onChange={(e) => switchTo(e.target.value)}
            aria-label="选择仓库"
            className="h-8 cursor-pointer rounded-md border border-line bg-ink-850 px-2 font-mono text-[12.5px] text-face-1 outline-none focus:border-amber"
          >
            {repos.length === 0 && <option value="">仓库加载中…</option>}
            {repos.map((r) => (
              <option key={r.full_name} value={r.full_name} className="bg-card">
                {r.full_name}
              </option>
            ))}
          </select>

          {/* 分支切换 */}
          <label className="relative inline-flex items-center">
            <GitBranch className="pointer-events-none absolute left-2.5 size-3.5 text-[var(--amber)]" />
            <select
              value={ref}
              onChange={(e) => changeBranch(e.target.value)}
              aria-label="切换分支"
              className="h-8 cursor-pointer appearance-none rounded-md border border-line-strong bg-ink-850 pr-7 pl-8 font-mono text-[12.5px] text-face-1 outline-none focus:border-amber"
            >
              {branches.length === 0 && <option value={ref || defaultBranch}>{ref || defaultBranch}</option>}
              {branches.map((b) => (
                <option key={b.name} value={b.name} className="bg-card">
                  {b.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-face-3" />
          </label>
        </div>
      </div>

      {/* 最新提交 banner */}
      {latestCommit ? (
        <div className="flex items-center gap-4 rounded-xl border border-border bg-ink-900 px-4.5 py-3.5">
          {latestCommit.avatar ? (
            <span className="size-7.5 shrink-0 overflow-hidden rounded-full border-2 border-line-strong">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={latestCommit.avatar} alt={latestCommit.author} className="size-full object-cover" />
            </span>
          ) : (
            <span className="flex size-7.5 shrink-0 items-center justify-center rounded-full border-2 border-line-strong bg-ink-800 font-mono text-[12px] text-amber">
              {latestCommit.author.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold">{latestCommit.message}</div>
            <div className="mt-0.5 font-mono text-[12px] text-face-3">
              {latestCommit.author} · {latestCommit.sha} · {timeAgo(latestCommit.date)}
            </div>
          </div>
          <Badge
            variant="secondary"
            className="ml-auto shrink-0 rounded-full border-transparent bg-[var(--amber-soft)] px-2.5 text-[var(--amber)]"
          >
            <GitCommitHorizontal className="size-3.5" />
            自动审查已启用
          </Badge>
        </div>
      ) : null}

      {/* 代码浏览器 */}
      <div className="overflow-hidden rounded-2xl border border-border bg-ink-950 shadow-[var(--shadow-card)]">
        {/* 窗口标题栏 */}
        <div className="flex items-center gap-2.5 border-b border-border bg-ink-900 px-4 py-2.5 font-mono text-xs text-face-2">
          <span className="flex gap-1.5">
            <i className="size-2.75 rounded-full bg-[var(--red)]" />
            <i className="size-2.75 rounded-full bg-[var(--amber)]" />
            <i className="size-2.75 rounded-full bg-[var(--green)]" />
          </span>
          <span className="ml-1 min-w-0 truncate text-face-3">
            {activePath ? (
              <>
                {crumbPath.slice(0, -1).map((s) => (
                  <span key={s}>
                    {s} <span className="opacity-40">/</span>{" "}
                  </span>
                ))}
                <b className="font-medium text-face-2">{crumbPath[crumbPath.length - 1]}</b>
              </>
            ) : (
              <>{ref || defaultBranch} · 根目录</>
            )}
          </span>
          {file && (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[var(--green-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--green)]">
              <span className="size-1.5 rounded-full bg-current" />
              {file.tooLarge ? "无法预览" : `${fileLines.length.toLocaleString()} 行`}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[250px_1fr]">
          {/* 文件树 */}
          <div className="max-h-56 overflow-auto border-b border-border bg-ink-900 p-3.5 lg:max-h-[620px] lg:border-r lg:border-b-0">
            <div className="flex items-center justify-between px-2.5 pb-2">
              <span className="text-[11px] font-semibold tracking-[0.08em] text-face-3 uppercase">文件</span>
              <GitBranch className="size-3.5 text-face-3" />
            </div>
            {loadingRoot ? (
              <div className="flex items-center gap-2 px-2.5 py-4 text-[12.5px] text-face-3">
                <Loader2 className="size-4 animate-spin" />
                正在加载文件树…
              </div>
            ) : rootError ? (
              <div className="px-2.5 py-4 text-[12.5px] text-[var(--red)]">{rootError}</div>
            ) : tree.length === 0 ? (
              <div className="px-2.5 py-4 text-[12.5px] text-face-3">仓库为空</div>
            ) : (
              <div className="space-y-0.5">{renderNodes(tree, 0)}</div>
            )}
          </div>

          {/* 代码区 */}
          <div className="min-w-0 overflow-auto">
            {/* 文件 tab */}
            <div className="flex items-center gap-0.5 border-b border-border bg-ink-900 px-2">
              {file ? (
                <div className="inline-flex items-center gap-2 border-b-2 border-[var(--amber)] bg-ink-950 px-3.5 py-2.5 font-mono text-[12.5px] text-foreground">
                  {file.path.split("/").pop()}
                  <button
                    type="button"
                    aria-label="关闭文件"
                    onClick={() => {
                      setFile(null);
                      setActivePath("");
                    }}
                    className="opacity-60 transition-opacity hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <div className="px-3.5 py-2.5 font-mono text-[12.5px] text-face-3">未打开文件</div>
              )}
            </div>

            {loadingFile ? (
              <div className="flex items-center justify-center gap-2 py-16 font-mono text-[12.5px] text-face-3">
                <Loader2 className="size-4 animate-spin" />
                正在加载文件…
              </div>
            ) : file ? (
              file.tooLarge ? (
                <div className="flex flex-col items-center justify-center py-16 text-face-3">
                  <FileCode2 className="size-10 opacity-30" />
                  <p className="mt-3 text-sm">文件过大或无法读取（超过 1MB 不提供预览）</p>
                </div>
              ) : fileLines.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-face-3">
                  <FileCode2 className="size-10 opacity-30" />
                  <p className="mt-3 text-sm">空文件</p>
                </div>
              ) : (
                <div className="py-1.5">
                  <CodeReveal key={file.path} disabled={fileLines.length > 400}>
                    {fileLines.slice(0, MAX_LINES).map((ln, i) => (
                      <div
                        key={i}
                        className="flex min-h-6 font-mono text-[12.5px] leading-6 hover:bg-ink-850"
                      >
                        <span className="w-11.5 shrink-0 pr-4 text-right text-[11.5px] text-face-3 select-none">
                          {i + 1}
                        </span>
                        <span className="pr-5 whitespace-pre">
                          {tokenizeLine(ln, lang).map((tok, k) => (
                            <span key={k} className={tok.c ? TOKEN_CLASS[tok.c] : undefined}>
                              {tok.t}
                            </span>
                          ))}
                        </span>
                      </div>
                    ))}
                    {fileLines.length > MAX_LINES && (
                      <div className="p-3 text-center text-xs text-face-3">
                        仅展示前 {MAX_LINES.toLocaleString()} 行 · 共 {fileLines.length.toLocaleString()} 行
                      </div>
                    )}
                  </CodeReveal>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-face-3">
                <FileCode2 className="size-10 opacity-30" />
                <p className="mt-3 text-sm">从左侧文件树选择一个文件查看内容</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Entrance>
  );
}

/** 代码行从左往右交错滑入（大文件跳过动画避免卡顿） */
function CodeReveal({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (!root.current || disabled) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(root.current.children, {
        x: 18,
        duration: 0.35,
        stagger: 0.02,
        delay: 0.2,
        ease: "power2.out",
        clearProps: "all",
      });
    },
    { scope: root }
  );
  return (
    <div ref={root} className="contents">
      {children}
    </div>
  );
}
