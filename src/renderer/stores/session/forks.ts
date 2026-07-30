import {
  buildCreateForkPatch,
  buildDeleteForkPatch,
  buildExpandForkPatch,
  buildSwitchForkPatch,
  findMessageLocation,
} from '@shared/session/message-forks'
import * as chatStore from '../chatStore'

// The pure fork transforms live in `@shared/session/message-forks` so the
// mobile-native app reuses the exact same branching logic. This module only
// wraps them in the renderer's `chatStore.updateSessionWithMessages` queue.
export { findMessageLocation }

/**
 * Create a new fork branch at the specified message
 */
export async function createNewFork(sessionId: string, forkMessageId: string) {
  await chatStore.updateSessionWithMessages(sessionId, (session) => {
    if (!session) {
      throw new Error('Session not found')
    }
    const patch = buildCreateForkPatch(session, forkMessageId)
    if (!patch) {
      return session
    }
    return {
      ...session,
      ...patch,
    }
  })
}

/**
 * Switch between fork branches
 */
export async function switchFork(sessionId: string, forkMessageId: string, direction: 'next' | 'prev') {
  await chatStore.updateSessionWithMessages(sessionId, (session) => {
    if (!session) {
      throw new Error('Session not found')
    }
    const patch = buildSwitchForkPatch(session, forkMessageId, direction)
    if (!patch) {
      return session
    }
    return {
      ...session,
      ...patch,
    } as typeof session
  })
}

/**
 * Delete the current fork branch
 */
export async function deleteFork(sessionId: string, forkMessageId: string) {
  await chatStore.updateSessionWithMessages(sessionId, (session) => {
    if (!session) {
      throw new Error('Session not found')
    }
    const patch = buildDeleteForkPatch(session, forkMessageId)
    if (!patch) {
      return session
    }
    return {
      ...session,
      ...patch,
    }
  })
}

/**
 * Expand all fork branches into the current message list
 * @deprecated
 */
export async function expandFork(sessionId: string, forkMessageId: string) {
  await chatStore.updateSessionWithMessages(sessionId, (session) => {
    if (!session) {
      throw new Error('Session not found')
    }
    const patch = buildExpandForkPatch(session, forkMessageId)
    if (!patch) {
      return session
    }
    return {
      ...session,
      ...patch,
    }
  })
}
