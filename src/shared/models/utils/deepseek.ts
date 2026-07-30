import type { ToolUseScope } from '../../types'

/**
 * DeepSeek chat/reasoner/R1 and pre-V4 base models have poor function calling for scoped tools.
 * This covers all known model ID variants across providers:
 *   - DeepSeek API: deepseek-chat, deepseek-reasoner
 *   - SiliconFlow:  deepseek-ai/DeepSeek-V3.2, deepseek-ai/DeepSeek-R1
 *   - VolcEngine:   deepseek-v3-250324, deepseek-r1-250528
 *   - OpenRouter:   deepseek/deepseek-r1:free, deepseek/deepseek-v3.2
 *   - Generic:      deepseek-v3, deepseek-v3.2, deepseek-r1
 *
 * Distilled and VL models are excluded because they use different model families.
 */

const SCOPED_TOOLS: ToolUseScope[] = ['agent', 'web-browsing', 'read-file']

// Matches DeepSeek chat/reasoner/R1, plus V-series models below V4.
const WEAK_MODEL_PATTERN = /deepseek[-_]?(chat|reasoner|r1|v(?:0|1|2|3)(?:[._]\d+)?)\b/i

// Models with improved tool use — excluded from the weak list
const STRONG_MODEL_PATTERN = /distill|vl\d/i

// Matches DeepSeek models that support reasoning/thinking (reasoner, R1, V-series).
const REASONING_MODEL_PATTERN = /(?:^|\/)deepseek-(?:reasoner|r1|v[0-9.]+)/i

/**
 * Returns true if the given model ID is a DeepSeek reasoning/thinking model.
 * Shared by capability detection (reasoning controls) and request construction
 * (DeepSeek provider, ChatboxAI gateway) so the two can never drift apart.
 */
export function isDeepSeekReasoningModel(modelId: string): boolean {
  return REASONING_MODEL_PATTERN.test(modelId)
}

/**
 * Returns true if the given DeepSeek model has weak scoped tool use
 * (agent, web-browsing, read-file) and should be disabled for that scope.
 */
export function isDeepSeekWeakToolUse(modelId: string, scope?: ToolUseScope): boolean {
  if (!scope || !SCOPED_TOOLS.includes(scope)) return false
  const id = modelId.toLowerCase()
  if (!id.includes('deepseek')) return false
  if (STRONG_MODEL_PATTERN.test(id)) return false
  return WEAK_MODEL_PATTERN.test(id)
}
