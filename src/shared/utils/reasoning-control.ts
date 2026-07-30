import { isDeepSeekReasoningModel } from '../models/utils/deepseek'
import type { ModelProvider, ProviderModelInfo, ProviderOptions } from '../types'
import { ModelProviderEnum } from '../types'
import {
  canDisableGoogleThinking,
  type GoogleThinkingLevel,
  getGoogleThinkingMode,
  getSupportedGoogleThinkingLevels,
} from './google-thinking'

// 'default' sends no reasoning-related parameters at all (the provider's server-side
// default applies); 'off' force-sends the provider's explicit disable parameters.
export type ReasoningControlLevel = 'default' | 'off' | 'low' | 'medium' | 'high'

export type ReasoningControlDisabledReason =
  | 'requires-anthropic-api-style'
  | 'requires-google-api-style'
  | 'requires-openai-api-style'
  | 'requires-deepseek-api-style'
  | 'requires-qwen-api-style'
  | 'requires-xai-api-style'

export interface ReasoningControlCapabilities {
  supported: boolean
  kind:
    | 'anthropic-adaptive-effort'
    | 'anthropic-effort'
    | 'budget'
    | 'level'
    | 'openai-effort'
    | 'openrouter-reasoning'
    | 'toggle'
    | 'xai-effort'
  disabledReason?: ReasoningControlDisabledReason
}

export interface ReasoningControlOption {
  level: ReasoningControlLevel
  label: 'default' | 'off' | 'on' | 'low' | 'medium' | 'high'
}

const DEFAULT_CAPABILITIES: ReasoningControlCapabilities = {
  supported: false,
  kind: 'toggle',
}

type ReasoningEffortLevel = Exclude<ReasoningControlLevel, 'default' | 'off'>

const CLAUDE_BUDGET_BY_LEVEL: Record<ReasoningEffortLevel, number> = {
  low: 1024,
  medium: 4096,
  high: 8192,
}

const GEMINI_BUDGET_BY_LEVEL: Record<ReasoningEffortLevel, number> = {
  low: 1024,
  medium: 8192,
  high: 24576,
}

// Readback boundaries accept both the level budgets above (1024/8192/24576) and the
// presets written by the legacy session-settings modal (2048/5120/10240), so upgraded
// sessions keep displaying the level the user originally chose.
const GEMINI_LEVEL_READBACK_MIN: Record<Exclude<ReasoningEffortLevel, 'low'>, number> = {
  medium: 4096,
  high: 10240,
}

const QWEN_THINKING_BUDGET_BY_LEVEL: Record<ReasoningEffortLevel, number> = {
  low: 1024,
  medium: 4096,
  high: 8192,
}

const GPT_EFFORT_MODELS = [/(?:^|\/)gpt-5(?:[.-]|$)/i, /(?:^|\/)gpt-oss(?:[.-]|$)/i, /(?:^|\/)o[1-9](?:[.-]|$)/i]
// o-series models only accept reasoning_effort low/medium/high — there is no
// minimal/none, so reasoning cannot be turned off for them.
const OPENAI_NO_DISABLE_MODELS = [/(?:^|\/)o[1-9](?:[.-]|$)/i]
// Chat-tuned gpt-5 variants (gpt-5-chat-latest, gpt-5.1-chat, gpt-5.2-chat-latest, ...)
// are non-reasoning models; sending reasoning_effort to them is rejected upstream
// ("Unrecognized request argument supplied: reasoning_effort").
const GPT_NON_REASONING_CHAT_MODELS = [/(?:^|\/)gpt-5[\w.-]*[.-]chat(?:[.-]|$)/i]
// o1-preview and o1-mini predate the reasoning_effort parameter — the API rejects it
// for them entirely, so they must not get effort controls at all.
const OPENAI_NO_EFFORT_PARAM_MODELS = [/(?:^|\/)o1-(?:preview|mini)(?:[.-]|$)/i]
// gpt-5.1 and later accept reasoning_effort: 'none'; the original gpt-5 only goes
// down to 'minimal'. Match any dotted gpt-5.x so future versions default to 'none'.
const OPENAI_NONE_EFFORT_MODELS = [/(?:^|\/)gpt-5\.[1-9]\d*(?:[.-]|$)/i]
const CLAUDE_EFFORT_MODELS = [/(?:^|\/)claude-opus-4-5/i]
const CLAUDE_ADAPTIVE_EFFORT_MODELS = [/(?:^|\/)claude-opus-4-(?:7|8)/i]
const CLAUDE_BUDGET_MODELS = [
  /(?:^|\/)claude-3-7-sonnet/i,
  /(?:^|\/)claude-sonnet-4/i,
  /(?:^|\/)claude-haiku-4-5/i,
  /(?:^|\/)claude-opus-4(?![.-]?5)(?![.-]?7)(?![.-]?8)/i,
]
const QWEN_THINKING_MODELS = [/^qwen3/i, /(?:^|\/)qwen3/i]
const GROK_REASONING_EFFORT_MODELS = [
  /(?:^|\/)grok-4\.3(?:-latest)?$/i,
  /(?:^|\/)grok-4(?:-latest|-0709)?$/i,
  /(?:^|\/)grok-4-fast(?:-reasoning)?(?:-latest)?$/i,
  /(?:^|\/)grok-4-1-fast(?:-reasoning)?(?:-latest)?$/i,
]

