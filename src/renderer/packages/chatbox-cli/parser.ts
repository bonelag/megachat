import type { ChatboxCliInput, ParsedArguments, ParsedChatboxCommand } from './types'

export class ChatboxCliUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatboxCliUsageError'
  }
}

export function tokenizeVirtualCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: 'single' | 'double' | null = null
  let escaping = false

  const pushCurrent = () => {
    if (current) {
      tokens.push(current)
      current = ''
    }
  }

  for (const char of command.trim()) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === '\\' && quote !== 'single') {
      escaping = true
      continue
    }
    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single'
      continue
    }
    if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double'
      continue
    }
    if (/\s/.test(char) && quote === null) {
      pushCurrent()
      continue
    }
    current += char
  }

  if (escaping) current += '\\'
  if (quote) throw new ChatboxCliUsageError('Unterminated quoted argument.')
  pushCurrent()
  return tokens
}

export function parseChatboxCliInput(input: ChatboxCliInput): ParsedChatboxCommand {
  const argv = input.argv
    ? [...input.argv]
    : typeof input.command === 'string'
      ? tokenizeVirtualCommand(input.command)
      : []
  if (argv[0]?.toLowerCase() === 'chatbox' || argv[0]?.toLowerCase() === 'chatbox_cli') {
    argv.shift()
  }
  return {
    argv,
    displayCommand: `chatbox${argv.length ? ` ${argv.join(' ')}` : ''}`,
  }
}

export function parseArguments(argv: string[]): ParsedArguments {
  const positionals: string[] = []
  const flags = new Map<string, string | true>()

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }

    const equalsIndex = arg.indexOf('=')
    if (equalsIndex > 2) {
      flags.set(arg.slice(2, equalsIndex), arg.slice(equalsIndex + 1))
      continue
    }

    const name = arg.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(name, next)
      index++
    } else {
      flags.set(name, true)
    }
  }

  return { positionals, flags }
}

export function stringFlag(parsed: ParsedArguments, name: string): string | undefined {
  const value = parsed.flags.get(name)
  return typeof value === 'string' ? value : undefined
}

export function booleanFlag(parsed: ParsedArguments, name: string): boolean {
  return parsed.flags.get(name) === true
}

export function integerFlag(
  parsed: ParsedArguments,
  name: string,
  options: { defaultValue: number; min: number; max: number }
): number {
  const value = parsed.flags.get(name)
  if (value === undefined) return options.defaultValue
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new ChatboxCliUsageError(`--${name} must be an integer.`)
  }
  const result = Number(value)
  if (result < options.min || result > options.max) {
    throw new ChatboxCliUsageError(`--${name} must be between ${options.min} and ${options.max}.`)
  }
  return result
}
