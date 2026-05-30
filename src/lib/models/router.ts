/**
 * Model Router — intelligently selects the best model for a given PR
 * based on size, language, security sensitivity, and user preferences.
 */

import type { ModelConfig, RouterDecision, RoutingContext } from './types';
import { getAvailableModels, getBestAvailableModel, getModelsByTier, getModel } from './registry';

/** Paths that indicate security-sensitive code */
const SECURITY_PATH_PATTERNS = [
  /auth/i, /login/i, /signup/i, /register/i,
  /crypto/i, /password/i, /secret/i, /token/i,
  /session/i, /cookie/i, /oauth/i, /jwt/i,
  /permission/i, /rbac/i, /acl/i,
  /payment/i, /billing/i, /transaction/i,
  /sql/i, /query/i, /db\//i, /database/i,
];

/** File extensions that indicate a particular language */
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
 * Detect the primary language from file extensions.
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
 * Check if any changed file paths match security-sensitive patterns.
 */
function hasSecuritySensitivePaths(fileList: string[]): boolean {
  return fileList.some((file) =>
    SECURITY_PATH_PATTERNS.some((pattern) => pattern.test(file))
  );
}

/**
 * Select the best model for a given PR.
 */
export function routeModel(ctx: RoutingContext): RouterDecision {
  const available = getAvailableModels();

  if (available.length === 0) {
    throw Object.assign(
      new Error('No AI model providers are configured. Please set at least one API key.'),
      { code: 'AI_CONFIG_ERROR' }
    );
  }

  // 1. If user explicitly requested a model, use it (if available)
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

  // 2. Ensemble mode: use two models from different providers
  if (ctx.ensembleMode && available.length >= 2) {
    // Pick the best quality model as primary
    const primary = getBestAvailableModel('quality') || available[0];
    // Pick a different provider for secondary
    const secondary = available.find((m) => m.provider !== primary.provider) || available[1] || available[0];

    return {
      model: primary,
      reason: `Ensemble 模式: ${primary.displayName} (主) + ${secondary.displayName} (副)`,
      alternatives: [secondary, ...available.filter((m) => m.modelId !== primary.modelId && m.modelId !== secondary.modelId)],
    };
  }

  // 3. User preferred tier
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

  // 4. Very large PR (>200 files) — use strongest available model
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

  // 5. Security-sensitive PR — use quality tier
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

  // 6. Medium PR (50-200 files) — use quality tier if available
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

  // 7. Default: use primary tier (DeepSeek) or whatever is available
  const defaultModel = getBestAvailableModel('primary') || available[0];
  return {
    model: defaultModel,
    reason: `默认选择: ${defaultModel.displayName} (${ctx.fileCount} 文件, ${(ctx.diffSize / 1024).toFixed(1)}KB diff)`,
    alternatives: available.filter((m) => m.modelId !== defaultModel.modelId).slice(0, 3),
  };
}

/**
 * Estimate cost for an analysis.
 */
export function estimateCost(
  model: ModelConfig,
  estimatedInputTokens: number,
  estimatedOutputTokens: number
): number {
  return (
    (estimatedInputTokens / 1_000_000) * model.costPer1MInput +
    (estimatedOutputTokens / 1_000_000) * model.costPer1MOutput
  );
}

/**
 * Build routing context from PR analysis parameters.
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
