import { describe, expect, it } from 'vitest'
import {
  getAcceptedImageBackgroundTaskResult,
  hasAcceptedCallbackBackgroundTask,
  hasAcceptedCallbackBackgroundTaskResult,
} from './background-task-result'

const acceptedResult = {
  ok: true,
  command: 'image generate',
  accepted: true,
  background: true,
  recordId: 'record-1',
  status: 'pending',
  startedAt: 1_000,
  wait: {
    mode: 'callback',
    managedBy: 'chatbox',
    modelShouldPoll: false,
    pollIntervalMs: 2_000,
  },
}

describe('Chatbox CLI background task results', () => {
  it('recognizes callback-driven image generation results', () => {
    expect(getAcceptedImageBackgroundTaskResult(acceptedResult)).toEqual(acceptedResult)
  })

  it('does not treat pollable or unrelated results as callback tasks', () => {
    expect(
      getAcceptedImageBackgroundTaskResult({
        ...acceptedResult,
        wait: { ...acceptedResult.wait, modelShouldPoll: true },
      })
    ).toBeNull()
    expect(getAcceptedImageBackgroundTaskResult({ ok: true, command: 'image status' })).toBeNull()
  })

  it('finds accepted callback tasks in completed tool steps', () => {
    expect(
      hasAcceptedCallbackBackgroundTask([
        {
          toolResults: [{ toolName: 'chatbox_cli', output: acceptedResult }],
        },
      ])
    ).toBe(true)
  })

  it('finds an accepted callback task in a resumed assistant message', () => {
    expect(
      hasAcceptedCallbackBackgroundTaskResult([
        { type: 'text' },
        { type: 'tool-call', toolName: 'chatbox_cli', result: acceptedResult },
      ])
    ).toBe(true)
  })
})