function matchesAny(modelId: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(modelId))
}

// Models whose thinking cannot be force-disabled do not get an 'off' option; selecting
// 'off' for them falls back to 'default' (send nothing). Claude effort/adaptive models
// are only controlled via the effort request param — the AI SDK never emits
// `thinking: {type: 'disabled'}`, so an explicit off cannot be expressed on the wire.
// Gemini 2.5 Pro enforces a minimum thinking budget, so thinkingBudget: 0 is rejected.
function supportsExplicitDisable(
  kind: ReasoningControlCapabilities['kind'],
  effectiveProvider: ModelProvider | undefined,
  modelId: string
): boolean {
  if (effectiveProvider === ModelProviderEnum.Gemini && !canDisableGoogleThinking(modelId)) {
    return false
  }
  if (kind === 'anthropic-adaptive-effort' || kind === 'anthropic-effort') {
    return false
  }
  if (isOpenAIStyleEffectiveProvider(effectiveProvider) && matchesAny(modelId, OPENAI_NO_DISABLE_MODELS)) {
    return false
  }
  return true
}

function isGptEffortModel(modelId: string): boolean {
  return (
    matchesAny(modelId, GPT_EFFORT_MODELS) &&
    !matchesAny(modelId, GPT_NON_REASONING_CHAT_MODELS) &&
    !matchesAny(modelId, OPENAI_NO_EFFORT_PARAM_MODELS)
  )
}

/**
 * Claude models that use adaptive thinking effort instead of a token budget.
 * Shared with the Claude provider so capability detection and request
 * construction stay in sync.
 */
export function isClaudeAdaptiveThinkingModel(modelId: string): boolean {
  return matchesAny(modelId, CLAUDE_ADAPTIVE_EFFORT_MODELS)
}

/**
 * Claude models whose thinking is controlled by the effort request param
 * (Opus 4.5 and the adaptive 4.7/4.8 generation) rather than a token budget.
 */
export function usesClaudeEffortControl(modelId: string): boolean {
  return matchesAny(modelId, [...CLAUDE_EFFORT_MODELS, ...CLAUDE_ADAPTIVE_EFFORT_MODELS])
}

/**
 * Drops Claude reasoning options written for a different model generation so they are
 * never sent on the wire: effort/adaptive models only accept the effort param, while
 * budget-style models only accept the thinking config. Without this, options persisted
 * on a session leak through model switches (e.g. a Sonnet thinking budget sent to an
 * adaptive Opus model) and contradict the 'default' (send nothing) level readback.
 */
