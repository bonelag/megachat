import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { Provider } from 'ai'
import type { ModelDependencies } from '../types/adapters'
import type { SentryScope } from '../utils/sentry_adapter'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AbstractAISDKModel from './abstract-ai-sdk'
import type { CallChatCompletionOptions } from './types'

const aiMocks = vi.hoisted(() => ({
  streamText: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    streamText: aiMocks.streamText,
  }
})

const languageModel: LanguageModelV3 = {
  specificationVersion: 'v3',
  provider: 'test',
  modelId: 'test-model',
  supportedUrls: {},
  doGenerate: vi.fn(),
  doStream: vi.fn(),
}

class TestModel extends AbstractAISDKModel {
  protected getProvider(
    _options: CallChatCompletionOptions
  ): Pick<Provider, 'languageModel'> & Partial<Pick<Provider, 'embeddingModel' | 'imageModel'>> {
    return {
      languageModel: () => languageModel,
    }
  }

  protected getChatModel(_options: CallChatCompletionOptions): LanguageModelV3 {
    return languageModel
  }
}

function createDependencies(): ModelDependencies {
  return {
    request: {
      apiRequest: vi.fn(),
      fetchWithOptions: vi.fn(),
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    sentry: {
      captureException: vi.fn(),
      withScope: vi.fn((callback: (scope: SentryScope) => void) =>
        callback({
          setTag: vi.fn(),
          setExtra: vi.fn(),
        })
      ),
    },
    getRemoteConfig: vi.fn(() => ({})),
  }
}

function createModel(): TestModel {
  return new TestModel(
    {
      model: {
        modelId: 'test-model',
        type: 'chat',
        capabilities: ['tool_use'],
      },
    },
    createDependencies()
  )
}

describe('AbstractAISDKModel tool errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates an error tool-call part with provider metadata when no call chunk preceded the error', async () => {
    const providerMetadata = { google: { thoughtSignature: 'signature-1' } }
    aiMocks.streamText.mockReturnValue({
      fullStream: (async function* () {
        yield {
          type: 'tool-error',
          toolCallId: 'tc1',
          toolName: 'code_execution',
          input: '{"code":"console.log(1)",',
          error: new Error('Invalid JSON'),
          providerMetadata,
          providerExecuted: true,
          dynamic: true,
        }
      })(),
      totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
      finishReason: Promise.resolve('stop'),
    })

    const result = await createModel().chat([], {})

    expect(result.contentParts).toHaveLength(1)
    expect(result.contentParts[0]).toMatchObject({
      type: 'tool-call',
      state: 'error',
      toolCallId: 'tc1',
      toolName: 'code_execution',
      args: '{"code":"console.log(1)",',
      providerMetadata,
      providerExecuted: true,
      result: {
        error: {
          name: 'Error',
          message: 'Invalid JSON',
        },
        input: '{"code":"console.log(1)",',
        toolName: 'code_execution',
      },
    })
  })

  it('stores error metadata on the result side when the call part already exists', async () => {
    const callMetadata = { google: { thoughtSignature: 'signature-1' } }
    const errorMetadata = { google: { errorDetail: 'detail-1' } }
    aiMocks.streamText.mockReturnValue({
      fullStream: (async function* () {
        yield {
          type: 'tool-call',
          toolCallId: 'tc1',
          toolName: 'code_execution',
          input: { code: 'throw new Error()' },
          providerMetadata: callMetadata,
          providerExecuted: true,
          dynamic: true,
        }
        yield {
          type: 'tool-error',
          toolCallId: 'tc1',
          toolName: 'code_execution',
          input: { code: 'throw new Error()' },
          error: new Error('Execution failed'),
          providerMetadata: errorMetadata,
          providerExecuted: true,
          dynamic: true,
        }
      })(),
      totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
      finishReason: Promise.resolve('stop'),
    })

    const result = await createModel().chat([], {})

    expect(result.contentParts[0]).toMatchObject({
      type: 'tool-call',
      state: 'error',
      providerMetadata: callMetadata,
      resultProviderMetadata: errorMetadata,
    })
  })
})
