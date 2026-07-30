import type { AppActionApprovalDetails } from '@shared/types'

export interface ChatboxCliInput {
  command?: string
  argv?: string[]
}

export interface ChatboxCliToolContext {
  toolCallId?: string
  approved?: boolean
  approvalDetails?: AppActionApprovalDetails
  abortSignal?: AbortSignal
}

export interface ChatboxCliOptions {
  sessionId?: string
  onUsed?: () => void
}

export interface ParsedChatboxCommand {
  argv: string[]
  displayCommand: string
}

export interface ParsedArguments {
  positionals: string[]
  flags: Map<string, string | true>
}

export interface ChatboxCliCommandContext {
  argv: string[]
  parsed: ParsedArguments
  displayCommand: string
  sessionId?: string
  toolCallId?: string
  approved: boolean
  approvalDetails?: AppActionApprovalDetails
  abortSignal?: AbortSignal
}

export interface ChatboxCliCommandDefinition {
  path: string[]
  description: string
  usage: string
  execute: (context: ChatboxCliCommandContext) => Promise<Record<string, unknown>> | Record<string, unknown>
}
