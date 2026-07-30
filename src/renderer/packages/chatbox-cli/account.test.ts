import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getLicenseDetailRealtimeMock, settingsState } = vi.hoisted(() => ({
  getLicenseDetailRealtimeMock: vi.fn(),
  settingsState: {
    current: {} as Record<string, unknown>,
  },
}))

vi.mock('@/packages/remote', () => ({
  getLicenseDetailRealtime: getLicenseDetailRealtimeMock,
}))
vi.mock('@/platform', () => ({
  default: {
    getVersion: vi.fn(),
    getPlatform: vi.fn(),
  },
}))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => settingsState.current,
    setState: (patch: Record<string, unknown>) => {
      settingsState.current = { ...settingsState.current, ...patch }
    },
  },
}))

import { accountCommands } from './account'
import type { ChatboxCliCommandContext } from './types'

function refreshCommand() {
  const command = accountCommands.find((candidate) => candidate.path.join(' ') === 'account refresh')
  if (!command) throw new Error('Missing account refresh command')
  return command
}

function quotaCommand() {
  const command = accountCommands.find((candidate) => candidate.path.join(' ') === 'account quota')
  if (!command) throw new Error('Missing account quota command')
  return command
}

describe('Chatbox CLI account commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsState.current = {
      licenseKey: 'license-key',
      licenseActivationMethod: 'login',
      hasExpiredLicense: false,
    }
  })

  it('records an expired license error even when the response has no detail data', async () => {
    getLicenseDetailRealtimeMock.mockResolvedValue({
      data: null,
      error: {
        code: 'expired_license',
        detail: 'License expired',
        status: 403,
        title: 'Expired license',
      },
    })

    await expect(refreshCommand().execute({} as ChatboxCliCommandContext)).resolves.toMatchObject({
      refreshed: false,
      status: { hasExpiredLicense: true },
    })
    expect(settingsState.current.hasExpiredLicense).toBe(true)
  })

  it('does not clear a cached expired state for unrelated error-only responses', async () => {
    settingsState.current.hasExpiredLicense = true
    getLicenseDetailRealtimeMock.mockResolvedValue({
      data: null,
      error: {
        code: 'temporary_error',
        detail: 'Try again later',
        status: 503,
        title: 'Temporary error',
      },
    })

    await refreshCommand().execute({} as ChatboxCliCommandContext)

    expect(settingsState.current.hasExpiredLicense).toBe(true)
  })

  it('returns the unified compute-point balance as a percentage', async () => {
    settingsState.current.licenseDetail = {
      remaining_quota_unified: 0.894,
      unified_token_usage: 106,
      unified_token_limit: 1000,
      unified_token_usage_details: [],
      expansion_pack_limit: 0,
      expansion_pack_usage: 0,
      image_total_quota: 10,
      image_used_count: 2,
      plan_image_limit: 10,
    }

    const result = await quotaCommand().execute({} as ChatboxCliCommandContext)

    expect(result).toMatchObject({
      quota: {
        unifiedTokens: {
          remainingPercentage: 89.4,
          used: 106,
          total: 1000,
        },
      },
    })
    expect((result.quota as { unifiedTokens: Record<string, unknown> }).unifiedTokens).not.toHaveProperty('remaining')
  })
})
