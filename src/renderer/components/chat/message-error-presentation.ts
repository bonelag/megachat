import type { Message } from '@shared/types'

export type MessageErrorPresentation =
  | 'generic-error'
  | 'quota-exhausted'
  | 'free-quota-exhausted'
  | 'agent-mode-reward'

/**
 * Resolves a persisted client error code into a renderer-only presentation kind.
 * Presentation kinds control UI only and are not persisted or sent to the backend.
 */
export function resolveMessageErrorPresentation(msg: Message): MessageErrorPresentation {
  switch (msg.errorCode) {
    case 10004:
      return 'quota-exhausted'
    case 20039:
      return 'free-quota-exhausted'
    case 20040:
      return 'agent-mode-reward'
  }
  return 'generic-error'
}

export function isMessageReminderPresentation(presentation: MessageErrorPresentation): boolean {
  return presentation !== 'generic-error'
}
