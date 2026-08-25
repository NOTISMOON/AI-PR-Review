"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Loader2, ShieldCheck, Timer, Trash2, TrendingUp } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { cn } from "@/app/components/ui/utils";
import { Entrance, SplitTitle } from "@/app/components/motion";
import { usePlatform } from "@/app/components/platform";
import { authFetch } from "@/lib/client/auth-fetch";

interface HistoryItem {
  id: number;
  prNumber: number;
  repoFullName: string;
  prTitle: string | null;
  riskLevel: string | null;
  riskCount: number;
  suggestionCount: number;
  positiveCount: number;
  decision: string;
  depth: string | null;
  model: string | null;
  latencyMs: number | null;
  additions: number;
  deletions: number;
  completedAt: string | null;
}

interface Kpi {
  total: number;
  adoptRate: number;
  avgLatencyMs: number | null;
  passRate: number;
}

const SEGS: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "risky", label: "有风险" },
  { key: "suggestion", label: "仅建议" },
  { key: "written", label: "已处理" },
];

const DECISION: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "待处理", cls: "border-amber/40 bg-amber/10 text-amber" },
  APPROVED: { label: "已批准", cls: "border-green/40 bg-[var(--green-soft)] text-green" },
  REQUEST_CHANGES: { label: "请求变更", cls: "border-red/40 bg-[var(--red-soft)] text-red" },
  COMMENTED: { label: "已评论", cls: "border-cyan/40 bg-cyan/10 text-cyan" },
  DISMISSED: { label: "已关闭", cls: "border-line bg-ink-850 text-face-2" },
};

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
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

function CountCell({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[12px]">
      {value > 0 ? (
        <b className={cn("font-semibold", tone)}>{value}</b>
      ) : (
        <b className="font-semibold text-face-3">0</b>
      )}
      <span className="text-face-3">{label}</span>
      <span className="mx-1.5 text-face-3/40">/</span>
    </span>
  );
}

