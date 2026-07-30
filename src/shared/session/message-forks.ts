import { v4 as uuidv4 } from 'uuid'
import type { Message, Session } from '../types/session'

/**
 * Pure message-fork transforms shared by the web renderer and the mobile-native
 * app. These functions take a Session and return a `Partial<Session>` patch (or
 * null when nothing changes); the caller is responsible for persisting it. The
 * renderer wraps them in `chatStore.updateSessionWithMessages`, while native
 * applies the patch and writes through its SQLite repository.
 *
 * Fork model: `messageForksHash` is keyed by the fork-point message id (the
 * message after which branches diverge — i.e. the user message). Each entry
 * holds `lists` (one per branch) and the active `position`. The active branch's
 * tail lives in `session.messages` after the fork point; its slot in `lists` is
 * kept empty until you switch away, at which point the current tail is saved
 * back into it and the target branch's tail is spliced into `session.messages`.
 */

export type MessageForkEntry = NonNullable<Session['messageForksHash']>[string]
export type MessageLocation = { list: Message[]; index: number }

/**
 * Find the location of a message within a session (root messages or thread messages)
 */
export function findMessageLocation(session: Session, messageId: string): MessageLocation | null {
  const rootIndex = session.messages.findIndex((m) => m.id === messageId)
  if (rootIndex >= 0) {
    return { list: session.messages, index: rootIndex }
  }
  if (!session.threads) {
    return null
  }
  for (const thread of session.threads) {
    const idx = thread.messages.findIndex((m) => m.id === messageId)
    if (idx >= 0) {
      return { list: thread.messages, index: idx }
    }
  }
  return null
}

export function buildSwitchForkPatch(
  session: Session,
  forkMessageId: string,
  direction: 'next' | 'prev'
): Partial<Session> | null {
  const { messageForksHash } = session
  if (!messageForksHash) {
    return null
  }

  const forkEntry = messageForksHash[forkMessageId]
  if (!forkEntry || forkEntry.lists.length <= 1) {
    return null
  }

  const rootResult = switchForkInMessages(session.messages, forkEntry, forkMessageId, direction)
  if (rootResult) {
    const { messages, fork } = rootResult
    return {
      messages,
      messageForksHash: computeNextMessageForksHash(messageForksHash, forkMessageId, fork),
    }
  }

  if (!session.threads?.length) {
    return null
  }

  let updatedFork: MessageForkEntry | null = null
  let forkWasProcessed = false
  const updatedThreads = session.threads.map((thread) => {
    if (forkWasProcessed) {
      return thread
    }
    const result = switchForkInMessages(thread.messages, forkEntry, forkMessageId, direction)
    if (!result) {
      return thread
    }
    forkWasProcessed = true
    updatedFork = result.fork
    return {
      ...thread,
      messages: result.messages,
    }
  })

  if (!forkWasProcessed) {
    return null
  }

  return {
    threads: updatedThreads,
    messageForksHash: computeNextMessageForksHash(messageForksHash, forkMessageId, updatedFork),
  }
}

function switchForkInMessages(
  messages: Message[],
  forkEntry: MessageForkEntry,
  forkMessageId: string,
  direction: 'next' | 'prev'
): { messages: Message[]; fork: MessageForkEntry | null } | null {
  const forkMessageIndex = messages.findIndex((m) => m.id === forkMessageId)
  if (forkMessageIndex < 0) {
    return null
  }

  const currentTail = messages.slice(forkMessageIndex + 1)
  const currentPosition = forkEntry.position

  // Check if current branch is empty (user deleted all messages in this branch)
  const isCurrentBranchEmpty = currentTail.length === 0

  // If current branch is empty, remove it from lists
  let updatedLists = forkEntry.lists
  let adjustedCurrentPosition = currentPosition

  if (isCurrentBranchEmpty) {
    updatedLists = forkEntry.lists.filter((_, index) => index !== currentPosition)
    // If only one branch remains after removing empty branch, clear fork entirely
    if (updatedLists.length <= 1) {
      const remainingMessages = updatedLists[0]?.messages ?? []
      return {
        messages: messages.slice(0, forkMessageIndex + 1).concat(remainingMessages),
        fork: null,
      }
    }
    // Adjust position for removed branch
    adjustedCurrentPosition = currentPosition >= updatedLists.length ? updatedLists.length - 1 : currentPosition
  }

  const total = updatedLists.length
  const newPosition =
    direction === 'next' ? (adjustedCurrentPosition + 1) % total : (adjustedCurrentPosition - 1 + total) % total

  const branchMessages = updatedLists[newPosition]?.messages ?? []

  const finalLists = updatedLists.map((list, index) => {
    // If we didn't remove current branch, save currentTail to it
    if (!isCurrentBranchEmpty && index === adjustedCurrentPosition && adjustedCurrentPosition !== newPosition) {
      return {
        ...list,
        messages: currentTail,
      }
    }
    if (index === newPosition) {
      return {
        ...list,
        messages: [],
      }
    }
    return list
  })

  const updatedFork: MessageForkEntry = {
    ...forkEntry,
    position: newPosition,
    lists: finalLists,
  }

  return {
    messages: messages.slice(0, forkMessageIndex + 1).concat(branchMessages),
    fork: updatedFork,
  }
}