export function normalizeClaudeReasoningOptions(
  modelId: string,
  claude: ProviderOptions['claude']
): ProviderOptions['claude'] {
  if (!claude) return undefined
  if (usesClaudeEffortControl(modelId)) {
    return claude.effort ? { effort: claude.effort } : undefined
  }
  return claude.thinking ? { thinking: claude.thinking } : undefined
}

/**
 * Whether a reasoning_effort value can be sent to the given OpenAI-style model:
 * o1-preview/o1-mini reject the parameter entirely, and the other o-series models
 * reject the minimal/none off values.
 */
export function isOpenAIReasoningEffortSupported(modelId: string, effort: string): boolean {
  if (matchesAny(modelId, OPENAI_NO_EFFORT_PARAM_MODELS)) return false
  if (matchesAny(modelId, OPENAI_NO_DISABLE_MODELS) && (effort === 'minimal' || effort === 'none')) return false
  return true
}

/**
 * Drops OpenAI reasoning options the target model cannot accept (see
 * isOpenAIReasoningEffortSupported) — a stale off effort persisted under a GPT-5
 * session must not survive a switch to an o-series model. Returns undefined when the
 * options are invalid for the model, dropping the whole (reasoning-only) namespace.
 */
export function normalizeOpenAIReasoningOptions(
  modelId: string,
  openai: ProviderOptions['openai']
): ProviderOptions['openai'] {
  if (!openai) return undefined
  if (matchesAny(modelId, OPENAI_NO_EFFORT_PARAM_MODELS)) {
    return undefined
  }
  if (openai.reasoningEffort !== undefined && !isOpenAIReasoningEffortSupported(modelId, openai.reasoningEffort)) {
    return undefined
  }
  return openai
}

/**
 * Select the OpenAI reasoning options that have a defined OpenAI-compatible wire mapping.
 * `@ai-sdk/openai-compatible` forwards unknown keys verbatim, so OpenAI-only flags such as
 * forceReasoning, reasoningSummary and include must never cross this boundary.
 *
 * Keep this whitelist in sync with the OpenAI option writers in getReasoningProviderOptions.
 * Add a key here only after its compatible request-body mapping is verified.
 */
export function pickOpenAICompatibleReasoningOptions(
  modelId: string,
  providerOptions: ProviderOptions | undefined
): ProviderOptions['openaiCompatible'] {
  const reasoningEffort = providerOptions?.openai?.reasoningEffort ?? providerOptions?.openaiCompatible?.reasoningEffort
  if (reasoningEffort === undefined) return undefined
  if (!isOpenAIReasoningEffortSupported(modelId, reasoningEffort)) return undefined
  return { reasoningEffort }
}

function isOpenAIStyleEffectiveProvider(provider: ModelProvider | undefined): boolean {
  return (
    provider === ModelProviderEnum.OpenAI ||
    provider === ModelProviderEnum.OpenAIResponses ||
    provider === ModelProviderEnum.Azure
  )
}

type LegacyOpenAICompatibleReasoning = NonNullable<ProviderOptions['openaiCompatible']>['reasoning']

/**
 * Interprets the legacy `openaiCompatible.reasoning` options (written by older
 * versions) as a DeepSeek-style thinking toggle. Shared with the ChatboxAI
 * gateway model so both read paths agree.
 */
export function getLegacyOpenAICompatibleThinkingType(
  reasoning: LegacyOpenAICompatibleReasoning
): 'enabled' | 'disabled' | undefined {
  if (!reasoning) return undefined
  if (reasoning.enabled === false || reasoning.exclude === true) return 'disabled'
  return reasoning.enabled ? 'enabled' : undefined
}

function getEffectiveProvider(
  provider: ModelProvider | undefined,
  model?: ProviderModelInfo | null
): ModelProvider | undefined {
  if (!model?.apiStyle || !usesModelApiStyleForReasoning(provider)) {
    return provider
  }

  if (provider === ModelProviderEnum.OpenRouter) {
    return provider
  }

  if (model.apiStyle === 'anthropic') return ModelProviderEnum.Claude
  if (model.apiStyle === 'google') return ModelProviderEnum.Gemini
  if (model.apiStyle === 'openai-responses') return ModelProviderEnum.OpenAIResponses
  return ModelProviderEnum.OpenAI
}

