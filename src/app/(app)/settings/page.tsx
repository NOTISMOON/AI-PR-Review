"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderGit2, Link2, ListChecks, Loader2, Save, Sparkles } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Switch } from "@/app/components/ui/switch";
import { cn } from "@/app/components/ui/utils";
import { Entrance, SplitTitle } from "@/app/components/motion";
import { AnimatedSelect } from "@/app/components/animated-select";
import { usePlatform } from "@/app/components/platform";
import { authFetch } from "@/lib/client/auth-fetch";

const RISK_LEVELS = ["宽松", "默认", "严格"];
const DEPTH_LEVELS = ["轻度", "标准", "深度"];

interface AiSettings {
  model: string;
  temperature: number;
  maxComments: string;
  riskThreshold: string;
  /** 审查深度：fast | standard | deep（轻度 / 标准 / 深度） */
  depth: string;
}
interface SwitchSettings {
  auto_write: boolean;
  set_status: boolean;
  diff_only: boolean;
  skip_draft: boolean;
}
interface RepoRow {
  full_name: string;
  name: string;
  autoReview: boolean;
  busy?: boolean;
}

type TagTone = "green" | "amber" | "neutral";

function Tag({ tone = "neutral", children }: { tone?: TagTone; children: React.ReactNode }) {
  const toneCls: Record<TagTone, string> = {
    green: "border-[var(--green-soft)] bg-[var(--green-soft)] text-green",
    amber: "border-[var(--amber-soft)] bg-[var(--amber-soft)] text-amber",
    neutral: "border-line bg-ink-850 text-face-2",
  };
  const dotCls: Record<TagTone, string> = { green: "bg-green", amber: "bg-amber", neutral: "bg-face-3" };
  return (
    <Badge variant="outline" className={cn("rounded-md border px-2.5 py-0.5 text-[11px] font-medium", toneCls[tone])}>
      <span className={cn("size-1.5 shrink-0 rounded-full", dotCls[tone])} />
      {children}
    </Badge>
  );
}

function SectionHead({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--amber-soft)] text-amber">
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="font-display text-[15px] font-semibold">{title}</h3>
        <div className="mt-0.5 text-[12.5px] text-face-3">{hint}</div>
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}

function FormRow({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-5 border-b border-line py-3.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-face-1">{title}</div>
        <div className="mt-0.5 text-[12.5px] text-face-3">{desc}</div>
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  );
}

function Seg({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-md border border-line bg-ink-850 p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={cn(
            "cursor-pointer rounded px-3 py-1 text-[12.5px] font-medium transition-colors",
            o === value ? "bg-[var(--amber)] text-[var(--text-on-amber)]" : "text-face-2 hover:text-foreground",
          )}
        >
          {o}
        </button>
      ))}
    </div>
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

