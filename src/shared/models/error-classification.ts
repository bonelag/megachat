import { APICallError, TypeValidationError } from 'ai'
import {
  AIProviderNoImplementedPaintError,
  ApiError,
  BaseError,
  ChatboxAIAPIError,
  NetworkError,
  OCRError,
} from './errors'

/**
 * Errors produced by providers, user configuration, cancellation, or supported
 * fallbacks are user-facing outcomes rather than product defects.
 */
export function isExpectedGenerationError(error: unknown): boolean {
  return (
    error instanceof ApiError ||
    error instanceof NetworkError ||
    error instanceof ChatboxAIAPIError ||
    error instanceof AIProviderNoImplementedPaintError ||
    APICallError.isInstance(error) ||
    (error instanceof OCRError && error.cause instanceof BaseError)
  )
}

/**
 * Some OpenAI-compatible gateways emit a `data: null` frame mid-stream (or as a
 * trailer). The AI SDK validates every frame against a chunk schema whose union
 * branches all expect an object, so a null frame surfaces as
 * `AI_TypeValidationError: Type validation failed: Value: null` even though the
 * answer itself streamed successfully.
 *
 * Matching on the message is required because the error is re-wrapped as an
 * ApiError (`Error from <provider>: AI_TypeValidationError: ...`) before it
 * reaches the UI, which drops the structured `value` field.
 */
const NULL_CHUNK_VALIDATION_MESSAGE = /Type validation failed: Value: null\b/

export function isNullStreamChunkError(error: unknown, depth = 0): boolean {
  if (depth > 5) return false
  if (TypeValidationError.isInstance(error)) {
    return error.value === null
  }
  if (typeof error === 'string') {
    return NULL_CHUNK_VALIDATION_MESSAGE.test(error)
  }
  if (error instanceof Error) {
    if (NULL_CHUNK_VALIDATION_MESSAGE.test(error.message)) return true
    const cause = (error as { cause?: unknown }).cause
    return cause !== undefined && cause !== error ? isNullStreamChunkError(cause, depth + 1) : false
  }
  return false
}

