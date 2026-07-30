import { describe, expect, it } from 'vitest'
import { normalizePlausiblePath, normalizePlausibleUrl } from './plausible'

describe('normalizePlausiblePath', () => {
  it('groups session pages without retaining the session ID', () => {
    expect(normalizePlausiblePath('/session/session-123')).toBe('/session/:sessionId')
  })

  it('keeps built-in provider IDs for provider-level analytics', () => {
    expect(normalizePlausiblePath('/settings/provider/openai')).toBe('/settings/provider/openai')
    expect(normalizePlausiblePath('/settings/provider/github-copilot')).toBe('/settings/provider/github-copilot')
  })

  it('groups custom provider pages without retaining the custom provider ID', () => {
    expect(normalizePlausiblePath('/settings/provider/my-private-provider')).toBe('/settings/provider/:providerId')
  })

  it('keeps static routes unchanged', () => {
    expect(normalizePlausiblePath('/settings/general')).toBe('/settings/general')
  })
})

describe('normalizePlausibleUrl', () => {
  it('normalizes dynamic routes in an Electron hash URL', () => {
    expect(normalizePlausibleUrl('file:///Applications/Chatbox/index.html#/session/session-123')).toBe(
      'file:///Applications/Chatbox/index.html#/session/:sessionId'
    )
  })

  it('normalizes dynamic routes in a web URL', () => {
    expect(normalizePlausibleUrl('https://web.chatboxai.app/session/session-123')).toBe(
      'https://web.chatboxai.app/session/:sessionId'
    )
  })

  it('removes internal search parameters without exposing the route ID', () => {
    expect(normalizePlausibleUrl('https://app.chatboxai.app/#/session/session-123?settings=%2Fsettings')).toBe(
      'https://app.chatboxai.app/#/session/:sessionId'
    )
  })

  it('keeps supported attribution parameters', () => {
    expect(
      normalizePlausibleUrl('https://web.chatboxai.app/session/session-123?utm_source=newsletter&settings=%2Fsettings')
    ).toBe('https://web.chatboxai.app/session/:sessionId?utm_source=newsletter')
  })
})
