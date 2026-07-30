# 思考控制（Reasoning Control）

> Last updated: 2026-06

本文梳理「思考控制」（即推理强度 / thinking effort）的**支持条件判定逻辑**，以及参数从 UI 选择到请求发出的完整流转，供后续维护参考。

核心源码：

| 文件 | 职责 |
|------|------|
| `src/shared/utils/reasoning-control.ts` | 支持条件判定、档位与 providerOptions 生成、请求侧剥离 helper |
| `src/renderer/components/InputBox/ReasoningControlButton.tsx` | 思考控制下拉控件（UI） |
| `src/renderer/components/InputBox/useReasoningControlState.ts` | 控件状态、按会话持久化 `providerOptions` |
| `src/shared/models/abstract-ai-sdk.ts` | 请求边界统一兜底（`resolveCallSettings`） |

---

## 1. 唯一可靠的判定信号：provider + 写死的 model id / 前缀

**不要用模型的 `reasoning` 能力标志（`isSupportReasoning()` / `capabilities` 含 `'reasoning'`）来判断是否支持思考控制——这个值不可靠。** 部分确实支持思考的模型（例如 `qwen3.x`）在 registry 元数据里并没有 `reasoning` 能力标志（`src/shared/providers/definitions/qwen.ts` 里 `qwen3.7-max` 只有 `['tool_use']`）。

唯一可靠的判定是 **provider + 写死的 model id 列表 / 正则前缀**，由 `getReasoningControlCapabilities(provider, model)` 统一实现。UI 是否显示控件、请求侧是否保留参数，都必须以它为准，保证两端一致。

```ts
getReasoningControlCapabilities(provider, model): {
  supported: boolean
  kind: 'anthropic-adaptive-effort' | 'anthropic-effort' | 'budget' | 'level'
      | 'openai-effort' | 'openrouter-reasoning' | 'toggle' | 'xai-effort'
  disabledReason?: ...
}
```

`provider` 是 provider id 字符串（与 `ModelProviderEnum` 值比较，如 `'chatbox-ai'`、`'qwen'`），`model` 是 `ProviderModelInfo`（含 `modelId`、`apiStyle`）。

---

## 2. effectiveProvider：apiStyle 映射（含自建供应商）

对 **ChatboxAI** 和**自建供应商（custom）**，模型可能以任意 API 风格代理后端模型，因此用 `apiStyle` 推导「有效供应商」（`getEffectiveProvider`）：

| `apiStyle` | effectiveProvider |
|-----------|-------------------|
| `anthropic` | Claude |
| `google` | Gemini |
| `openai-responses` | OpenAIResponses |
| 其它 / 未设置 | OpenAI |

是否走 apiStyle 映射由 `usesModelApiStyleForReasoning(provider)` 决定，返回 `true` 的情况：

- `provider === ChatboxAI`
- `provider === Custom`（字面枚举值 `'custom'`）
- **`provider` 不是任何内置供应商 id**（即用户自建供应商，其 id 是任意值）—— 通过 `isCustomProviderId()`（不在 `Object.values(ModelProviderEnum)` 中）判断

> **代理型供应商的判定原则：api style（= provider type）+ model id。** 这类供应商的 id 不带内置语义，不能用 id 直接匹配模型列表；必须先由 provider type 决定 api style，再用 api style 推导 effectiveProvider，最后用 model id 命中写死的列表。涵盖：
> - **自建供应商（custom）**：id 任意，`isCustomProviderId` 命中（不在 `ModelProviderEnum`）。
> - **内置代理供应商**：如 `github-copilot`（id 不在 `ModelProviderEnum`，type 为 OpenAI，代理 gpt/claude/gemini 等）——同样被 `isCustomProviderId` 命中，按 apiStyle 判定。
>
> apiStyle 兜底两端共用 `src/shared/providers/api-style.ts` 的 `API_STYLE_BY_PROVIDER_TYPE` / `apiStyleFromProviderType`，**单一来源**：
> - UI 侧：`useReasoningControlState` 的 `withProviderApiStyleFallback`。
> - 请求侧：`getModel` 的 `withReasoningApiStyle`（registry + custom 两条分支都盖），保证 UI 与 gate 解析出同一 effectiveProvider。
>
> OpenRouter 例外，始终保持自身；其它内置供应商（id 在枚举内）直接用自身作为 effectiveProvider，apiStyle 被忽略，盖值是无副作用的 no-op。
> `isOpenAICompatibleApiStyle` 同样对 ChatboxAI 和上述代理型供应商生效（用于 DeepSeek 等按 model id 检测的思考模型）。