// All built-in provider ids. Any id outside this set is a user-created custom provider,
// whose reasoning support must be judged by its API style (provider type) + model id.
const BUILTIN_PROVIDER_IDS = new Set<string>(Object.values(ModelProviderEnum))

function isCustomProviderId(provider: ModelProvider | undefined): boolean {
  return !!provider && !BUILTIN_PROVIDER_IDS.has(provider)
}

function usesModelApiStyleForReasoning(provider: ModelProvider | undefined): boolean {
  // ChatboxAI proxies many backend models, and custom providers wrap an upstream API,
  // so for both we resolve the effective provider from the model's API style rather than
  // the provider id itself.
  return (
    provider === ModelProviderEnum.ChatboxAI || provider === ModelProviderEnum.Custom || isCustomProviderId(provider)
  )
}

function isOpenAICompatibleApiStyle(provider: ModelProvider | undefined, model: ProviderModelInfo): boolean {
  // ChatboxAI and custom providers can both expose OpenAI-compatible endpoints; treat a
  // missing/`openai` API style as OpenAI-compatible so model-id based detection (e.g. DeepSeek)
  // works the same way for both.
  return (
    (provider === ModelProviderEnum.ChatboxAI || isCustomProviderId(provider)) &&
    (!model.apiStyle || model.apiStyle === 'openai')
  )
}

export function getReasoningControlCapabilities(
  provider: ModelProvider | undefined,
  model?: ProviderModelInfo | null
): ReasoningControlCapabilities {
  const modelId = model?.modelId
  if (!provider || !modelId) {
    return DEFAULT_CAPABILITIES
  }

  const effectiveProvider = getEffectiveProvider(provider, model)
  const disabledReason = getApiStyleDisabledReason(provider, effectiveProvider, model)
  if (disabledReason) {
    return { supported: false, kind: 'toggle', disabledReason }
  }

  if (effectiveProvider === ModelProviderEnum.Claude && matchesAny(modelId, CLAUDE_ADAPTIVE_EFFORT_MODELS)) {
    return { supported: true, kind: 'anthropic-adaptive-effort' }
  }
  if (effectiveProvider === ModelProviderEnum.Claude && matchesAny(modelId, CLAUDE_EFFORT_MODELS)) {
    return { supported: true, kind: 'anthropic-effort' }
  }
  if (effectiveProvider === ModelProviderEnum.Claude && matchesAny(modelId, CLAUDE_BUDGET_MODELS)) {
    return { supported: true, kind: 'budget' }
  }
  if (effectiveProvider === ModelProviderEnum.Gemini) {
    const mode = getGoogleThinkingMode(modelId)
    if (mode === 'budget') return { supported: true, kind: 'budget' }
    if (mode === 'level') return { supported: true, kind: 'level' }
  }
  if (effectiveProvider === ModelProviderEnum.DeepSeek && isDeepSeekThinkingModel(model)) {
    return { supported: true, kind: 'toggle' }
  }
  if (model && isOpenAICompatibleApiStyle(provider, model) && isDeepSeekThinkingModel(model)) {
    return { supported: true, kind: 'toggle' }
  }
  if (isOpenAIStyleEffectiveProvider(effectiveProvider) && isGptEffortModel(modelId)) {
    return { supported: true, kind: 'openai-effort' }
  }
  if (
    (effectiveProvider === ModelProviderEnum.Qwen || effectiveProvider === ModelProviderEnum.QwenPortal) &&
    matchesAny(modelId, QWEN_THINKING_MODELS)
  ) {
    return { supported: true, kind: 'budget' }
  }
  if (effectiveProvider === ModelProviderEnum.XAI && matchesAny(modelId, GROK_REASONING_EFFORT_MODELS)) {
    return { supported: true, kind: 'xai-effort' }
  }
  if (effectiveProvider === ModelProviderEnum.OpenRouter && isOpenRouterReasoningModel(model)) {
    return { supported: true, kind: 'openrouter-reasoning' }
  }

  return DEFAULT_CAPABILITIES
}

