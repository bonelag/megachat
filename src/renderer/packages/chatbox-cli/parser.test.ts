import { describe, expect, it } from 'vitest'
import { parseArguments, parseChatboxCliInput, tokenizeVirtualCommand } from './parser'

describe('Chatbox virtual CLI parser', () => {
  it('tokenizes quoted command strings without invoking a shell', () => {
    expect(tokenizeVirtualCommand('chatbox image generate --prompt "a red fox" --aspect-ratio 16:9')).toEqual([
      'chatbox',
      'image',
      'generate',
      '--prompt',
      'a red fox',
      '--aspect-ratio',
      '16:9',
    ])
  })

  it('prefers structured argv and removes an optional chatbox prefix', () => {
    expect(parseChatboxCliInput({ argv: ['chatbox', 'chats', 'list', '--limit', '5'] })).toEqual({
      argv: ['chats', 'list', '--limit', '5'],
      displayCommand: 'chatbox chats list --limit 5',
    })
  })

  it('separates positional arguments and flags', () => {
    const parsed = parseArguments(['hello world', '--limit=5', '--archived'])
    expect(parsed.positionals).toEqual(['hello world'])
    expect(Object.fromEntries(parsed.flags)).toEqual({ limit: '5', archived: true })
  })
})