---

## 3. 各 effectiveProvider 的支持条件

`getReasoningControlCapabilities` 按 effectiveProvider + model-id 列表逐项匹配（源码 `reasoning-control.ts` 顶部常量）：

| effectiveProvider | model-id 匹配 | kind | 档位形态 |
|-------------------|--------------|------|---------|
| Claude | `claude-opus-4-(7\|8)` | `anthropic-adaptive-effort` | off + low/medium/high（adaptive effort） |
| Claude | `claude-opus-4-5` | `anthropic-effort` | off + low/medium/high（effort） |
| Claude | `claude-3-7-sonnet`、`claude-sonnet-4`、`claude-haiku-4-5`、`claude-opus-4`(非 4.5/4.7/4.8) | `budget` | off + low/medium/high（thinking budget） |
| Gemini | `getGoogleThinkingMode()` 为 `budget` | `budget` | thinkingBudget |
| Gemini | `getGoogleThinkingMode()` 为 `level` | `level` | thinkingLevel |
| DeepSeek / OpenAI-compatible 的 DeepSeek 思考模型 | `isDeepSeekReasoningModel()` | `toggle` | off / on |
| OpenAI 系（OpenAI / OpenAIResponses / Azure） | `gpt-5*`、`gpt-oss*`（`GPT_EFFORT_MODELS`） | `openai-effort` | off + low/medium/high |
| Qwen / QwenPortal | `qwen3*`（`QWEN_THINKING_MODELS`） | `budget` | off + low/medium/high |
| XAI | `grok-4*`（`GROK_REASONING_EFFORT_MODELS`） | `xai-effort` | off + low/medium/high |
| OpenRouter | `isOpenRouterReasoningModel()`（聚合上述 Claude/GPT/Qwen/Grok/DeepSeek/o 系列） | `openrouter-reasoning` | off + low/medium/high |

不匹配任何一项 → `DEFAULT_CAPABILITIES`（`supported: false`），控件隐藏、请求侧剥离参数。

> 这些常量列表（`GPT_EFFORT_MODELS`、`CLAUDE_*`、`QWEN_THINKING_MODELS`、`GROK_REASONING_EFFORT_MODELS` 等）就是「写死的 model id / 前缀」的来源。**新增支持思考的模型，在这里加正则即可。**

### disabledReason：api style 不匹配

若模型 id 命中某家的思考模型，但当前 effectiveProvider 与之不符（例如把 Claude 思考模型挂在非 anthropic 风格上），`getApiStyleDisabledReason` 返回对应原因，`supported: false`，并在 UI 上提示需要切换到对应 API 风格。

---

## 4. providerOptions 生成（off 的特殊处理）

`getReasoningProviderOptions(provider, model, level, previous)`：