function getApiStyleDisabledReason(
  provider: ModelProvider | undefined,
  effectiveProvider: ModelProvider | undefined,
  model: ProviderModelInfo
): ReasoningControlDisabledReason | undefined {
  if (effectiveProvider === ModelProviderEnum.OpenRouter) {
    return undefined
  }

  const modelId = model.modelId
  if (matchesAny(modelId, [...CLAUDE_ADAPTIVE_EFFORT_MODELS, ...CLAUDE_EFFORT_MODELS, ...CLAUDE_BUDGET_MODELS])) {
    if (effectiveProvider !== ModelProviderEnum.Claude) {
      return 'requires-anthropic-api-style'
    }
  }

  if (getGoogleThinkingMode(modelId) !== 'none') {
    if (effectiveProvider !== ModelProviderEnum.Gemini) {
      return 'requires-google-api-style'
    }
  }

  if (isGptEffortModel(modelId) && !isOpenAIStyleEffectiveProvider(effectiveProvider)) {
    return 'requires-openai-api-style'
  }

  if (
    isDeepSeekReasoningModel(modelId) &&
    effectiveProvider !== ModelProviderEnum.DeepSeek &&
    !isOpenAICompatibleApiStyle(provider, model)
  ) {
    return 'requires-deepseek-api-style'
  }

  if (
    matchesAny(modelId, QWEN_THINKING_MODELS) &&
    effectiveProvider !== ModelProviderEnum.Qwen &&
    effectiveProvider !== ModelProviderEnum.QwenPortal
  ) {
    return 'requires-qwen-api-style'
  }

  if (matchesAny(modelId, GROK_REASONING_EFFORT_MODELS) && effectiveProvider !== ModelProviderEnum.XAI) {
    return 'requires-xai-api-style'
  }

  return undefined
}

export function getReasoningControlLevel(
  provider: ModelProvider | undefined,
  model: ProviderModelInfo | null | undefined,
  providerOptions?: ProviderOptions
): ReasoningControlLevel {
  const level = deriveReasoningControlLevel(provider, model, providerOptions)
  if (level !== 'off') return level
  // Stale options (written by older versions or under another model) can read back as
  // 'off' on a model that no longer offers an off option; report them as 'default' so
  // the displayed level always exists in getReasoningControlOptions.
  const capabilities = getReasoningControlCapabilities(provider, model)
  const effectiveProvider = getEffectiveProvider(provider, model)
  return supportsExplicitDisable(capabilities.kind, effectiveProvider, model?.modelId || '') ? 'off' : 'default'
}

