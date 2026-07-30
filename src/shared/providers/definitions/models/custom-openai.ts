import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import { fetchRemoteModels, getOpenAICompatibleProviderOptionsKey } from '../../../models/openai-compatible'
import type { CallChatCompletionOptions } from '../../../models/types'
import { createFetchWithProxy } from '../../../models/utils/fetch-proxy'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeOpenAIApiHostAndPath } from '../../../utils/llm_utils'
import { pickOpenAICompatibleReasoningOptions } from '../../../utils/reasoning-control'

interface Options {
  apiKey: string
  apiHost: string
  apiPath: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
  useProxy?: boolean
  customHeaders?: Array<{ key: string; value: string }>
  userAgent?: string
}

type FetchFunction = typeof globalThis.fetch

export default class CustomOpenAI extends AbstractAISDKModel {
  public name = 'Custom OpenAI'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
    const { apiHost, apiPath } = normalizeOpenAIApiHostAndPath(options)
    this.options = { ...options, apiHost, apiPath }
  }

  protected getCallSettings(options: CallChatCompletionOptions) {
    const openAICompatibleOptions = pickOpenAICompatibleReasoningOptions(
      this.options.model.modelId,
      options.providerOptions
    )
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
      stream: this.options.stream,
      providerOptions: openAICompatibleOptions
        ? {
            openaiCompatible: openAICompatibleOptions,
            [getOpenAICompatibleProviderOptionsKey(this.name)]: openAICompatibleOptions,
          }
        : undefined,
    }
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider(_options: CallChatCompletionOptions, fetchFunction?: FetchFunction) {
    return createOpenAICompatible({
      name: this.name,
      apiKey: this.options.apiKey,
      baseURL: this.options.apiHost,
      fetch: fetchFunction,
      headers: this.options.apiHost.includes('openrouter.ai')
        ? {
            'HTTP-Referer': 'https://chatboxai.app',
            'X-Title': 'Chatbox AI',
          }
        : this.options.apiHost.includes('aihubmix.com')
          ? {
              'APP-Code': 'VAFU9221',
            }
          : undefined,
    })
  }

  protected getChatModel(options: CallChatCompletionOptions) {
    const { apiHost, apiPath } = this.options
    const provider = this.getProvider(options, async (_input, init) => {
      return createFetchWithProxy(
        this.options.useProxy,
        this.dependencies,
        this.options.customHeaders,
        this.options.userAgent
      )(`${apiHost}${apiPath}`, init)
    })
    return wrapLanguageModel({
      model: provider.languageModel(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }

  public listModels() {
    const customHeadersRecord: Record<string, string> = {}
    if (this.options.customHeaders) {
      for (const h of this.options.customHeaders) {
        if (h.key && h.value) {
          customHeadersRecord[h.key] = h.value
        }
      }
    }
    if (this.options.userAgent) {
      customHeadersRecord['User-Agent'] = this.options.userAgent
    }

    return fetchRemoteModels(
      {
        apiHost: this.options.apiHost,
        apiKey: this.options.apiKey,
        useProxy: this.options.useProxy,
        extraHeaders: customHeadersRecord,
      },
      this.dependencies
    )
  }

  protected getImageModel() {
    // Custom OpenAI providers typically don't support image generation
    return null
  }
}
