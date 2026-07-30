import type { Message, Session } from '@shared/types'

const sessionMessageDataKeys = ['messages', 'threads', 'messageForksHash', 'compactionPoints'] as const

export type SessionMetadataUpdate = Omit<Session, (typeof sessionMessageDataKeys)[number]>

export function getSessionMetadataSnapshot(session: Session): SessionMetadataUpdate {
  const {
    messages: _messages,
    threads: _threads,
    messageForksHash: _messageForksHash,
    compactionPoints: _compactionPoints,
    ...metadata
  } = session
  return metadata
}

export function assertNoMessageDataUpdate(update: object): void {
  const updateRecord = update as Record<string, unknown>
  const key = sessionMessageDataKeys.find((item) => Object.prototype.hasOwnProperty.call(updateRecord, item))
  if (key) {
    throw new Error(`updateSession cannot update "${key}". Use updateSessionWithMessages for message data.`)
  }
}

export function mergeCachedGeneratingMessages(updated: Session, cached: Session | null | undefined): Session {
  if (!cached) return updated

  const mergeMessages = (updatedMessages: Message[], cachedMessages: Message[]) => {
    const cachedGeneratingMessageById = new Map(
      cachedMessages.filter((message) => message.generating).map((message) => [message.id, message])
    )
    return updatedMessages.map((message) => {
      const cachedMessage = cachedGeneratingMessageById.get(message.id)
      return cachedMessage && message.generating ? cachedMessage : message
    })
  }

  return {
    ...updated,
    messages: mergeMessages(updated.messages, cached.messages),
    threads: updated.threads?.map((thread) => {
      const cachedThread = cached.threads?.find((item) => item.id === thread.id)
      return cachedThread
        ? {
            ...thread,
            messages: mergeMessages(thread.messages, cachedThread.messages),
          }
        : thread
    }),
  }
}
