type FollowOutputScrollBehavior = 'auto' | 'smooth'

interface SmoothFollowOutputOptions {
  scrollToBottom: (behavior: FollowOutputScrollBehavior) => void
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
  getScrollBehavior?: () => FollowOutputScrollBehavior
}

const SCROLL_DIRECTION_TOLERANCE = 0.5
const HEIGHT_CHANGE_TOLERANCE = 0.5

export function createSmoothFollowOutputController({
  scrollToBottom,
  requestFrame = window.requestAnimationFrame.bind(window),
  cancelFrame = window.cancelAnimationFrame.bind(window),
  getScrollBehavior = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'),
}: SmoothFollowOutputOptions) {
  // Wait for a real at-bottom signal so restoring a session in the middle does not unexpectedly jump to the end.
  let following = false
  let lastScrollTop: number | undefined
  let lastMaxScrollTop: number | undefined
  let lastHeight: number | undefined
  let pendingFrame: number | undefined

  const pause = () => {
    following = false
  }

  const resume = () => {
    following = true
  }

  const handleScroll = (scrollTop: number, maxScrollTop: number) => {
    const movedUp = lastScrollTop !== undefined && scrollTop < lastScrollTop - SCROLL_DIRECTION_TOLERANCE
    const movedUpBecauseLayoutShrank =
      lastMaxScrollTop !== undefined && maxScrollTop < lastMaxScrollTop - HEIGHT_CHANGE_TOLERANCE
    lastScrollTop = scrollTop
    lastMaxScrollTop = maxScrollTop
    if (movedUp && !movedUpBecauseLayoutShrank) {
      pause()
    }
    return movedUp && !movedUpBecauseLayoutShrank
  }

  const handleHeightChange = (height: number) => {
    const grew = lastHeight !== undefined && height > lastHeight + HEIGHT_CHANGE_TOLERANCE
    lastHeight = height
    if (!grew || !following || pendingFrame !== undefined) {
      return
    }

    // Streaming can trigger several measurements in one frame. Retarget the native smooth scroll only once.
    pendingFrame = requestFrame(() => {
      pendingFrame = undefined
      if (following) {
        scrollToBottom(getScrollBehavior())
      }
    })
  }

  const dispose = () => {
    if (pendingFrame !== undefined) {
      cancelFrame(pendingFrame)
      pendingFrame = undefined
    }
  }

  return {
    handleHeightChange,
    handleScroll,
    pause,
    resume,
    isFollowing: () => following,
    dispose,
  }
}
