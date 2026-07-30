import { describe, expect, it, vi } from 'vitest'
import { createSmoothFollowOutputController } from './smooth-follow-output'

function createHarness(behavior: 'auto' | 'smooth' = 'smooth') {
  const frames = new Map<number, FrameRequestCallback>()
  const scrollToBottom = vi.fn()
  let nextFrameId = 1
  const controller = createSmoothFollowOutputController({
    scrollToBottom,
    requestFrame: (callback) => {
      const frameId = nextFrameId++
      frames.set(frameId, callback)
      return frameId
    },
    cancelFrame: (frameId) => {
      frames.delete(frameId)
    },
    getScrollBehavior: () => behavior,
  })

  const runFrames = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((callback) => callback(0))
  }

  return { controller, frames, runFrames, scrollToBottom }
}

describe('smooth follow output controller', () => {
  it('smoothly follows height growth after reaching the bottom', () => {
    const { controller, runFrames, scrollToBottom } = createHarness()

    controller.handleHeightChange(400)
    controller.resume()
    controller.handleHeightChange(420)
    runFrames()

    expect(scrollToBottom).toHaveBeenCalledOnce()
    expect(scrollToBottom).toHaveBeenCalledWith('smooth')
  })

  it('does not pull the user back after they scroll upward', () => {
    const { controller, runFrames, scrollToBottom } = createHarness()

    controller.resume()
    controller.handleScroll(200, 200)
    expect(controller.handleScroll(150, 200)).toBe(true)
    controller.handleHeightChange(400)
    controller.handleHeightChange(420)
    runFrames()

    expect(controller.isFollowing()).toBe(false)
    expect(scrollToBottom).not.toHaveBeenCalled()
  })

  it('keeps following when a layout shrink clamps the scroll position upward', () => {
    const { controller, runFrames, scrollToBottom } = createHarness()

    controller.resume()
    controller.handleScroll(200, 200)
    expect(controller.handleScroll(150, 150)).toBe(false)
    controller.handleHeightChange(400)
    controller.handleHeightChange(420)
    runFrames()

    expect(controller.isFollowing()).toBe(true)
    expect(scrollToBottom).toHaveBeenCalledWith('smooth')
  })

  it('coalesces multiple height changes into one scroll per animation frame', () => {
    const { controller, frames, runFrames, scrollToBottom } = createHarness()

    controller.resume()
    controller.handleHeightChange(400)
    controller.handleHeightChange(420)
    controller.handleHeightChange(440)

    expect(frames.size).toBe(1)
    runFrames()
    expect(scrollToBottom).toHaveBeenCalledOnce()
  })

  it('uses the configured instant scroll behavior', () => {
    const { controller, runFrames, scrollToBottom } = createHarness('auto')

    controller.resume()
    controller.handleHeightChange(400)
    controller.handleHeightChange(420)
    runFrames()

    expect(scrollToBottom).toHaveBeenCalledWith('auto')
  })

  it('cancels a pending scroll when disposed', () => {
    const { controller, frames, runFrames, scrollToBottom } = createHarness()

    controller.resume()
    controller.handleHeightChange(400)
    controller.handleHeightChange(420)
    controller.dispose()
    expect(frames.size).toBe(0)
    runFrames()

    expect(scrollToBottom).not.toHaveBeenCalled()
  })
})
