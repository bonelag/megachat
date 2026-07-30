// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { QuotaExhaustedCard } from './QuotaExhaustedCard'

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
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('QuotaExhaustedCard', () => {
  test('renders a normal status card and dispatches the upgrade action', () => {
    const onUpgrade = vi.fn()
    render(
      <MantineProvider>
        <QuotaExhaustedCard kind="quota-exhausted" onUpgrade={onUpgrade} />
      </MantineProvider>
    )

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade plan' }))
    expect(onUpgrade).toHaveBeenCalledOnce()
  })

  test('uses daily-reset copy for Free quota exhaustion', () => {
    render(
      <MantineProvider>
        <QuotaExhaustedCard kind="free-quota-exhausted" onUpgrade={vi.fn()} />
      </MantineProvider>
    )

    expect(screen.getByText(/Free points reset daily/)).toBeTruthy()
  })
})