export default function SettingsPage() {
  const { provider, meta } = usePlatform();
  const [ai, setAi] = useState<AiSettings>({ model: "", temperature: 0.2, maxComments: "20", riskThreshold: "默认", depth: "standard" });
  const [switches, setSwitches] = useState<SwitchSettings>({ auto_write: true, set_status: true, diff_only: true, skip_draft: false });
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/settings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.ai) setAi({ ...ai, ...d.ai });
      if (d.switches) setSwitches({ ...switches, ...d.switches });
      setModels(d.models ?? []);
      setRepos((d.repos ?? []).map((r: { full_name: string; name: string; autoReview: boolean }) => ({ ...r })));
    } catch {
      setError("加载设置失败");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  useEffect(() => {
    load();
  }, [load, provider]);

  function toggleSwitch(key: keyof SwitchSettings) {
    setSwitches((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  /** 仓库自动审查开关：开启 = 自动为该仓库配置 Webhook */
  async function toggleRepo(repo: RepoRow) {
    const next = !repo.autoReview;
    setRepos((prev) => prev.map((r) => (r.full_name === repo.full_name ? { ...r, autoReview: next, busy: true } : r)));
    setError("");
    setToast("");
    try {
      const [o, n] = repo.full_name.split("/");
      const res = await authFetch(
        `/api/review/repos/${encodeURIComponent(o)}/${encodeURIComponent(n)}/auto`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) },
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRepos((prev) => prev.map((r) => (r.full_name === repo.full_name ? { ...r, autoReview: !next } : r)));
        setError(d.error || `操作失败（HTTP ${res.status}）`);
        return;
      }
      setToast(
        next
          ? `已开启 ${repo.name} 自动审查${d.webhookConfigured ? " · 已自动配置 Webhook" : ""}`
          : `已关闭 ${repo.name} 自动审查${d.webhookDestroyed ? " · 已销毁 Webhook" : ""}`,
      );
      setTimeout(() => setToast(""), 3000);
    } catch {
      setRepos((prev) => prev.map((r) => (r.full_name === repo.full_name ? { ...r, autoReview: !next } : r)));
      setError("操作失败，请稍后重试");
    } finally {
      setRepos((prev) => prev.map((r) => (r.full_name === repo.full_name ? { ...r, busy: false } : r)));
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const res = await authFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai, switches }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || `保存失败（HTTP ${res.status}）`);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Entrance className="space-y-5">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-5 text-[12.5px] text-face-3">
          <Loader2 className="size-4 animate-spin" /> 正在加载设置…
        </div>
      </Entrance>
    );
  }

  return (
    <Entrance className="space-y-5">
      {/* ===== 页头 ===== */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <SplitTitle className="font-display text-[26px] font-semibold tracking-[-0.02em]">
            全局 <span className="text-amber">设置</span>
          </SplitTitle>
          <p className="mt-1.5 text-[13.5px] text-face-2">
            管理 AI 审查模型、规则、事件订阅与已接入仓库。
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {saved && <Tag tone="green">已保存</Tag>}
          <Button onClick={save} disabled={saving} className="gap-1.5 bg-amber text-[var(--text-on-amber)] hover:bg-amber/90">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存设置
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--red-soft)] bg-[var(--red-soft)] px-3.5 py-2.5 text-[12.5px] text-red">
          {error}
        </div>
      )}

      {toast && (
        <div className="rounded-lg border border-[var(--green-soft)] bg-[var(--green-soft)] px-3.5 py-2.5 text-[12.5px] text-green">
          {toast}
        </div>
      )}

      {/* ===== AI 审查 ===== */}
      <section className="rounded-xl border border-border bg-card p-5">
        <SectionHead icon={<Sparkles className="size-[18px]" />} title="AI 审查" hint="审查所用的模型与输出偏好（模型为空则自动选择）" />
        <FormRow title="审查模型" desc="用于生成结构化审查评论的路由模型">
          <AnimatedSelect
            value={ai.model}
            onChange={(v) => setAi((prev) => ({ ...prev, model: v }))}
            ariaLabel="选择模型"
            triggerClassName="h-9 w-52 px-3 text-[13px]"
            options={[
              { value: "", label: "自动选择" },
              ...models.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
        </FormRow>
        <FormRow title="创作温度" desc="控制评论的随机性与创造力">
          <span className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={ai.temperature}
              onChange={(e) => setAi((prev) => ({ ...prev, temperature: Number(e.target.value) }))}
              aria-label="温度"
              className="w-44 accent-amber"
            />
            <span className="w-8 text-right font-mono text-[12.5px] text-amber">{ai.temperature.toFixed(1)}</span>
          </span>
        </FormRow>
        <FormRow title="单次最大评论数" desc="每次审查最多回写的评论条数">
          <Input
            type="number"
            min={1}
            max={100}
            value={ai.maxComments}
            onChange={(e) => setAi((prev) => ({ ...prev, maxComments: e.target.value }))}
            aria-label="最大评论数"
            className="w-24 text-right"
          />
        </FormRow>
        <FormRow title="审查深度" desc="自动审查的分析粒度：轻度更快，深度更全面">
          <Seg
            options={DEPTH_LEVELS}
            value={{ fast: "轻度", standard: "标准", deep: "深度" }[ai.depth] ?? "标准"}
            onChange={(v) =>
              setAi((prev) => ({ ...prev, depth: { 轻度: "fast", 标准: "standard", 深度: "deep" }[v] ?? "standard" }))
            }
          />
        </FormRow>
        <FormRow title="风险阈值" desc="判定问题严重程度的口径：宽松更宽容，严格更严格">
          <Seg options={RISK_LEVELS} value={ai.riskThreshold} onChange={(v) => setAi((prev) => ({ ...prev, riskThreshold: v }))} />
        </FormRow>
      </section>

      {/* ===== 审查规则 ===== */}
      <section className="rounded-xl border border-border bg-card p-5">
        <SectionHead icon={<ListChecks className="size-[18px]" />} title="审查规则" hint="决定评论如何生成与回写" />
        {(
          [
            { key: "auto_write" as const, label: "自动回写评论", desc: "审查完成后自动向 PR 提交评论" },
            { key: "set_status" as const, label: "设置提交状态", desc: "将审查结果写入 PR 的提交状态检查" },
            { key: "diff_only" as const, label: "仅审查变更行", desc: "只对 diff 中新增/修改的行生成评论" },
            { key: "skip_draft" as const, label: "忽略 WIP / 草稿", desc: "跳过标题含 WIP 或处于草稿状态的 PR" },
          ]
        ).map((s) => (
          <FormRow key={s.key} title={s.label} desc={s.desc}>
            <Switch checked={switches[s.key]} onCheckedChange={() => toggleSwitch(s.key)} aria-label={s.label} />
          </FormRow>
        ))}
      </section>

      {/* ===== 已接入仓库 ===== */}
      <section className="rounded-xl border border-border bg-card p-5">
        <SectionHead icon={<FolderGit2 className="size-[18px]" />} title="已接入仓库" hint="开启后自动为该仓库配置 Webhook 并启动自动审查（{meta.name} 真实列表）" />
        {repos.length === 0 ? (
          <p className="py-4 text-center text-[12.5px] text-face-3">暂无仓库 · 请先在对应平台登录</p>
        ) : (
          repos.map((repo) => (
            <div key={repo.full_name} className="flex items-center gap-3 border-b border-line py-3.5 last:border-b-0">
              <span className="size-2.5 shrink-0 rounded-[3px] bg-[var(--violet)]" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-face-1">{repo.name}</div>
                <div className="mt-0.5 font-mono text-[12px] text-face-3">{repo.full_name}</div>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-3">
                {repo.busy ? (
                  <span className="inline-flex items-center gap-1.5 text-[11.5px] text-face-3">
                    <Loader2 className="size-3.5 animate-spin" /> 配置中…
                  </span>
                ) : (
                  <Tag tone={repo.autoReview ? "green" : "neutral"}>{repo.autoReview ? "已开启" : "未开启"}</Tag>
                )}
                <Switch
                  checked={repo.autoReview}
                  disabled={repo.busy}
                  onCheckedChange={() => toggleRepo(repo)}
                  aria-label={`开启 ${repo.name} 自动审查`}
                />
              </div>
            </div>
          ))
        )}
      </section>

      {/* ===== 账号与连接 ===== */}
      <section className="rounded-xl border border-border bg-card p-5">
        <SectionHead icon={<Link2 className="size-[18px]" />} title="账号与连接" hint={`当前以 ${meta.name} 身份登录 · 数据相互独立`} />
        <div className="relative flex items-center gap-3.5 py-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[rgba(255,255,255,0.08)] text-foreground">
            {provider === "github" ? <GitHubMark /> : <GiteeMark />}
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-face-1">{meta.user}</div>
            <div className="mt-0.5 text-[12px] text-face-3">{provider === "github" ? "GitHub · 只读代码 + 提交 review" : `Gitee (${meta.handle}) · 只读代码 + 提交 review`}</div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <Tag tone="green">已连接</Tag>
            <a href="/api/auth/logout" className="cursor-pointer rounded-md px-2.5 py-1.5 text-[12.5px] text-red transition-colors hover:bg-red/10">
              断开
            </a>
          </div>
        </div>
      </section>
    </Entrance>
  );
}
