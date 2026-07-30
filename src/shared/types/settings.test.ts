import { describe, expect, test } from 'vitest'
import { settings as defaultSettings } from '../defaults'
import { SettingsSchema } from './settings'

describe('SettingsSchema RAG default models', () => {
  test('parses default embedding and rerank model selections', () => {
    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      defaultEmbeddingModel: {
        provider: 'openai',
        model: 'text-embedding-3-small',
      },
      defaultRerankModel: {
        provider: 'cohere',
        model: 'rerank-v3.5',
      },
    })

    expect(parsed.defaultEmbeddingModel).toEqual({
      provider: 'openai',
      model: 'text-embedding-3-small',
    })
    expect(parsed.defaultRerankModel).toEqual({
      provider: 'cohere',
      model: 'rerank-v3.5',
    })
  })

  test('defaults leave RAG model fallbacks unset', () => {
    const parsed = SettingsSchema.parse(defaultSettings())

    expect(parsed.defaultEmbeddingModel).toBeUndefined()
    expect(parsed.defaultRerankModel).toBeUndefined()
  })
})

describe('SettingsSchema shortcut compatibility', () => {
  test('adds the new thread shortcut when loading settings without the historical key', () => {
    const shortcuts: Record<string, unknown> = { ...defaultSettings().shortcuts }
    delete shortcuts.messageListRefreshContext

    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      shortcuts,
    })

    expect(parsed.shortcuts.messageListRefreshContext).toBe('mod+shift+n')
  })

  test('migrates the removed cmd+r shortcut to cmd+shift+n', () => {
    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      shortcuts: {
        ...defaultSettings().shortcuts,
        messageListRefreshContext: 'mod+r',
      },
    })

    expect(parsed.shortcuts.messageListRefreshContext).toBe('mod+shift+n')
  })

  test('moves the old image creator shortcut away from cmd+shift+n', () => {
    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      shortcuts: {
        ...defaultSettings().shortcuts,
        newPictureChat: 'mod+shift+n',
      },
    })

    expect(parsed.shortcuts.newPictureChat).toBe('')
  })
})

describe('SettingsSchema VibeDrop publication history', () => {
  test('parses session publication metadata without a schema migration', () => {
    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      vibedropSessionPublications: {
        'session-1': [
          {
            slug: 'site-1',
            url: 'https://site-1.vibedrop.site',
            visibility: 'public',
            uniqueId: 'artifact-1',
            updatedAt: 1,
          },
        ],
      },
    })

    expect(parsed.vibedropSessionPublications?.['session-1']?.[0]).toEqual({
      slug: 'site-1',
      url: 'https://site-1.vibedrop.site',
      visibility: 'public',
      uniqueId: 'artifact-1',
      updatedAt: 1,
    })
  })

  test('ignores malformed publication history from older or external settings', () => {
    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      vibedropSessionPublications: {
        'session-1': [{ slug: 'site-1' }],
      },
    })

    expect(parsed.vibedropSessionPublications).toBeUndefined()
  })
})
