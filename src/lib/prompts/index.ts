/**
 * Prompts module — barrel export.
 */

export { BASE_SYSTEM_PROMPT } from './system-base';
export { COT_INSTRUCTIONS } from './cot-instructions';
export { SMALL_PR_EXAMPLE, LARGE_PR_EXAMPLE } from './few-shot/examples';
export { LANGUAGE_INSTRUCTIONS, getInstructionsForFiles } from './language-specific/index';
export { FAST_MODE_INSTRUCTIONS } from './fast-mode-instructions';
export type { LanguageInstructions } from './language-specific/index';
export { composeSystemPrompt, createPromptConfig } from './composer';
export type { PromptConfig } from './composer';