export function buildCreateForkPatch(session: Session, forkMessageId: string): Partial<Session> | null {
  return applyForkTransform(
    session,
    forkMessageId,
    () =>
      session.messageForksHash?.[forkMessageId] ?? {
        position: 0,
        lists: [
          {
            id: `fork_list_${uuidv4()}`,
            messages: [],
          },
        ],
        createdAt: Date.now(),
      },
    (messages, forkEntry) => {
      const forkMessageIndex = messages.findIndex((m) => m.id === forkMessageId)
      if (forkMessageIndex < 0) {
        return null
      }

      const backupMessages = messages.slice(forkMessageIndex + 1)
      if (backupMessages.length === 0) {
        return null
      }

      const storedListId = `fork_list_${uuidv4()}`
      const newBranchId = `fork_list_${uuidv4()}`
      const lists = forkEntry.lists.map((list, index) =>
        index === forkEntry.position
          ? {
              id: storedListId,
              messages: backupMessages,
            }
          : list
      )
      const nextPosition = lists.length
      const updatedFork: MessageForkEntry = {
        ...forkEntry,
        position: nextPosition,
        lists: [
          ...lists,
          {
            id: newBranchId,
            messages: [],
          },
        ],
      }

      return {
        messages: messages.slice(0, forkMessageIndex + 1),
        forkEntry: updatedFork,
      }
    }
  )
}

export function buildDeleteForkPatch(session: Session, forkMessageId: string): Partial<Session> | null {
  return applyForkTransform(
    session,
    forkMessageId,
    () => session.messageForksHash?.[forkMessageId] ?? null,
    (messages, forkEntry) => {
      const forkMessageIndex = messages.findIndex((m) => m.id === forkMessageId)
      if (forkMessageIndex < 0) {
        return null
      }

      const trimmedMessages = messages.slice(0, forkMessageIndex + 1)
      const remainingLists = forkEntry.lists.filter((_, index) => index !== forkEntry.position)

      if (remainingLists.length === 0) {
        return {
          messages: trimmedMessages,
          forkEntry: null,
        }
      }

      const nextPosition = Math.min(forkEntry.position, remainingLists.length - 1)
      const carryMessages = remainingLists[nextPosition]?.messages ?? []
      const updatedLists = remainingLists.map((list, index) =>
        index === nextPosition
          ? {
              ...list,
              messages: [],
            }
          : list
      )

      return {
        messages: trimmedMessages.concat(carryMessages),
        forkEntry: {
          ...forkEntry,
          position: nextPosition,
          lists: updatedLists,
        },
      }
    }
  )
}

export function buildExpandForkPatch(session: Session, forkMessageId: string): Partial<Session> | null {
  return applyForkTransform(
    session,
    forkMessageId,
    () => session.messageForksHash?.[forkMessageId] ?? null,
    (messages, forkEntry) => {
      const forkMessageIndex = messages.findIndex((m) => m.id === forkMessageId)
      if (forkMessageIndex < 0) {
        return null
      }

      const mergedMessages = forkEntry.lists.flatMap((list) => list.messages)
      if (mergedMessages.length === 0) {
        return {
          messages,
          forkEntry: null,
        }
      }
      return {
        messages: messages.concat(mergedMessages),
        forkEntry: null,
      }
    }
  )
}

type ForkTransformResult = { messages: Message[]; forkEntry: MessageForkEntry | null }
type ForkTransform = (messages: Message[], forkEntry: MessageForkEntry) => ForkTransformResult | null

function applyForkTransform(
  session: Session,
  forkMessageId: string,
  ensureForkEntry: () => MessageForkEntry | null,
  transform: ForkTransform
): Partial<Session> | null {
  const tryTransform = (messages: Message[]): ForkTransformResult | null => {
    const forkEntry = ensureForkEntry()
    if (!forkEntry) {
      return null
    }
    return transform(messages, forkEntry)
  }

  const rootResult = tryTransform(session.messages)
  if (rootResult) {
    return {
      messages: rootResult.messages,
      messageForksHash: computeNextMessageForksHash(session.messageForksHash, forkMessageId, rootResult.forkEntry),
    }
  }

  if (!session.threads?.length) {
    return null
  }

  let updatedFork: MessageForkEntry | null = null
  let changed = false
  const updatedThreads = session.threads.map((thread) => {
    if (changed) {
      return thread
    }
    const result = tryTransform(thread.messages)
    if (!result) {
      return thread
    }
    changed = true
    updatedFork = result.forkEntry
    return {
      ...thread,
      messages: result.messages,
    }
  })

  if (!changed) {
    return null
  }

  return {
    threads: updatedThreads,
    messageForksHash: computeNextMessageForksHash(session.messageForksHash, forkMessageId, updatedFork),
  }
}

function computeNextMessageForksHash(
  current: Session['messageForksHash'],
  forkMessageId: string,
  nextEntry: MessageForkEntry | null
): Session['messageForksHash'] | undefined {
  if (nextEntry) {
    return {
      ...(current ?? {}),
      [forkMessageId]: nextEntry,
    }
  }

  if (!current || !Object.hasOwn(current, forkMessageId)) {
    return current
  }

  const { [forkMessageId]: _removed, ...rest } = current
  return Object.keys(rest).length ? rest : undefined
}
