import { ModelProviderEnum } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  applyChatboxLicenseDefaultModelToSession,
  type ChatboxDefaultModelSettings,
  resolveChatboxLicenseDefaultModel,
} from './defaultChatModel'

function makeSettings(overrides: Partial<ChatboxDefaultModelSettings> = {}): ChatboxDefaultModelSettings {
  return {
    hasExpiredLicense: false,
    ...overrides,
  }
}

describe('resolveChatboxLicenseDefaultModel', () => {
  it('keeps BYOK users without a Chatbox license on the existing no-default path', () => {
    expect(resolveChatboxLicenseDefaultModel(makeSettings())).toBeUndefined()
  })

  it('does not use an expired Chatbox license as the default model source', () => {
    expect(
      resolveChatboxLicenseDefaultModel(
        makeSettings({
          licenseKey: 'license-key',
          hasExpiredLicense: true,
          licenseDetail: {
            name: 'Chatbox AI Pro',
            defaultModel: 'chatboxai-4',
          },
        })
      )
    ).toBeUndefined()
  })

  it('uses the license defaultModel when the API provides one', () => {
    expect(
      resolveChatboxLicenseDefaultModel(
        makeSettings({
          licenseKey: 'license-key',
          licenseDetail: {
            name: 'Chatbox AI Pro',
            defaultModel: 'chatboxai-4',
            type: 'chatboxai-3.5',
          },
        })
      )
    ).toEqual({
      provider: ModelProviderEnum.ChatboxAI,
      modelId: 'chatboxai-4',
    })
  })

  it('falls back to the license type when defaultModel is missing', () => {
    expect(
      resolveChatboxLicenseDefaultModel(
        makeSettings({
          licenseKey: 'license-key',
          licenseDetail: {
            name: 'Chatbox AI Lite',
            type: 'chatboxai-3.5',
          },
        })
      )
    ).toEqual({
      provider: ModelProviderEnum.ChatboxAI,
      modelId: 'chatboxai-3.5',
    })
  })

  it('uses plan names as a fallback for older license details', () => {
    expect(
      resolveChatboxLicenseDefaultModel(
        makeSettings({
          licenseKey: 'license-key',
          licensePlanName: 'Chatbox AI Pro',
        })
      )
    ).toEqual({
      provider: ModelProviderEnum.ChatboxAI,
      modelId: 'chatboxai-4',
    })

    expect(
      resolveChatboxLicenseDefaultModel(
        makeSettings({
          licenseKey: 'license-key',
          licensePlanName: 'Chatbox AI Lite',
        })
      )
    ).toEqual({
      provider: ModelProviderEnum.ChatboxAI,
      modelId: 'chatboxai-3.5',
    })
  })

  it('uses license plan over display name when defaultModel and type are missing', () => {
    expect(
      resolveChatboxLicenseDefaultModel(
        makeSettings({
          licenseKey: 'license-key',
          licenseDetail: {
            name: 'Chatbox AI Pro',
            plan: 'lite',
          },
        })
      )
    ).toEqual({
      provider: ModelProviderEnum.ChatboxAI,
      modelId: 'chatboxai-3.5',
    })

    expect(
      resolveChatboxLicenseDefaultModel(
        makeSettings({
          licenseKey: 'license-key',
          licenseDetail: {
            name: 'Chatbox AI Lite',
            plan: 'pro',
          },
        })
      )
    ).toEqual({
      provider: ModelProviderEnum.ChatboxAI,
      modelId: 'chatboxai-4',
    })
  })
})

describe('applyChatboxLicenseDefaultModelToSession', () => {
  it('keeps preset chat sessions unchanged for BYOK users', () => {
    const session = {
      type: 'chat' as const,
      settings: undefined,
    }

    expect(applyChatboxLicenseDefaultModelToSession(session, makeSettings())).toBe(session)
  })

  it('applies the Chatbox license model to preset chat sessions without a selected model', () => {
    const session = {
      type: 'chat' as const,
      settings: {
        temperature: 0.7,
      },
    }

    expect(
      applyChatboxLicenseDefaultModelToSession(
        session,
        makeSettings({
          licenseKey: 'license-key',
          licenseDetail: {
            name: 'Chatbox AI Pro',
            defaultModel: 'chatboxai-4',
          },
        })
      )
    ).toEqual({
      type: 'chat',
      settings: {
        temperature: 0.7,
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'chatboxai-4',
      },
    })
  })

  it('does not override an existing preset session model', () => {
    const session = {
      type: 'chat' as const,
      settings: {
        provider: ModelProviderEnum.OpenAI,
        modelId: 'gpt-4o',
      },
    }

    expect(
      applyChatboxLicenseDefaultModelToSession(
        session,
        makeSettings({
          licenseKey: 'license-key',
          licenseDetail: {
            name: 'Chatbox AI Pro',
            defaultModel: 'chatboxai-4',
          },
        })
      )
    ).toBe(session)
  })

  it('does not apply chat defaults to picture sessions', () => {
    const session = {
      type: 'picture' as const,
      settings: undefined,
    }

    expect(
      applyChatboxLicenseDefaultModelToSession(
        session,
        makeSettings({
          licenseKey: 'license-key',
          licenseDetail: {
            name: 'Chatbox AI Pro',
            defaultModel: 'chatboxai-4',
          },
        })
      )
    ).toBe(session)
  })
})
