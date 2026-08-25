"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, Loader2, PlugZap, RefreshCw } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Switch } from "@/app/components/ui/switch";
import { cn } from "@/app/components/ui/utils";
import { Entrance, SplitTitle } from "@/app/components/motion";
import { usePlatform, type Platform } from "@/app/components/platform";
import { authFetch } from "@/lib/client/auth-fetch";

/* ── 事件 / 规则展示元数据（开关状态来自接口配置） ── */
const EVENTS = [
  { code: "pull_request", label: "打开 / 同步", on: true },
  { code: "push", label: "代码提交", on: true },
  { code: "pull_request_review", label: "审查", on: true },
  { code: "issue_comment", label: "评论", on: false },
];

const RULES = [
  { key: "skip_draft", label: "仅审查打开与非草稿的 PR", on: true },
  { key: "skip_bot", label: "跳过来自机器人账号的变更", on: true },
  { key: "threshold_pause", label: "变更超过阈值时暂停审查", on: false },
  { key: "retry", label: "失败重试（最多 3 次，指数退避）", on: true },
];

interface WebhookConfig {
  provider: Platform;
  url: string;
  enabled: boolean;
  secret: string | null;
  events: string[] | null;
  rules: Record<string, boolean> | null;
  repoCount: number | null;
  stats: { total: number; validRate: number; lastReceivedAt: string | null };
}

interface LogRow {
  id: number;
  event: string;
  action: string | null;
  prNumber: number | null;
  repository: string | null;
  deliveryId: string;
  validSignature: boolean;
  httpStatus: number | null;
  createdAt: string;
}

type TagTone = "green" | "amber" | "neutral" | "red";