export default function HistoryPage() {
  const { provider } = usePlatform();
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const sp = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        filter,
      });
      const res = await authFetch(`/api/review/history?${sp.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setItems(d.items ?? []);
      setKpi(d.kpi ?? null);
      setTotal(d.total ?? 0);
    } catch {
      setError("加载审查历史失败");
    } finally {
      setLoading(false);
    }
  }, [provider, page, pageSize, filter]);

  // filter/page 变化即重新加载
  useEffect(() => {
    load();
  }, [filter, page, provider, load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /** 删除单条历史：确认后调 DELETE，成功刷新当前列表 */
  async function remove(id: number) {
    if (!window.confirm("确认删除这条审查历史？")) return;
    setDeleting(id);
    try {
      const res = await authFetch(`/api/review/history/${id}`, { method: "DELETE" });
      if (res.ok) {
        await load();
      } else {
        const d = await res.json().catch(() => null);
        setError(d?.error || "删除失败");
      }
    } catch {
      setError("删除失败，请稍后重试");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Entrance className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      {/* ===== 标题 ===== */}
      <div className="border-b border-line pb-4">
        <SplitTitle className="font-display text-[26px] font-semibold tracking-[-0.02em]">
          审查<b className="text-amber">历史</b>
        </SplitTitle>
        <p className="mt-1 text-[13.5px] text-face-2">
          已完成的 AI PR 审查记录，包含处理状态与耗时统计（Redis 缓存）。
        </p>
      </div>

      {/* ===== KPI 数字卡 ===== */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-line/70 p-5 !gap-1 shadow-[var(--shadow-card)]">
          <span className="grid size-9 place-items-center rounded-md bg-amber/10 text-amber">
            <Layers className="size-5" />
          </span>
          <div className="mt-3 font-mono text-[26px] leading-none text-foreground">
            {kpi?.total ?? "—"}
            <span className="ml-0.5 text-[15px] text-face-3">次</span>
          </div>
          <div className="mt-1 text-[12.5px] text-face-2">累计审查</div>
        </Card>
        <Card className="border-line/70 p-5 !gap-1 shadow-[var(--shadow-card)]">
          <span className="grid size-9 place-items-center rounded-md bg-amber/10 text-amber">
            <ShieldCheck className="size-5" />
          </span>
          <div className="mt-3 font-mono text-[26px] leading-none text-foreground">
            {kpi?.adoptRate ?? 0}
            <span className="ml-0.5 text-[15px] text-face-3">%</span>
          </div>
          <div className="mt-1 text-[12.5px] text-face-2">评论采纳率</div>
        </Card>
        <Card className="border-line/70 p-5 !gap-1 shadow-[var(--shadow-card)]">
          <span className="grid size-9 place-items-center rounded-md bg-amber/10 text-amber">
            <Timer className="size-5" />
          </span>
          <div className="mt-3 font-mono text-[26px] leading-none text-foreground">
            {kpi?.avgLatencyMs != null ? (kpi.avgLatencyMs / 1000).toFixed(1) : "—"}
            <span className="ml-0.5 text-[15px] text-face-3">s</span>
          </div>
          <div className="mt-1 text-[12.5px] text-face-2">平均审查耗时</div>
        </Card>
        <Card className="border-line/70 p-5 !gap-1 shadow-[var(--shadow-card)]">
          <span className="grid size-9 place-items-center rounded-md bg-amber/10 text-amber">
            <TrendingUp className="size-5" />
          </span>
          <div className="mt-3 font-mono text-[26px] leading-none text-foreground">
            {kpi?.passRate ?? 0}
            <span className="ml-0.5 text-[15px] text-face-3">%</span>
          </div>
          <div className="mt-1 text-[12.5px] text-face-2">一次通过率</div>
        </Card>
      </div>

      {/* ===== 筛选 ===== */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-ink-900 p-1">
          {SEGS.map((s) => (
            <button
              key={s.key}
              onClick={() => {
                setFilter(s.key);
                setPage(1);
              }}
              className={cn(
                "cursor-pointer rounded-md px-3 py-1.5 text-[13px] transition-colors",
                filter === s.key
                  ? "bg-amber text-[var(--text-on-amber)] font-medium"
                  : "text-face-2 hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--red-soft)] bg-[var(--red-soft)] px-3.5 py-2.5 text-[12.5px] text-red">
          {error}
        </div>
      )}

      {/* ===== 记录表格 ===== */}
      <Card className="overflow-hidden border-line/70 !gap-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11px] font-semibold tracking-[0.06em] text-face-3 uppercase">
                <th className="px-5 py-3" style={{ width: 210 }}>Pull Request</th>
                <th className="px-3 py-3">仓库</th>
                <th className="px-3 py-3">变更</th>
                <th className="px-3 py-3">风险 / 建议 / 赞同</th>
                <th className="px-3 py-3">状态</th>
                <th className="px-3 py-3">耗时</th>
                <th className="px-5 py-3 text-right">时间</th>
                <th className="px-3 py-3 text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[12.5px] text-face-3">
                    <Loader2 className="mx-auto mb-2 size-5 animate-spin text-amber" />
                    加载中…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[12.5px] text-face-3">
                    暂无审查记录 · Webhook 触发自动审查后会出现在这里
                  </td>
                </tr>
              ) : (
                items.map((r) => {
                  const dec = DECISION[r.decision] ?? DECISION.PENDING;
                  return (
                    <tr
                      key={r.id}
                      title="点击查看详情"
                      onClick={() => router.push(`/review?id=${r.id}`)}
                      className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-ink-850/40"
                    >
                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-foreground hover:text-amber">
                          {r.prTitle || "—"}
                        </div>
                        <div className="font-mono text-[11.5px] text-face-3">#{r.prNumber}</div>
                      </td>
                      <td className="px-3 py-3.5 font-mono text-[12px] text-face-3 whitespace-nowrap">
                        {r.repoFullName}
                      </td>
                      <td className="px-3 py-3.5 font-mono text-[12px] whitespace-nowrap">
                        <span className="text-green">+{r.additions}</span>{" "}
                        {r.deletions > 0 && <span className="text-red">−{r.deletions}</span>}
                      </td>
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        <CountCell value={r.riskCount} label="风险" tone="text-red" />
                        <CountCell value={r.suggestionCount} label="建议" tone="text-amber" />
                        <CountCell value={r.positiveCount} label="赞同" tone="text-green" />
                      </td>
                      <td className="px-3 py-3.5">
                        <Badge className={dec.cls} variant="outline">
                          {dec.label}
                        </Badge>
                      </td>
                      <td className="px-3 py-3.5 font-mono text-[12px] text-face-2 whitespace-nowrap">
                        {r.latencyMs != null ? `${(r.latencyMs / 1000).toFixed(1)}s` : "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right text-[12px] text-face-3 whitespace-nowrap">
                        {timeAgo(r.completedAt)}
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        <button
                          type="button"
                          title="删除这条历史"
                          disabled={deleting === r.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            remove(r.id);
                          }}
                          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-face-3 transition-colors hover:bg-[var(--red-soft)] hover:text-red disabled:opacity-50"
                        >
                          <Trash2 className={cn("size-3.5", deleting === r.id && "animate-pulse")} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ===== 分页 ===== */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3.5">
          <span className="text-[12.5px] text-face-3">
            共 {total} 条 · 第 {page}/{totalPages} 页
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="border border-line/60 text-face-3"
            >
              上一页
            </Button>
            <Button
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="bg-amber text-[var(--text-on-amber)] hover:bg-amber/90"
            >
              下一页
            </Button>
          </div>
        </div>
      </Card>
    </Entrance>
  );
}