function deriveReasoningControlLevel(
  provider: ModelProvider | undefined,
  model: ProviderModelInfo | null | undefined,
  providerOptions?: ProviderOptions
): ReasoningControlLevel {
  const capabilities = getReasoningControlCapabilities(provider, model)
  if (!capabilities.supported) return 'default'

  const effectiveProvider = getEffectiveProvider(provider, model)
  if (model && isOpenAICompatibleApiStyle(provider, model) && isDeepSeekThinkingModel(model)) {
    const deepseekThinking = providerOptions?.deepseek?.thinking
    if (deepseekThinking) {
      return deepseekThinking.type === 'enabled' ? 'high' : 'off'
    }
    const legacyType = getLegacyOpenAICompatibleThinkingType(providerOptions?.openaiCompatible?.reasoning)
    if (legacyType === 'enabled') return 'high'
    if (legacyType === 'disabled') return 'off'
    return 'default'
  }
  if (effectiveProvider === ModelProviderEnum.Claude) {
    if (capabilities.kind === 'anthropic-adaptive-effort' || capabilities.kind === 'anthropic-effort') {
      return providerOptions?.claude?.effort || 'default'
    }
    const thinking = providerOptions?.claude?.thinking
    if (!thinking) return 'default'
    if (thinking.type !== 'enabled') return 'off'
    const budget = thinking.budgetTokens
    if (budget >= CLAUDE_BUDGET_BY_LEVEL.high) return 'high'
    if (budget >= CLAUDE_BUDGET_BY_LEVEL.medium) return 'medium'
    return 'low'
  }
  if (isOpenAIStyleEffectiveProvider(effectiveProvider)) {
    const effort = providerOptions?.openai?.reasoningEffort
    return normalizeEffortToLevel(effort)
  }
  if (effectiveProvider === ModelProviderEnum.XAI) {
    const effort = providerOptions?.openai?.reasoningEffort
    return normalizeEffortToLevel(effort)
  }
  if (effectiveProvider === ModelProviderEnum.OpenRouter) {
    const reasoning = providerOptions?.openrouter?.reasoning
    if (!reasoning) return 'default'
    if (reasoning.enabled === false) return 'off'
    return normalizeEffortToLevel(reasoning.effort)
  }
  if (effectiveProvider === ModelProviderEnum.Gemini) {
    const config = providerOptions?.google?.thinkingConfig
    if (!config) return 'default'
    if (config.includeThoughts === false) return 'off'
    if (config.thinkingLevel && config.thinkingLevel !== 'minimal') return config.thinkingLevel
    const budget = config.thinkingBudget
    if (budget === undefined || budget <= 0) return 'off'
    if (budget >= GEMINI_LEVEL_READBACK_MIN.high) return 'high'
    if (budget >= GEMINI_LEVEL_READBACK_MIN.medium) return 'medium'
    return 'low'
  }
  if (effectiveProvider === ModelProviderEnum.DeepSeek) {
    const thinking = providerOptions?.deepseek?.thinking
    if (!thinking) return 'default'
    return thinking.type === 'enabled' ? 'high' : 'off'
  }
  if (effectiveProvider === ModelProviderEnum.Qwen || effectiveProvider === ModelProviderEnum.QwenPortal) {
    const openaiCompatible = providerOptions?.openaiCompatible
    if (openaiCompatible?.enable_thinking === false) return 'off'
    if (openaiCompatible?.enable_thinking !== true) return 'default'
    const budget = openaiCompatible.thinking_budget
    if (budget !== undefined && budget >= QWEN_THINKING_BUDGET_BY_LEVEL.high) return 'high'
    if (budget !== undefined && budget >= QWEN_THINKING_BUDGET_BY_LEVEL.medium) return 'medium'
    return 'low'
  }
  return 'default'
}

export function getReasoningControlOptions(
  provider: ModelProvider | undefined,
  model?: ProviderModelInfo | null
): ReasoningControlOption[] {
  const capabilities = getReasoningControlCapabilities(provider, model)
  if (!capabilities.supported) return []

  const offOption: ReasoningControlOption[] = supportsExplicitDisable(
    capabilities.kind,
    getEffectiveProvider(provider, model),
    model?.modelId || ''
  )
    ? [{ level: 'off', label: 'off' }]
    : []

  if (capabilities.kind === 'toggle') {
    return [{ level: 'default', label: 'default' }, ...offOption, { level: 'high', label: 'on' }]
  }

  return [
    { level: 'default', label: 'default' },
    ...offOption,
    { level: 'low', label: 'low' },
    { level: 'medium', label: 'medium' },
    { level: 'high', label: 'high' },
  ]
}

