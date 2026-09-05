/**
 * 模型路由——根据 PR 的大小、语言、安全敏感度和用户偏好，
 * 智能地为给定 PR 选择最佳模型。
 */

import type { ModelConfig, RouterDecision, RoutingContext } from './types';
import { getAvailableModels, getBestAvailableModel, getModelsByTier, getModel } from './registry';

/** 表示安全敏感代码的路径 */
const SECURITY_PATH_PATTERNS = [
  /auth/i, /login/i, /signup/i, /register/i,
  /crypto/i, /password/i, /secret/i, /token/i,
  /session/i, /cookie/i, /oauth/i, /jwt/i,
  /permission/i, /rbac/i, /acl/i,
  /payment/i, /billing/i, /transaction/i,
  /sql/i, /query/i, /db\//i, /database/i,
];

/** 表示特定语言的文件扩展名 */
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
};

/**
 * 从文件扩展名检测主要语言。
 */
function detectLanguage(fileList: string[]): string | undefined {
  const counts: Record<string, number> = {};
  for (const file of fileList) {
    for (const [ext, lang] of Object.entries(LANGUAGE_EXTENSIONS)) {
      if (file.endsWith(ext)) {
        counts[lang] = (counts[lang] || 0) + 1;
        break;
      }
    }
  }
  let maxCount = 0;
  let primaryLang: string | undefined;
  for (const [lang, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      primaryLang = lang;
    }
  }
  return primaryLang;
}

/**
 * 检查变更文件路径是否匹配安全敏感模式。
 */
function hasSecuritySensitivePaths(fileList: string[]): boolean {
  return fileList.some((file) =>
    SECURITY_PATH_PATTERNS.some((pattern) => pattern.test(file))
  );
}

/**
 * 为给定的 PR 选择最佳模型。
 */
export function routeModel(ctx: RoutingContext): RouterDecision {
  const available = getAvailableModels();

  if (available.length === 0) {
    throw Object.assign(
      new Error('No AI model providers are configured. Please set at least one API key.'),
      { code: 'AI_CONFIG_ERROR' }
    );
  }

  // 1. 如果用户明确指定了模型，则使用它（如果可用）
  if (ctx.preferredModel) {
    const model = getModel(ctx.preferredModel);
    if (model) {
      return {
        model,
        reason: `用户指定模型: ${model.displayName}`,
        alternatives: available.filter((m) => m.modelId !== model.modelId).slice(0, 3),
      };
    }
  }

  // 2. 集成模式：使用两个来自不同供应商的模型
  if (ctx.ensembleMode && available.length >= 2) {
    // 选择质量最佳的模型作为主模型
    const primary = getBestAvailableModel('quality') || available[0];
    // 为副模型选择不同的供应商
    const secondary = available.find((m) => m.provider !== primary.provider) || available[1] || available[0];

    return {
      model: primary,
      reason: `Ensemble 模式: ${primary.displayName} (主) + ${secondary.displayName} (副)`,
      alternatives: [secondary, ...available.filter((m) => m.modelId !== primary.modelId && m.modelId !== secondary.modelId)],
    };
  }

  // 3. 用户偏好层级
  if (ctx.preferredTier) {
    const tierModel = getBestAvailableModel(
      ctx.preferredTier === 'thorough' ? 'quality' : ctx.preferredTier === 'fast' ? 'fast' : 'primary'
    );
    if (tierModel) {
      return {
        model: tierModel,
        reason: `用户偏好: ${ctx.preferredTier === 'thorough' ? '深度审查' : ctx.preferredTier === 'fast' ? '快速扫描' : '标准'} → ${tierModel.displayName}`,
        alternatives: available.filter((m) => m.modelId !== tierModel.modelId).slice(0, 3),
      };
    }
  }

  // 4. 大型 PR（超过 200 个文件）—— 使用可用的最强模型
  if (ctx.fileCount > 200) {
    const best = getBestAvailableModel('specialized') || getBestAvailableModel('quality');
    if (best) {
      return {
        model: best,
        reason: `大型 PR (${ctx.fileCount} 文件) → ${best.displayName}`,
        alternatives: available.filter((m) => m.modelId !== best.modelId).slice(0, 3),
      };
    }
  }

  // 5. 安全敏感 PR —— 使用质量层级
  if (ctx.hasSecurityPaths) {
    const best = getBestAvailableModel('quality') || getBestAvailableModel('primary');
    if (best) {
      return {
        model: best,
        reason: `安全敏感路径检测 → ${best.displayName}`,
        alternatives: available.filter((m) => m.modelId !== best.modelId).slice(0, 3),
      };
    }
  }

  // 6. 中型 PR（50-200 个文件）—— 如可用则使用质量层级
  if (ctx.fileCount >= 50) {
    const quality = getBestAvailableModel('quality');
    if (quality) {
      return {
        model: quality,
        reason: `中型 PR (${ctx.fileCount} 文件) → ${quality.displayName}`,
        alternatives: available.filter((m) => m.modelId !== quality.modelId).slice(0, 3),
      };
    }
  }

  // 7. 默认：使用主要层级（DeepSeek）或任何可用的模型
  const defaultModel = getBestAvailableModel('primary') || available[0];
  return {
    model: defaultModel,
    reason: `默认选择: ${defaultModel.displayName} (${ctx.fileCount} 文件, ${(ctx.diffSize / 1024).toFixed(1)}KB diff)`,
    alternatives: available.filter((m) => m.modelId !== defaultModel.modelId).slice(0, 3),
  };
}

/**
 * 根据 PR 分析参数构建路由上下文。
 */
export function buildRoutingContext(params: {
  fileCount: number;
  fileList: string[];
  diffSize: number;
  preferredModel?: string;
  preferredTier?: 'fast' | 'balanced' | 'thorough';
  ensembleMode?: boolean;
}): RoutingContext {
  return {
    fileCount: params.fileCount,
    diffSize: params.diffSize,
    language: detectLanguage(params.fileList),
    hasSecurityPaths: hasSecuritySensitivePaths(params.fileList),
    preferredModel: params.preferredModel,
    preferredTier: params.preferredTier,
    ensembleMode: params.ensembleMode,
  };
}
