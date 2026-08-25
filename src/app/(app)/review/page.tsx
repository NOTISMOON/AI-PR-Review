"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  FileCode2,
  GitPullRequest,
  Loader2,
  MessageSquare,
  RefreshCw,
  X,
} from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/components/ui/utils";
import { Entrance, SplitTitle } from "@/app/components/motion";
import { usePlatform } from "@/app/components/platform";
import { authFetch } from "@/lib/client/auth-fetch";

interface Job {
  id: number;
  prNumber: number;
  repoFullName: string;
  prTitle: string | null;
  status: string;
  decision: string;
  summary: string | null;
  riskLevel: string | null;
  riskCount: number;
  provider: string | null;
  model: string | null;
  depth: string | null;
  result: Record<string, unknown> | null;
  completedAt: string | null;
  createdAt: string;
}

interface RiskItem {
  severity: string;
  title: string;
  description: string;
  file: string;
  line: number;
  suggestion: string;
  confidence: string;
  category?: string;
}

interface IssueItem {
  id: number;
  kind: string;
  severity: string | null;
  title: string;
  description: string | null;
  file: string | null;
  line: number | null;
  suggestion: string | null;
  status: string;
}

const DECISION: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "待处理", cls: "border-amber/40 bg-amber/10 text-amber" },
  APPROVED: { label: "已批准", cls: "border-green/40 bg-[var(--green-soft)] text-green" },
  REQUEST_CHANGES: { label: "请求变更", cls: "border-red/40 bg-[var(--red-soft)] text-red" },
  COMMENTED: { label: "已评论", cls: "border-cyan/40 bg-cyan/10 text-cyan" },
  DISMISSED: { label: "已关闭", cls: "border-line bg-ink-850 text-face-2" },
};