export function getReasoningProviderOptions(
  provider: ModelProvider | undefined,
  model: ProviderModelInfo | null | undefined,
  level: ReasoningControlLevel,
  previous?: ProviderOptions
): ProviderOptions | undefined {
  const capabilities = getReasoningControlCapabilities(provider, model)
  if (!capabilities.supported) return previous

  const effectiveProvider = getEffectiveProvider(provider, model)

  // 'default' means "send no reasoning parameters": drop every reasoning namespace so the
  // provider's server-side default applies. Also the fallback for 'off' on models whose
  // thinking cannot be explicitly disabled.
  if (
    level === 'default' ||
    (level === 'off' && !supportsExplicitDisable(capabilities.kind, effectiveProvider, model?.modelId || ''))
  ) {
    return stripReasoningProviderOptions(previous)
  }

  const next: ProviderOptions = { ...(previous || {}) }

  if (level === 'off') {
    if (effectiveProvider === ModelProviderEnum.Claude) {
      next.claude = { thinking: { type: 'disabled', budgetTokens: 0 } }
    } else if (isOpenAICompatibleApiStyle(provider, model as ProviderModelInfo) && isDeepSeekThinkingModel(model)) {
      next.deepseek = { thinking: { type: 'disabled' } }
    } else if (isOpenAIStyleEffectiveProvider(effectiveProvider)) {
      next.openai = {
        reasoningEffort: getOpenAIReasoningEffort(model?.modelId || '', level),
        forceReasoning: true,
      }
    } else if (effectiveProvider === ModelProviderEnum.XAI) {
      next.openai = { reasoningEffort: 'none', forceReasoning: true }
    } else if (effectiveProvider === ModelProviderEnum.OpenRouter) {
      next.openrouter = { reasoning: { enabled: false, exclude: true } }
    } else if (effectiveProvider === ModelProviderEnum.Gemini) {
      next.google = { thinkingConfig: getGoogleOffThinkingConfig(model?.modelId || '') }
    } else if (effectiveProvider === ModelProviderEnum.DeepSeek) {
      next.deepseek = { thinking: { type: 'disabled' } }
    } else if (effectiveProvider === ModelProviderEnum.Qwen || effectiveProvider === ModelProviderEnum.QwenPortal) {
      next.openaiCompatible = { enable_thinking: false }
    }
    return compactProviderOptions(next)
  }

  if (effectiveProvider === ModelProviderEnum.Claude) {
    if (capabilities.kind === 'anthropic-adaptive-effort' || capabilities.kind === 'anthropic-effort') {
      next.claude = { effort: level }
    } else {
      next.claude = { thinking: { type: 'enabled', budgetTokens: CLAUDE_BUDGET_BY_LEVEL[level] } }
    }
  } else if (isOpenAICompatibleApiStyle(provider, model as ProviderModelInfo) && isDeepSeekThinkingModel(model)) {
    next.deepseek = { thinking: { type: 'enabled' } }
  } else if (isOpenAIStyleEffectiveProvider(effectiveProvider)) {
    // Keep compatible wire mappings in pickOpenAICompatibleReasoningOptions in sync when
    // adding an OpenAI option here. OpenAI-only SDK flags must not leak to compatible APIs.
    next.openai = {
      reasoningEffort: getOpenAIReasoningEffort(model?.modelId || '', level),
      ...(effectiveProvider === ModelProviderEnum.OpenAIResponses
        ? {
            reasoningSummary: 'auto' as const,
            include: ['reasoning.encrypted_content'],
            forceReasoning: true,
          }
        : {}),
    }
  } else if (effectiveProvider === ModelProviderEnum.XAI) {
    next.openai = {
      reasoningEffort: level,
      include: ['reasoning.encrypted_content'],
      forceReasoning: true,
    }
  } else if (effectiveProvider === ModelProviderEnum.OpenRouter) {
    next.openrouter = {
      reasoning: {
        effort: level,
        exclude: false,
      },
    }
  } else if (effectiveProvider === ModelProviderEnum.Gemini) {
    if (capabilities.kind === 'level') {
      next.google = { thinkingConfig: { thinkingLevel: level as GoogleThinkingLevel, includeThoughts: true } }
    } else {
      next.google = { thinkingConfig: { thinkingBudget: GEMINI_BUDGET_BY_LEVEL[level], includeThoughts: true } }
    }
  } else if (effectiveProvider === ModelProviderEnum.DeepSeek) {
    next.deepseek = { thinking: { type: 'enabled' } }
  } else if (effectiveProvider === ModelProviderEnum.Qwen || effectiveProvider === ModelProviderEnum.QwenPortal) {
    next.openaiCompatible = {
      enable_thinking: true,
      thinking_budget: QWEN_THINKING_BUDGET_BY_LEVEL[level],
    }
  }

  return compactProviderOptions(next)
}