function Tag({ tone = "neutral", children }: { tone?: TagTone; children: React.ReactNode }) {
  const toneCls: Record<TagTone, string> = {
    green: "border-[var(--green-soft)] bg-[var(--green-soft)] text-green",
    amber: "border-[var(--amber-soft)] bg-[var(--amber-soft)] text-amber",
    neutral: "border-line bg-ink-850 text-face-2",
    red: "border-[var(--red-soft)] bg-[var(--red-soft)] text-red",
  };
  const dotCls: Record<TagTone, string> = {
    green: "bg-green",
    amber: "bg-amber",
    neutral: "bg-face-3",
    red: "bg-red",
  };
  return (
    <Badge variant="outline" className={cn("rounded-md border px-2.5 py-0.5 text-[11px] font-medium", toneCls[tone])}>
      <span className={cn("size-1.5 shrink-0 rounded-full", dotCls[tone])} />
      {children}
    </Badge>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px] fill-current" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function GiteeMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px]" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#c71d23" />
      <path fill="#fff" d="M12 5.5c-3.6 0-6.5 2.9-6.5 6.5 0 3.6 2.9 6.5 6.5 6.5 3.6 0 6.5-2.9 6.5-6.5 0-3.6-2.9-6.5-6.5-6.5zm1.9 7.4h-3.8c-.3 0-.5-.3-.5-.7 0-.4.2-.7.5-.7h3.8c.3 0 .5.3.5.7 0 .4-.2.7-.5.7z" />
    </svg>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-line bg-ink-950 px-3 py-2 font-mono text-[12px]">
      <span className="w-[52px] shrink-0 font-sans text-[12px] font-semibold text-face-3">{label}</span>
      <span className="min-w-0 flex-1 truncate text-face-1" title={value}>
        {value}
      </span>
      <button
        type="button"
        aria-label={`复制 ${label}`}
        onClick={() => {
          navigator.clipboard?.writeText(value).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
        className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md border border-line text-face-2 transition-colors hover:border-[var(--amber-glow)] hover:bg-[var(--amber-soft)] hover:text-amber"
      >
        {copied ? <Check className="size-3.5 text-amber" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

function maskSecret(s: string): string {
  if (s.length <= 10) return `${s.slice(0, 3)}••••`;
  return `${s.slice(0, 7)}••••••••${s.slice(-4)}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "暂无";
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

/** Web Crypto HMAC-SHA256 → hex（测试发送用；需 secure context，失败由调用方降级） */
async function hmacHex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function WebhooksPage() {
  const { provider, meta, ready } = usePlatform();
  const [config, setConfig] = useState<WebhookConfig | null>(null);
  const [events, setEvents] = useState(EVENTS);
  const [rules, setRules] = useState(RULES);
  const [enabled, setEnabled] = useState(true);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");

  // 一键配置：仓库列表 + 选中 + 创建结果
  const [repos, setRepos] = useState<{ full_name: string; name: string }[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [hookLoading, setHookLoading] = useState(false);
  const [hookMsg, setHookMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadData = useCallback(async () => {
    if (!ready) return; // 身份未校正前不发平台请求，避免首帧误打错误平台接口产生 401
    setLoading(true);
    setLoadError("");
    try {
      const [cfgRes, logsRes, reposRes] = await Promise.all([
        authFetch("/api/webhook/config"),
        authFetch("/api/webhook/logs"),
        authFetch(`/api/${provider}/repos`),
      ]);
      if (cfgRes.ok) {
        const d: WebhookConfig = await cfgRes.json();
        setConfig(d);
        setEnabled(d.enabled);
        setEvents(d.events ? EVENTS.map((e) => ({ ...e, on: d.events!.includes(e.code) })) : EVENTS);
        setRules(d.rules ? RULES.map((r) => ({ ...r, on: d.rules![r.key] ?? r.on })) : RULES);
      } else {
        setLoadError("加载配置失败");
      }
      if (logsRes.ok) setLogs((await logsRes.json()).logs ?? []);
      if (reposRes.ok) {
        const list: { full_name: string; name: string }[] = ((await reposRes.json()).repos ?? []).map(
          (x: any) => ({ full_name: x.full_name, name: x.name }),
        );
        setRepos(list);
        setSelectedRepo((prev) => prev || list[0]?.full_name || "");
      }
    } catch {
      setLoadError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [provider, ready]);

  useEffect(() => {
    loadData();
  }, [loadData, provider]);

  /** 保存配置到后端（切换事件/规则/启用开关时调用） */
  const persist = useCallback(
    async (next: { events?: typeof events; rules?: typeof rules; enabled?: boolean }) => {
      setSaving(true);
      setSaveError("");
      try {
        const res = await authFetch("/api/webhook/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            events: (next.events ?? events).filter((e) => e.on).map((e) => e.code),
            rules: Object.fromEntries((next.rules ?? rules).map((r) => [r.key, r.on])),
            enabled: next.enabled ?? enabled,
          }),
        });
        if (res.ok) {
          setConfig(await res.json());
        } else {
          const d = await res.json().catch(() => ({}));
          setSaveError(`保存失败（HTTP ${res.status}）：${d.error || "未知错误"}`);
        }
      } catch {
        setSaveError("保存失败，请稍后重试");
      } finally {
        setSaving(false);
      }
    },
    [events, rules, enabled],
  );

  function toggleEvent(idx: number) {
    const next = events.map((e, i) => (i === idx ? { ...e, on: !e.on } : e));
    setEvents(next);
    persist({ events: next });
  }

  function toggleRule(idx: number) {
    const next = rules.map((r, i) => (i === idx ? { ...r, on: !r.on } : r));
    setRules(next);
    persist({ rules: next });
  }

  function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    persist({ enabled: next });
  }

  /** 轮换 Secret */
  async function rotateSecret() {
    setSaving(true);
    try {
      const res = await authFetch("/api/webhook/config/rotate-secret", { method: "POST" });
      if (res.ok) {
        setConfig(await res.json());
        setShowSecret(true);
      }
    } finally {
      setSaving(false);
    }
  }

  /** 一键配置：调平台 API 为选中仓库创建 Webhook（回填 URL + Secret + 订阅事件） */
  async function createHook() {
    if (!selectedRepo || !config?.secret) return;
    const [owner, repo] = selectedRepo.split("/");
    setHookLoading(true);
    setHookMsg(null);
    try {
      const res = await authFetch("/api/webhook/hooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setHookMsg({
          ok: true,
          text: d.created
            ? `已在 ${selectedRepo} 创建 Webhook，平台开始推送事件`
            : `${selectedRepo} 已存在指向本服务的 Webhook（跳过）`,
        });
      } else {
        const hint =
          res.status === 403
            ? "平台返回 403：当前 token 无仓库管理权限（需 repo / 仓库管理 scope）"
            : res.status === 404
              ? "仓库不存在或无访问权限"
              : "";
        setHookMsg({ ok: false, text: (d.error || `创建失败 HTTP ${res.status}`) + (hint ? ` · ${hint}` : "") });
      }
    } catch {
      setHookMsg({ ok: false, text: "创建失败，请稍后重试" });
    } finally {
      setHookLoading(false);
    }
  }

  /** 向本服务接收端点发一条带正确签名的测试事件，验证完整链路 */
  async function testSend() {
    if (!config?.secret) return;
    setTesting(true);
    try {
      const payload = {
        action: "opened",
        number: 999,
        pull_request: { number: 999, title: "Webhook 测试 PR" },
        repository: { full_name: `demo/${provider}`, name: provider },
      };
      const raw = JSON.stringify(payload);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (provider === "github") {
        headers["X-GitHub-Event"] = "pull_request";
        headers["X-GitHub-Delivery"] = crypto.randomUUID();
        headers["X-Hub-Signature-256"] = `sha256=${await hmacHex(config.secret, raw)}`;
      } else {
        headers["X-Gitee-Event"] = "pull_request";
        headers["X-Gitee-Timestamp"] = String(Math.floor(Date.now() / 1000));
        headers["X-Gitee-Token"] = config.secret;
      }
      await fetch(`/api/webhook/${provider}`, { method: "POST", headers, body: raw });
      const logsRes = await authFetch("/api/webhook/logs");
      if (logsRes.ok) setLogs((await logsRes.json()).logs ?? []);
      loadData();
    } catch {
      /* 测试失败不阻塞 */
    } finally {
      setTesting(false);
    }
  }

  const validRate = config ? Math.round((config.stats.validRate || 0) * 100) : 0;
  const repoSub = config?.repoCount != null ? `已接入 · ${config.repoCount} 个仓库` : "全局端点 · 监听全部仓库";
  const secretText = config?.secret ? (showSecret ? config.secret : maskSecret(config.secret)) : "尚未配置";

  return (
    <Entrance className="space-y-6">
      {/* ===== 页头 ===== */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <SplitTitle className="font-display text-[26px] font-semibold tracking-[-0.02em]">
            Webhook <span className="text-amber">端点</span>
          </SplitTitle>
          <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-face-2">
            PR 变动经由端点实时推送，自动触发 AI 审查。请将下方 URL 配置到代码平台。
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={testSend}
            disabled={testing || saving || !config?.secret}
            className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-line bg-ink-850 px-3 text-[12.5px] text-face-2 transition-colors hover:border-line-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            测试发送
          </button>
          <Tag tone={enabled ? "green" : "amber"}>
            {meta.name} {enabled ? "监听中" : "已暂停"}
          </Tag>
        </div>
      </div>

      {loadError && (
        <div className="rounded-lg border border-[var(--red-soft)] bg-[var(--red-soft)] px-3.5 py-2.5 text-[12.5px] text-red">
          {loadError} · 请确认已登录对应平台。
        </div>
      )}

      {saveError && (
        <div className="rounded-lg border border-[var(--red-soft)] bg-[var(--red-soft)] px-3.5 py-2.5 text-[12.5px] text-red">
          {saveError}
        </div>
      )}

      {/* ===== 端点卡片（当前登录平台，数据独立） ===== */}
      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-5 text-[12.5px] text-face-3">
          <Loader2 className="size-4 animate-spin" />
          正在加载端点配置…
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-[10px]",
                  provider === "gitee" ? "bg-[rgba(199,29,35,0.14)] text-[#c71d23]" : "bg-[rgba(255,255,255,0.08)]",
                )}
              >
                {provider === "gitee" ? <GiteeMark /> : <GitHubMark />}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-display text-[15px] font-semibold">
                  {meta.name} 端点{" "}
                  <Tag tone={enabled ? "green" : "amber"}>{enabled ? "活跃" : "已暂停"}</Tag>
                </div>
                <div className="mt-0.5 text-[12px] text-face-3">{repoSub}</div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[11px] text-face-3">监听</span>
                <Switch checked={enabled} onCheckedChange={toggleEnabled} aria-label="启用 Webhook 监听" />
              </div>
            </div>

            {config ? (
              <>
                <CopyRow label="URL" value={config.url} />
                <div className="mt-2 flex items-center gap-2 rounded-md border border-line bg-ink-950 px-3 py-2 font-mono text-[12px]">
                  <span className="w-[52px] shrink-0 font-sans text-[12px] font-semibold text-face-3">Secret</span>
                  <span className="min-w-0 flex-1 truncate text-face-1" title={config.secret || ""}>
                    {secretText}
                  </span>
                  <button
                    type="button"
                    aria-label={showSecret ? "隐藏 Secret" : "显示 Secret"}
                    onClick={() => setShowSecret((v) => !v)}
                    className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md border border-line text-face-2 transition-colors hover:text-amber"
                  >
                    {showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                  <CopyRowSecret secret={config.secret} />
                  <button
                    type="button"
                    onClick={rotateSecret}
                    disabled={saving}
                    className="shrink-0 cursor-pointer rounded-md border border-line px-2 py-1 text-[11px] text-face-2 transition-colors hover:border-amber hover:text-amber disabled:opacity-50"
                  >
                    轮换
                  </button>
                </div>
                <div className="mt-3.5 flex items-center gap-2.5">
                  <Tag tone={config.stats.total > 0 ? (config.stats.validRate >= 0.9 ? "green" : "amber") : "neutral"}>
                    {config.stats.total > 0 ? `验签通过率 ${validRate}%` : "暂无触发记录"}
                  </Tag>
                  <span className="ml-auto text-[12px] text-face-3">
                    最近触发 · {timeAgo(config.stats.lastReceivedAt)} · 共 {config.stats.total} 次
                  </span>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ===== 一键配置（调平台 API 为仓库创建 Webhook） ===== */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="font-display text-[15px] font-semibold">仓库一键配置</div>
        <p className="mt-1 text-[12.5px] text-face-3">
          调用 {meta.name} API 为仓库创建 Webhook，自动回填上面的 URL 与 Secret，无需手动去平台配置。
          需要在平台具备仓库管理权限。
        </p>
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <select
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
            aria-label="选择要配置的仓库"
            className="h-8 min-w-[220px] cursor-pointer rounded-md border border-line bg-ink-850 px-2 font-mono text-[12.5px] text-face-1 outline-none focus:border-amber"
          >
            {repos.length === 0 && <option value="">仓库加载中…</option>}
            {repos.map((r) => (
              <option key={r.full_name} value={r.full_name} className="bg-card">
                {r.full_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={createHook}
            disabled={hookLoading || !selectedRepo || !config?.secret}
            className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-line bg-ink-850 px-3 text-[12.5px] text-face-2 transition-colors hover:border-amber hover:text-amber disabled:cursor-not-allowed disabled:opacity-50"
          >
            {hookLoading ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
            一键配置
          </button>
          {!config?.secret && (
            <span className="text-[12px] text-face-3">先在上方保存一次事件订阅以生成 Secret</span>
          )}
        </div>
        {hookMsg && (
          <div
            className={cn(
              "mt-3 rounded-md border px-3 py-2 text-[12.5px]",
              hookMsg.ok
                ? "border-[var(--green-soft)] bg-[var(--green-soft)] text-green"
                : "border-[var(--red-soft)] bg-[var(--red-soft)] text-red",
            )}
          >
            {hookMsg.text}
          </div>
        )}
      </div>

      {/* ===== 事件订阅 + 通知规则 ===== */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="font-display text-[15px] font-semibold">事件订阅</div>
          <p className="mt-1 mb-3 text-[12.5px] text-face-3">选择触发自动审查的 Webhook 事件。</p>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {events.map((e, i) => (
              <div key={e.code} className="flex items-center gap-2.5 py-2.5">
                <code className="font-mono text-[12.5px] text-[var(--cyan)]">{e.code}</code>
                <span className="text-[13.5px] text-face-2">{e.label}</span>
                <Switch
                  checked={e.on}
                  onCheckedChange={() => toggleEvent(i)}
                  disabled={saving}
                  className="ml-auto"
                  aria-label={`订阅 ${e.code}`}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="font-display text-[15px] font-semibold">通知规则</div>
          <p className="mt-1 mb-3 text-[12.5px] text-face-3">控制哪些变更进入自动审查与通知。</p>
          <div className="grid grid-cols-1 gap-1">
            {rules.map((r, i) => (
              <div key={r.key} className="flex items-center gap-2.5 py-2.5">
                <span className="flex-1 text-[13.5px] text-face-2">{r.label}</span>
                <Switch
                  checked={r.on}
                  onCheckedChange={() => toggleRule(i)}
                  disabled={saving}
                  aria-label={r.label}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== 最近触发记录 ===== */}
      <div>
        <div className="mb-3.5 flex items-end justify-between">
          <h2 className="font-display text-[17px] font-semibold">最近触发记录</h2>
          <span className="text-[12.5px] text-face-3">保留最近 30 天</span>
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-face-3">
                  <th className="px-4 py-3 font-medium">时间</th>
                  <th className="px-4 py-3 font-medium">来源</th>
                  <th className="px-4 py-3 font-medium">事件</th>
                  <th className="px-4 py-3 font-medium">仓库</th>
                  <th className="px-4 py-3 font-medium">验签</th>
                  <th className="px-4 py-3 text-right font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-[12.5px] text-face-3">
                      暂无触发记录 · 可用「测试发送」验证链路
                    </td>
                  </tr>
                ) : (
                  logs.map((row) => (
                    <tr key={row.id} className="border-b border-line last:border-b-0 hover:bg-ink-850">
                      <td className="px-4 py-3 text-[12.5px] text-face-3">{timeAgo(row.createdAt)}</td>
                      <td className="px-4 py-3 font-mono text-[12px] text-face-1">{provider}</td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-[12.5px] text-[var(--cyan)]">{row.event}</code>
                        {row.action && <span className="ml-1.5 text-[11.5px] text-face-3">· {row.action}</span>}
                      </td>
                      <td className="px-4 py-3 text-face-1">
                        {row.repository || "—"}
                        {row.prNumber ? ` #${row.prNumber}` : ""}
                      </td>
                      <td className="px-4 py-3">
                        <Tag tone={row.validSignature ? "green" : "red"}>
                          {row.validSignature ? "通过" : "未通过"}
                        </Tag>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Tag tone={row.httpStatus === 200 ? "green" : "red"}>
                          {row.httpStatus ?? "—"}
                        </Tag>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Entrance>
  );
}

/** Secret 行内的复制按钮（复用 CopyRow 视觉，不重复包装） */
function CopyRowSecret({ secret }: { secret: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="复制 Secret"
      disabled={!secret}
      onClick={() => {
        if (!secret) return;
        navigator.clipboard?.writeText(secret).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md border border-line text-face-2 transition-colors hover:border-[var(--amber-glow)] hover:bg-[var(--amber-soft)] hover:text-amber disabled:cursor-not-allowed disabled:opacity-50"
    >
      {copied ? <Check className="size-3.5 text-amber" /> : <Copy className="size-3.5" />}
    </button>
  );
}
