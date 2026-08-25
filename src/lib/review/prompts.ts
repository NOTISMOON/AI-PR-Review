import type { CollectedContext } from "@/types/analysis";
import { truncateDiffSmart } from "@/app/api/analyze/helpers/diff-utils";

/**
 * 维度化审查 Prompt（LangGraph 并行分析的四个维度）。
 * 每个维度独立系统提示，输出统一 JSON，便于 merge 阶段合并。
 */

export type ReviewDimension = "bug" | "security" | "performance" | "quality";

export const DIMENSION_META: Record<ReviewDimension, { label: string; focus: string }> = {
  bug: {
    label: "Bug / 逻辑",
    focus: "逻辑缺陷、运行时错误、边界条件、竞态条件、异常处理缺失",
  },
  security: {
    label: "Security / 安全",
    focus: "注入、XSS、CSRF、密钥泄露、越权访问、不安全反序列化、路径穿越",
  },
  performance: {
    label: "Performance / 性能",
    focus: "N+1 查询、内存泄漏、冗余计算、不必要的阻塞、热点路径、缓存缺失",
  },
  quality: {
    label: "Code Quality / 质量",
    focus: "命名、重复代码、可维护性、可测试性、过度耦合、死代码、API 设计",
  },
};

export const DIMENSIONS: ReviewDimension[] = ["bug", "security", "performance", "quality"];

const OUTPUT_SCHEMA = `请仅输出一个 JSON 对象（不要输出任何其他文字），格式：
{
  "summary": "一句话总结该维度审查结论（中文，30 字以内）",
  "findings": [
    {
      "severity": "critical | high | medium | low",
      "title": "问题标题（中文，简短）",
      "description": "问题详细描述（中文）",
      "file": "文件路径（来自 diff，找不到填空字符串）",
      "line": 数字,
      "code": "相关代码片段（没有填空字符串）",
      "suggestion": "修复建议（中文）",
      "confidence": "high | medium | low"
    }
  ]
}`;

export function buildDimensionSystemPrompt(dim: ReviewDimension, depth: "fast" | "standard" | "deep"): string {
  const meta = DIMENSION_META[dim];
  const scope =
    depth === "fast"
      ? "这是快速扫描：只报告最明显的" + meta.label + "问题，不做过度推断。"
      : depth === "deep"
        ? "这是深度审查：做全面的" + meta.label + "分析，包括跨模块依赖与边界情况。"
        : "这是标准审查：在合理范围内做" + meta.label + "逻辑分析。";

  return `你是一名资深代码审查专家，正在对 GitHub Pull Request 进行「${meta.label}」维度专项审查。

审查重点：${meta.focus}

${scope}

要求：
1. 只报告真实存在的问题，不臆测
2. 上下文不足时降低严重程度（疑罪从无）
3. 删除的代码默认视为有意为之，不计为问题
4. 功能 / 产品决策变更不计入风险
5. findings 按严重程度从高到低排列

${OUTPUT_SCHEMA}`;
}

export function buildDimensionUserMessage(
  dim: ReviewDimension,
  collected: CollectedContext,
  effectiveDiff: string,
): string {
  return `# PR 信息
- 标题：${collected.prInfo.title}
- 作者：${collected.prInfo.author}
- 分支：${collected.prInfo.branch} → ${collected.prInfo.baseBranch}
- 变更：${collected.prInfo.additions} 行新增 / ${collected.prInfo.deletions} 行删除（${collected.fileChanges.length} 个文件）

# 本次变更的 Diff
\`\`\`diff
${effectiveDiff}
\`\`\`

${buildContextSections(collected)}

请从「${DIMENSION_META[dim].label}」维度分析以上 diff，输出 JSON。`;
}

function buildContextSections(collected: CollectedContext): string {
  const parts: string[] = [];
  if (collected.commits?.length) {
    parts.push(
      `# 提交记录\n${collected.commits.map((c) => `- ${c.sha} ${c.message}`).join("\n")}`,
    );
  }
  if (collected.prComments?.length) {
    parts.push(
      `# PR 评论\n${collected.prComments
        .slice(0, 10)
        .map((c) => `- ${c.author}: ${c.body.slice(0, 200)}`)
        .join("\n")}`,
    );
  }
  const ctxFiles = (collected.filesWithContext || []).filter((f) => f.fullContent);
  if (ctxFiles.length) {
    parts.push(
      `# 相关文件上下文（周边代码）\n${ctxFiles
        .slice(0, 5)
        .map(
          (f) =>
            `## ${f.path}\n\`\`\`\n${f.fullContent!.slice(0, 3000)}\n\`\`\``,
        )
        .join("\n\n")}`,
    );
  }
  return parts.join("\n\n");
}

/** 智能截断 diff（不同维度共用，限制单次调用 token） */
export function prepareDiff(collected: CollectedContext): { effectiveDiff: string; diffTruncated: boolean } {
  return truncateDiffSmart(collected.diff, 120000);
}
