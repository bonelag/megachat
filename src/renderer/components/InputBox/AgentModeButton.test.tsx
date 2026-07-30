// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

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

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/', search: {} }),
}))

vi.mock('@/stores/session/agent-mode', () => ({
  useSessionAgentMode: () => ({ value: 'on', locked: false, lockReason: null }),
}))

vi.mock('@/platform', () => ({ default: { type: 'desktop' } }))

vi.mock('./AgentModePanel', () => ({ default: () => null }))

import AgentModeButton from './AgentModeButton'

function renderButton(modelSupportsAgentMode: boolean) {
  render(
    <MantineProvider>
      <AgentModeButton
        sessionId="session-1"
        modelSupportsAgentMode={modelSupportsAgentMode}
        webBrowsingMode={false}
        onWebBrowsingChange={vi.fn()}
        onKnowledgeBaseSelect={vi.fn()}
        onSkillSelect={vi.fn()}
      />
    </MantineProvider>
  )
}

describe('AgentModeButton', () => {
  test('is disabled when the selected model does not support agent tools', () => {
    renderButton(false)

    const button = screen.getByRole('button', { name: 'Chat Mode' })
    expect(button).toHaveProperty('disabled', true)
    expect(button.getAttribute('title')).toBe('This model does not support Agent Mode')
  })

  test('remains enabled for a model that supports agent tools', () => {
    renderButton(true)

    expect(screen.getByRole('button', { name: 'Work Mode' })).toHaveProperty('disabled', false)
  })
})
