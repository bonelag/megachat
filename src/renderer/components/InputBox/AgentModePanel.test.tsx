/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(
    (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })
  ),
})

HTMLElement.prototype.scrollTo = vi.fn()

const mocks = vi.hoisted(() => {
  const settingsState = {
    extension: {
      webSearch: {
        provider: 'build-in',
        tavilyApiKey: '',
      },
    },
    licenseKey: '',
    skills: {
      enabledSkillNames: [],
    },
    setSettings: vi.fn(),
  }
  const uiState = {
    newSessionState: {},
    setAgentModeSmartSwitchingDefault: vi.fn(),
    setNewSessionState: vi.fn(),
  }

  return { settingsState, uiState }
})

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/knowledge-base', () => ({
  useKnowledgeBases: () => ({ data: [] }),
}))

vi.mock('@/hooks/mcp', () => ({
  useMCPServerStatus: () => undefined,
  useToggleMCPServer: () => vi.fn(),
}))

vi.mock('@/modals/Settings', () => ({
  navigateToSettings: vi.fn(),
}))

vi.mock('@/packages/navigator', () => ({
  getOS: () => 'macOS',
}))

vi.mock('@/packages/skills/controller', () => ({
  skillsController: {
    discoverSkills: vi.fn(() => new Promise(() => {})),
  },
  subscribeSkillsChanged: () => vi.fn(),
}))

vi.mock('@/platform', () => ({
  default: { type: 'desktop' },
}))

vi.mock('@/stores/chatStore', () => ({
  updateSession: vi.fn(),
  useSession: () => ({ session: undefined }),
  useSessionSettings: () => ({ sessionSettings: {} }),
}))

vi.mock('@/stores/premiumActions', () => ({
  useAutoValidate: () => false,
}))

vi.mock('@/stores/session/agent-mode', () => ({
  setSessionAgentMode: vi.fn(),
  useSessionAgentMode: () => ({ value: 'on', locked: false, lockReason: null }),
}))

vi.mock('@/stores/settingsStore', () => ({
  useMcpSettings: () => ({ servers: [], enabledBuiltinServers: [] }),
  useSettingsStore: (selector: (state: typeof mocks.settingsState) => unknown) => selector(mocks.settingsState),
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: typeof mocks.uiState) => unknown) => selector(mocks.uiState),
}))

import AgentModePanel from './AgentModePanel'

const defaultProps: ComponentProps<typeof AgentModePanel> = {
  sessionId: 'new',
  modelSupportsAgentMode: true,
  webBrowsingMode: false,
  onWebBrowsingChange: vi.fn(),
  onKnowledgeBaseSelect: vi.fn(),
  onSkillSelect: vi.fn(),
  onClose: vi.fn(),
}

function renderPanel() {
  return render(
    <MantineProvider>
      <AgentModePanel {...defaultProps} />
    </MantineProvider>
  )
}

describe('AgentModePanel submenu hover behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('cancels a delayed submenu switch when the pointer leaves the target row', () => {
    renderPanel()

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Skills' }))
    expect(screen.getAllByText('Skills')).toHaveLength(2)

    const mcpRow = screen.getByRole('button', { name: 'MCP' })
    fireEvent.mouseEnter(mcpRow)
    fireEvent.mouseLeave(mcpRow, { relatedTarget: mcpRow.parentElement })

    act(() => vi.advanceTimersByTime(180))

    expect(screen.getAllByText('MCP')).toHaveLength(1)
    expect(screen.getAllByText('Skills')).toHaveLength(2)
  })

  test('clears a pending switch when Escape closes the submenu', () => {
    renderPanel()

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Skills' }))
    const mcpRow = screen.getByRole('button', { name: 'MCP' })
    fireEvent.mouseEnter(mcpRow)
    fireEvent.keyDown(mcpRow, { key: 'Escape' })

    act(() => vi.advanceTimersByTime(180))

    expect(screen.getAllByText('Skills')).toHaveLength(1)
    expect(screen.getAllByText('MCP')).toHaveLength(1)
  })

  test('resets the submenu when the pointer leaves the whole panel', () => {
    renderPanel()

    const skillsRow = screen.getByRole('button', { name: 'Skills' })
    fireEvent.mouseEnter(skillsRow)
    expect(screen.getAllByText('Skills')).toHaveLength(2)

    const panel = screen.getByRole('button', { name: 'Skills' }).closest('.relative')
    expect(panel).not.toBeNull()
    fireEvent.mouseLeave(panel as Element)

    expect(screen.getAllByText('Skills')).toHaveLength(1)
  })
})