- **若 `!supported`：原样返回 `previous`**（不新增也不清理；清理由请求侧兜底，见 §6）。
- 按 effectiveProvider 写入对应命名空间（`claude` / `openai` / `google` / `deepseek` / `openaiCompatible` / `openrouter`）。
- `level === 'off'` 时各家关闭方式不同，例如：
  - OpenAI 系：`openai.reasoningEffort = 'none' | 'minimal'`（`gpt-5.1/5.2/5.5` 等 `OPENAI_NONE_EFFORT_MODELS` 用合法值 `'none'`，其余用 `'minimal'`）+ `forceReasoning: true`
  - Claude（budget 形态）：`claude.thinking = { type: 'disabled', budgetTokens: 0 }`
  - Gemini：`google.thinkingConfig = { thinkingBudget: 0, includeThoughts: false }`（或 level 形态的 minimal）
  - Qwen：`openaiCompatible.enable_thinking = false`

> 注意 `reasoningEffort: 'none'` 对 `gpt-5.x` 是**合法值**，是有意为之；对不支持思考的模型才是问题（见 §6）。

整个 `ProviderOptions`（`src/shared/types/settings.ts`）schema 的全部命名空间都只承载思考/推理配置，没有非 reasoning 字段。

---

## 5. 持久化与「残留参数」问题

`providerOptions` 按 **session 级**持久化在 `session.settings.providerOptions`（`useReasoningControlState.ts`）。

典型踩坑路径：

1. 用支持思考的模型（如 `gpt-5.x`）把思考设为 off → 写入 `openai: { reasoningEffort: 'none', forceReasoning: true }`。
2. 同一会话内切换到**不支持思考**的模型（如 `chatbox ai 4`）。
3. 切模型不清理持久化值，且控件对不支持的模型直接隐藏，用户无从在 UI 清掉残留。
4. 若请求构造不做过滤，`reasoning_effort: 'none'` 被发给不支持的模型 → 报错。

> 设计上**有意保留**持久化值（而非切模型时清空），这样切回支持思考的模型时能恢复用户偏好。正确性由请求侧兜底保证。

---

## 6. 请求侧统一兜底（根治）

在 `AbstractAISDKModel.resolveCallSettings()`（`abstract-ai-sdk.ts`）统一处理，覆盖**所有 provider**：

```ts
const providerId = this.options.model.providerId
const shouldStrip =
  !!providerId &&
  !!options.providerOptions &&
  !getReasoningControlCapabilities(providerId, this.options.model).supported
// shouldStrip 时用 stripReasoningProviderOptions() 剥离全部 reasoning 命名空间
```

要点：

- **判定与 UI 同源**：用 `getReasoningControlCapabilities(providerId, model)`，不用 `isSupportReasoning()`。保证「UI 显示控件 ↔ 保留参数」一致。
- **provider id 来源**：`getModel` → `getModelConfig` 解析模型时盖上 `model.providerId = settings.provider`（`providers/index.ts`），是 registry / custom 两条路径的共用钩子。自建供应商分支还会按 provider type 盖上 `model.apiStyle`，使请求侧能按「api style + model id」判定。
- **保守默认**：`providerId` 未知时**不剥离**，避免误删无法正面分类的参数。
- **剥离实现**：`stripReasoningProviderOptions()` 显式枚举 6 个 reasoning 命名空间（`claude` / `openai` / `google` / `deepseek` / `openaiCompatible` / `openrouter`）并移除；与 `ProviderOptionsSchema` 保持同步。
- `chatStream()` 与 `_callChatCompletion()` 两个生成入口都经由 `resolveCallSettings()`。

---

## 7. 新增 / 调整支持模型的检查清单

1. 在 `reasoning-control.ts` 顶部对应的 model-id 列表 / 正则里增删条目（这是唯一可靠的判定来源）。
2. 如需新的关闭语义或档位映射，更新 `getReasoningProviderOptions` 中对应 effectiveProvider 分支。
3. 若涉及新的 providerOptions 命名空间，同步更新 `ProviderOptionsSchema` 与 `stripReasoningProviderOptions` 的 `REASONING_PROVIDER_OPTION_KEYS`。
4. 补充 `reasoning-control.test.ts` / `reasoning-request-options.test.ts` 用例。
5. **切勿**改回用 `isSupportReasoning()` / `capabilities` 做支持判定。
