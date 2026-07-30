// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { openViewer } = vi.hoisted(() => ({ openViewer: vi.fn() }))

vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
    exporter: { exportByUrl: vi.fn(), exportImageFile: vi.fn() },
  },
}))

vi.mock('./Artifact', () => ({
  isRenderableCodeLanguage: () => false,
}))

vi.mock('react-photoswipe-gallery', () => ({
  Gallery: ({
    children,
    uiElements,
  }: {
    children: ReactNode
    uiElements?: Array<{ name: string; ariaLabel?: string }>
  }) => (
    <div
      data-testid="image-viewer"
      data-download-label={uiElements?.find((element) => element.name === 'custom-download-button')?.ariaLabel}
    >
      {children}
    </div>
  ),
  Item: ({
    children,
    original,
    width,
    height,
  }: {
    children: (props: { ref: () => void; open: typeof openViewer; close: () => void }) => ReactNode
    original?: string
    width?: number
    height?: number
  }) => (
    <span data-testid="image-viewer-item" data-original={original} data-width={width} data-height={height}>
      {children({ ref: vi.fn(), open: openViewer, close: vi.fn() })}
    </span>
  ),
}))

import Markdown from './Markdown'

afterEach(() => {
  cleanup()
  openViewer.mockReset()
})

describe('Markdown images', () => {
  it('opens a rendered image in the shared viewer and preserves image metadata', async () => {
    render(<Markdown>{'![Generated preview](https://example.com/image.png?x=1&y=2 "Result")'}</Markdown>)

    const image = screen.getByRole('img', { name: 'Generated preview' })
    const viewerItem = screen.getByTestId('image-viewer-item')
    expect(image.getAttribute('title')).toBe('Result')
    expect(image.classList.contains('cursor-zoom-in')).toBe(true)
    expect(viewerItem.getAttribute('data-original')).toBe('https://example.com/image.png?x=1&y=2')
    expect(screen.getByTestId('image-viewer').getAttribute('data-download-label')).toBe('Download')

    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1280 },
      naturalHeight: { configurable: true, value: 720 },
    })
    fireEvent.load(image)

    await waitFor(() => {
      expect(viewerItem.getAttribute('data-width')).toBe('1280')
      expect(viewerItem.getAttribute('data-height')).toBe('720')
    })

    fireEvent.click(image)
    expect(openViewer).toHaveBeenCalledOnce()
  })

  it('opens linked images without navigating the enclosing link', () => {
    render(<Markdown>{'[![Linked preview](https://example.com/image.png)](https://example.com/destination)'}</Markdown>)

    const image = screen.getByRole('img', { name: 'Linked preview' })
    expect(fireEvent.click(image)).toBe(false)
    expect(openViewer).toHaveBeenCalledOnce()
  })

  it('groups all images from one Markdown block in one viewer', () => {
    render(
      <Markdown>{'![First](https://example.com/first.png)\n\n![Second](https://example.com/second.png)'}</Markdown>
    )

    expect(screen.getAllByTestId('image-viewer')).toHaveLength(1)
    expect(screen.getAllByTestId('image-viewer-item')).toHaveLength(2)
  })
})
