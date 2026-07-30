import type { Message } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { getTrailingSkillCommand, hasPendingApprovalToolCall, insertSkillCommandText } from './skillCommand'

type ToolCallContentPart = Extract<Message['contentParts'][number], { type: 'tool-call' }>

function messageWithPart(part: ToolCallContentPart): Pick<Message, 'contentParts'> {
  return { contentParts: [part] }
}

function toolCallPart(state: ToolCallContentPart['state'], pauseReason?: ToolCallContentPart['pauseReason']) {
  return {
    type: 'tool-call',
    state,
    toolCallId: 'tool-call-1',
    toolName: 'user_exec',
    args: {},
    pauseReason,
  } satisfies ToolCallContentPart
}

describe('getTrailingSkillCommand', () => {
  it('detects a slash command at the end of input', () => {
    expect(getTrailingSkillCommand('/')).toEqual({ query: '', start: 0 })
    expect(getTrailingSkillCommand('hello /fi')).toEqual({ query: 'fi', start: 6 })
  })

  it('ignores slash commands that are no longer the active trailing token', () => {
    expect(getTrailingSkillCommand('hello /foo bar')).toBeNull()
    expect(getTrailingSkillCommand('https://example.com/')).toBeNull()
  })
})

describe('insertSkillCommandText', () => {
  it('inserts a skill command into empty or plain text input', () => {
    expect(insertSkillCommandText('', 'analysis')).toBe('/analysis ')
    expect(insertSkillCommandText('hello', 'analysis')).toBe('hello /analysis ')
  })

  it('replaces only the active trailing slash token', () => {
    expect(insertSkillCommandText('/fi', 'find-skills')).toBe('/find-skills ')
    expect(insertSkillCommandText('/analysis /fi', 'find-skills')).toBe('/analysis /find-skills ')
  })
})

describe('hasPendingApprovalToolCall', () => {
  it('returns true for paused approval tool calls', () => {
    expect(
      hasPendingApprovalToolCall([
        messageWithPart(toolCallPart('paused', { type: 'user_exec_approval', command: 'pnpm test' })),
      ])
    ).toBe(true)
    expect(
      hasPendingApprovalToolCall([
        messageWithPart(toolCallPart('paused', { type: 'file_mutation_approval', title: 'Edit file', preview: '' })),
      ])
    ).toBe(true)
    expect(
      hasPendingApprovalToolCall([
        messageWithPart(
          toolCallPart('paused', {
            type: 'app_action_approval',
            action: 'image.generate',
            title: 'Generate image',
            preview: 'A cat in watercolor',
            details: {
              type: 'image_generation',
              provider: 'chatbox-ai',
              modelId: 'gpt-image-1.5',
              prompt: 'A cat in watercolor',
              count: 1,
              billing: 'chatbox_quota',
            },
          })
        ),
      ])
    ).toBe(true)
  })

  it('returns false for non-approval pauses and completed tool calls', () => {
    expect(
      hasPendingApprovalToolCall([
        messageWithPart(toolCallPart('paused', { type: 'tool_call_limit', maxToolCalls: 20 })),
        messageWithPart(toolCallPart('result')),
      ])
    ).toBe(false)
  })
})
