import { getMessageText, isEmptyMessage } from '@shared/utils/message'
import { defaultSessionsForCN, defaultSessionsForEN } from '@/packages/initial_data'
import * as chatStore from './chatStore'
import type { Message, Session, SessionThread } from '@shared/types'

export const FIRST_SUCCESSFUL_CHAT_KEY = 'chatbox:first-successful-chat:v1'

type FirstSuccessfulChatStorageValue = '0' | '1'

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const builtInTemplateSessionIds = new Set(
  [...defaultSessionsForEN, ...defaultSessionsForCN].map((session) => session.id)
)

function getBrowserLocalStorage(): BrowserStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

function readStoredValue(): { available: boolean; value: FirstSuccessfulChatStorageValue | null } {
  const localStorage = getBrowserLocalStorage()
  if (!localStorage) return { available: false, value: null }

  try {
    const value = localStorage.getItem(FIRST_SUCCESSFUL_CHAT_KEY)
    return { available: true, value: value === '0' || value === '1' ? value : null }
  } catch {
    return { available: false, value: null }
  }
}

function writeStoredValue(value: FirstSuccessfulChatStorageValue): boolean {
  const localStorage = getBrowserLocalStorage()
  if (!localStorage) return false

  try {
    localStorage.setItem(FIRST_SUCCESSFUL_CHAT_KEY, value)
    return true
  } catch {
    return false
  }
}

export function markFirstSuccessfulChatCompleted(): void {
  writeStoredValue('1')
}

export function resetFirstSuccessfulChatForDebug(): void {
  const localStorage = getBrowserLocalStorage()
  if (!localStorage) return

  try {
    localStorage.removeItem(FIRST_SUCCESSFUL_CHAT_KEY)
  } catch {
    // Ignore storage failures in debug reset paths.
  }
}

function hasMeaningfulAssistantOutput(message: Message): boolean {
  const text = getMessageText(message, true, true).trim()
  if (text.length > 0) return true

  return message.contentParts.some((part) => {
    if (part.type === 'image') return true
    if (part.type !== 'tool-call') return false
    return part.state === 'result' && part.result !== undefined
  })
}

export function isSuccessfulAssistantReply(message: Message): boolean {
  if (message.role !== 'assistant') return false
  if (message.generating) return false
  if (message.error || message.errorCode) return false
  if (message.finishReason === 'agent-mode-suggested' || message.finishReason === 'tool-call-paused') return false
  if (message.contentParts.some((part) => part.type === 'agent-mode-suggestion')) return false
  if (message.contentParts.some((part) => part.type === 'tool-call' && part.state === 'paused')) return false
  return hasMeaningfulAssistantOutput(message)
}

export function hasSuccessfulUserAssistantTurn(messages: Message[]): boolean {
  let hasPreviousUserMessage = false

  for (const message of messages) {
    if (message.role === 'user' && !isEmptyMessage(message)) {
      hasPreviousUserMessage = true
      continue
    }

    if (hasPreviousUserMessage && isSuccessfulAssistantReply(message)) {
      return true
    }
  }

  return false
}

function getSessionMessageLists(session: Session): Message[][] {
  const threadMessages = (session.threads ?? []).map((thread: SessionThread) => thread.messages)
  return [...threadMessages, session.messages]
}

export function hasSuccessfulConversation(session: Session): boolean {
  return getSessionMessageLists(session).some(hasSuccessfulUserAssistantTurn)
}

async function inferFirstSuccessfulChatCompletedFromSessions(): Promise<boolean> {
  const sessionMetas = await chatStore.listAllSessionsMeta()
  for (const meta of sessionMetas) {
    if (builtInTemplateSessionIds.has(meta.id)) continue
    if (meta.hidden) continue
    if (meta.type && meta.type !== 'chat') continue

    const session = await chatStore.getSession(meta.id)
    if (!session) continue
    if (hasSuccessfulConversation(session)) {
      return true
    }
  }

  return false
}

export async function getHasCompletedFirstSuccessfulChat(): Promise<boolean> {
  const { available, value } = readStoredValue()
  if (value === '1') return true
  if (value === '0') return false

  if (!available) {
    return true
  }

  try {
    const inferred = await inferFirstSuccessfulChatCompletedFromSessions()
    writeStoredValue(inferred ? '1' : '0')
    return inferred
  } catch (error) {
    console.warn('[firstSuccessfulChat] failed to infer first successful chat state:', error)
    return true
  }
}