function isDeepSeekThinkingModel(model: ProviderModelInfo | null | undefined): boolean {
  if (!model?.modelId) return false
  return isDeepSeekReasoningModel(model.modelId)
}

function getGoogleOffThinkingConfig(modelId: string): NonNullable<ProviderOptions['google']>['thinkingConfig'] {
  if (getGoogleThinkingMode(modelId) === 'level') {
    const supportedLevels = getSupportedGoogleThinkingLevels(modelId)
    return {
      thinkingLevel: supportedLevels.includes('minimal') ? 'minimal' : 'low',
      includeThoughts: false,
    }
  }

  return { thinkingBudget: 0, includeThoughts: false }
}

function isOpenRouterReasoningModel(model: ProviderModelInfo | null | undefined): boolean {
  if (!model?.modelId) return false
  if (isDeepSeekReasoningModel(model.modelId)) return true
  if (isGptEffortModel(model.modelId)) return true
  return matchesAny(model.modelId, [
    ...CLAUDE_ADAPTIVE_EFFORT_MODELS,
    ...CLAUDE_EFFORT_MODELS,
    ...CLAUDE_BUDGET_MODELS,
    ...QWEN_THINKING_MODELS,
    ...GROK_REASONING_EFFORT_MODELS,
    // o1-preview/o1-mini reject the direct reasoning_effort param, but OpenRouter maps
    // its own reasoning options per model, so they keep reasoning controls there.
    ...OPENAI_NO_EFFORT_PARAM_MODELS,
  ])
}

export function getOpenAIReasoningEffort(
  modelId: string,
  level: Exclude<ReasoningControlLevel, 'default'>
): NonNullable<ProviderOptions['openai']>['reasoningEffort'] {
  if (level === 'off') {
    return matchesAny(modelId, OPENAI_NONE_EFFORT_MODELS) ? 'none' : 'minimal'
  }
  return level
}

function normalizeEffortToLevel(effort: string | undefined): ReasoningControlLevel {
  if (!effort) return 'default'
  if (effort === 'none' || effort === 'minimal') return 'off'
  if (effort === 'low' || effort === 'medium' || effort === 'high') return effort
  return 'high'
}

function compactProviderOptions(options: ProviderOptions): ProviderOptions | undefined {
  const next: ProviderOptions = { ...options }
  if (!next.claude) delete next.claude
  if (!next.openai) delete next.openai
  if (!next.google) delete next.google
  if (!next.deepseek) delete next.deepseek
  if (!next.openaiCompatible) delete next.openaiCompatible
  if (!next.openrouter) delete next.openrouter
  return Object.keys(next).length > 0 ? next : undefined
}

// Provider option namespaces that exclusively carry reasoning/thinking configuration.
// Keep this in sync with ProviderOptionsSchema in shared/types/settings.ts.
const REASONING_PROVIDER_OPTION_KEYS = [
  'claude',
  'openai',
  'google',
  'deepseek',
  'openaiCompatible',
  'openrouter',
] as const satisfies readonly (keyof ProviderOptions)[]

/**
 * Removes reasoning/thinking provider options so they are never sent to a model
 * that does not support reasoning control. This guards against stale options
 * persisted on a session (e.g. set on a reasoning-capable model, then carried
 * over after switching to a model without reasoning support). It also implements
 * the 'default' reasoning level (send no reasoning parameters) and the fallback
 * when 'off' is requested for a model whose thinking cannot be force-disabled.
 */
export function stripReasoningProviderOptions(
  providerOptions: ProviderOptions | undefined
): ProviderOptions | undefined {
  if (!providerOptions) return providerOptions
  const next: ProviderOptions = { ...providerOptions }
  let changed = false
  for (const key of REASONING_PROVIDER_OPTION_KEYS) {
    if (next[key] !== undefined) {
      delete next[key]
      changed = true
    }
  }
  if (!changed) return providerOptions
  return Object.keys(next).length > 0 ? next : undefined
}