const LEVEL: Record<string, { label: string; cls: string }> = {
  high: { label: "高风险", cls: "border-red/40 bg-[var(--red-soft)] text-red" },
  medium: { label: "中等", cls: "border-amber/40 bg-amber/10 text-amber" },
  low: { label: "低风险", cls: "border-green/40 bg-[var(--green-soft)] text-green" },
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

export default function ReviewPage() {
  const { provider, meta } = usePlatform();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ job: Job; issues: IssueItem[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/review/tasks");
      if (res.ok) {
        const d = await res.json();
        setJobs(d.jobs ?? []);
        if (d.jobs?.length) {
          const first = selectedId && d.jobs.some((j: Job) => j.id === selectedId) ? selectedId : d.jobs[0].id;
          setSelectedId(first);
        } else {
          setSelectedId(null);
          setDetail(null);
        }
      } else {
        setError("加载审查队列失败");
      }
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadList();
  }, [loadList, provider]);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await authFetch(`/api/review/tasks/${id}`);
      if (res.ok) setDetail(await res.json());
    } catch {
      /* ignore */
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  async function decide(action: "approve" | "request_changes" | "comment" | "dismiss", bodyComment?: string) {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/review/tasks/${selectedId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment: bodyComment }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || `操作失败（HTTP ${res.status}）`);
        return;
      }
      setComment("");
      await Promise.all([loadList(), loadDetail(selectedId)]);
    } catch {
      setError("操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function applyIssue(issueId: number, status: "accepted" | "dismissed") {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/review/tasks/${selectedId}/issues/${issueId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) await loadDetail(selectedId);
    } finally {
      setBusy(false);
    }
  }

  const job = detail?.job ?? null;
  const risks = (job?.result as { risks?: RiskItem[] } | null)?.risks ?? [];

  return (
    <Entrance className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      {/* ===== 页头 ===== */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <SplitTitle className="font-display text-[26px] font-semibold tracking-[-0.02em]">
            审查<b className="text-amber">处理中心</b>
          </SplitTitle>
          <p className="mt-1 text-[13.5px] text-face-2">
            Webhook 监听 PR 变更后由 LangGraph 自动审查（四维度并行），你在此批准、评论、采纳建议或拒绝合并。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadList} disabled={loading}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> 刷新
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--red-soft)] bg-[var(--red-soft)] px-3.5 py-2.5 text-[12.5px] text-red">
          {error}
        </div>
      )}

      {/* ===== 队列 + 详情 ===== */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_1fr]">
        {/* 左：队列 */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-display text-[15px] font-semibold">审查队列</span>
            <Badge variant="outline" className="border-line text-face-3">
              {jobs.length}
            </Badge>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-[12.5px] text-face-3">
              <Loader2 className="size-4 animate-spin" /> 加载中…
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-[12.5px] text-face-3">
              <GitPullRequest className="size-8 opacity-30" />
              <p>暂无自动审查记录</p>
              <p className="max-w-[220px] opacity-70">
                在 GitHub 配置 Webhook 后，PR 打开/同步将自动触发审查并出现在这里
              </p>
            </div>
          ) : (
            <div className="flex max-h-[640px] flex-col gap-1.5 overflow-auto">
              {jobs.map((j) => {
                const isSel = j.id === selectedId;
                return (
                  <button
                    key={j.id}
                    type="button"
                    onClick={() => setSelectedId(j.id)}
                    className={cn(
                      "cursor-pointer rounded-lg border px-3 py-2.5 text-left transition-colors",
                      isSel ? "border-amber/50 bg-[var(--amber-soft)]" : "border-line bg-ink-900 hover:border-line-strong",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-[12px] text-face-1">
                        {j.repoFullName.split("/")[1] || j.repoFullName} <b className="text-amber">#{j.prNumber}</b>
                      </span>
                      <Badge className={cn("ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10.5px]", DECISION[j.decision]?.cls)} variant="outline">
                        {DECISION[j.decision]?.label ?? j.decision}
                      </Badge>
                    </div>
                    <div className="mt-1 line-clamp-1 text-[12px] text-face-2">{j.prTitle || "—"}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-face-3">
                      <span className={cn("rounded px-1.5 py-px font-mono", LEVEL[j.riskLevel ?? "low"]?.cls)}>
                        {LEVEL[j.riskLevel ?? "low"]?.label ?? j.riskLevel}
                      </span>
                      <span>{j.riskCount} 问题</span>
                      <span className="ml-auto">{timeAgo(j.completedAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 右：详情 */}
        <div className="rounded-xl border border-border bg-card p-5">
          {!selectedId ? (
            <div className="flex flex-col items-center gap-2 py-16 text-face-3">
              <Clock className="size-8 opacity-30" />
              <p className="text-[13px]">等待自动审查结果…</p>
            </div>
          ) : detailLoading ? (
            <div className="flex flex-col items-center gap-3 py-16 text-face-3">
              <Loader2 className="size-6 animate-spin text-amber" />
              <p className="text-[13px]">加载审查详情…</p>
            </div>
          ) : job ? (
            <div className="flex flex-col gap-5">
              {/* 头部 */}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[15px] text-amber">#{job.prNumber}</span>
                  <span className="font-display text-[16px] font-semibold">{job.prTitle || "—"}</span>
                  <Badge className={cn("ml-auto", DECISION[job.decision]?.cls)} variant="outline">
                    {DECISION[job.decision]?.label ?? job.decision}
                  </Badge>
                </div>
                <div className="mt-1.5 font-mono text-[12px] text-face-3">
                  {job.repoFullName} · {job.provider || "ai"} · {job.depth} · {timeAgo(job.completedAt)}
                </div>
                {job.summary && (
                  <p className="mt-3 whitespace-pre-wrap rounded-lg border border-line bg-ink-950/60 p-3.5 text-[13px] leading-[1.7] text-face-2">
                    {job.summary}
                  </p>
                )}
              </div>

              {/* 决策操作条 */}
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <Button
                  size="sm"
                  disabled={busy || job.decision === "APPROVED"}
                  onClick={() => decide("approve")}
                  className="gap-1.5 bg-green text-white hover:bg-green/90"
                >
                  <Check className="size-3.5" /> 批准合并
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || job.decision === "REQUEST_CHANGES"}
                  onClick={() => decide("request_changes")}
                  className="gap-1.5 border-red/40 text-red hover:bg-red/10"
                >
                  <X className="size-3.5" /> 请求变更（拒绝合并）
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || job.decision === "DISMISSED"}
                  onClick={() => decide("dismiss")}
                  className="border-line text-face-2"
                >
                  关闭 PR
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  <input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="附加评论（可选）…"
                    aria-label="附加评论"
                    className="h-8 w-48 rounded-md border border-line bg-ink-850 px-2.5 text-[12px] text-foreground placeholder:text-face-3 focus:border-amber focus:outline-none"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => decide("comment", comment)}
                    className="gap-1.5"
                  >
                    <MessageSquare className="size-3.5" /> 评论
                  </Button>
                </div>
              </div>

              {/* 问题列表 */}
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle className="size-4 text-red" />
                  <span className="font-display text-[15px] font-semibold">AI 识别的问题（{risks.length}）</span>
                </div>
                {risks.length === 0 ? (
                  <div className="py-8 text-center text-[13px] text-face-3">
                    <CheckCircle2 className="mx-auto mb-2 size-8 text-green" />
                    未发现需要关注的问题
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {risks.map((r, idx) => {
                      const issue = detail.issues.find(
                        (i) => i.kind === "RISK" && i.title === r.title,
                      );
                      return (
                        <div key={idx} className="rounded-lg border border-line bg-ink-950/50 p-3.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={cn("border px-2 py-px text-[11px]", SEV[r.severity] ?? SEV.medium)} variant="outline">
                              {SEV_LABEL[r.severity] ?? r.severity}
                            </Badge>
                            <span className="text-[13.5px] font-semibold text-face-1">{r.title}</span>
                            {r.category && (
                              <span className="ml-auto font-mono text-[11px] text-face-3">{r.category}</span>
                            )}
                          </div>
                          {r.file && (
                            <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[11.5px] text-face-3">
                              <FileCode2 className="size-3" />
                              {r.file}
                              {r.line > 0 && `:${r.line}`}
                              <span className="ml-auto opacity-70">置信 {r.confidence}</span>
                            </div>
                          )}
                          {r.description && (
                            <p className="mt-1.5 text-[12.5px] leading-relaxed text-face-2">{r.description}</p>
                          )}
                          {r.suggestion && (
                            <p className="mt-1.5 text-[12.5px] leading-relaxed text-face-2">
                              <b className="text-amber">建议：</b>
                              {r.suggestion}
                            </p>
                          )}
                          {issue && (
                            <div className="mt-2.5 flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy || issue.status === "accepted"}
                                onClick={() => applyIssue(issue.id, "accepted")}
                                className="gap-1 text-[12px]"
                              >
                                <Check className="size-3.5" /> 采纳建议
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy || issue.status === "dismissed"}
                                onClick={() => applyIssue(issue.id, "dismissed")}
                                className="text-[12px] text-face-2"
                              >
                                <X className="size-3.5" /> 忽略
                              </Button>
                              {issue.status !== "pending" && (
                                <span className="ml-auto text-[11px] text-face-3">
                                  {issue.status === "accepted" ? "已采纳" : "已忽略"}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Entrance>
  );
}

const SEV: Record<string, string> = {
  CRITICAL: "border-red/40 bg-[var(--red-soft)] text-red",
  HIGH: "border-red/40 bg-[var(--red-soft)] text-red",
  MEDIUM: "border-amber/40 bg-amber/10 text-amber",
  LOW: "border-line bg-ink-850 text-face-2",
};

const SEV_LABEL: Record<string, string> = {
  CRITICAL: "严重",
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};
