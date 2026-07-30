import { describe, expect, it } from 'vitest'
import { TypeValidationError } from 'ai'
import { isExpectedGenerationError, isNullStreamChunkError } from './error-classification'
import {
  AIProviderNoImplementedPaintError,
  ApiError,
  BaseError,
  ChatboxAIAPIError,
  NetworkError,
  OCRError,
} from './errors'

describe('isExpectedGenerationError', () => {
  it('recognizes provider and user-facing failures', () => {
    expect(isExpectedGenerationError(new ApiError('rate limited'))).toBe(true)
    expect(isExpectedGenerationError(new NetworkError('offline', 'https://example.com'))).toBe(true)
    expect(isExpectedGenerationError(ChatboxAIAPIError.fromCodeName('quota', 'token_quota_exhausted'))).toBe(true)
    expect(isExpectedGenerationError(new AIProviderNoImplementedPaintError('openai'))).toBe(true)
    expect(isExpectedGenerationError(new OCRError('builtin', new BaseError('bad image')))).toBe(true)
  })

  it('keeps unexpected runtime failures reportable', () => {
    expect(isExpectedGenerationError(new Error('boom'))).toBe(false)
    expect(isExpectedGenerationError(new OCRError('builtin', new Error('bad image')))).toBe(false)
    expect(isExpectedGenerationError('string error')).toBe(false)
  })
})

describe('isNullStreamChunkError', () => {
  it('matches a direct TypeValidationError with null value', () => {
    const err = new TypeValidationError({ value: null, cause: 'null is not valid' })
    expect(isNullStreamChunkError(err)).toBe(true)
  })

  it('matches when the error message contains the null validation pattern', () => {
    const err = new ApiError('Error from Custom OpenAI: AI_TypeValidationError: Type validation failed: Value: null.')
    expect(isNullStreamChunkError(err)).toBe(true)
  })

  it('matches via cause chain', () => {
    const inner = new TypeValidationError({ value: null, cause: 'null is not valid' })
    const outer = new Error('wrapped')
    ;(outer as unknown as { cause: unknown }).cause = inner
    expect(isNullStreamChunkError(outer)).toBe(true)
  })

  it('does not match a TypeValidationError with a non-null value', () => {
    const err = new TypeValidationError({ value: { bad: 'field' }, cause: 'schema mismatch' })
    expect(isNullStreamChunkError(err)).toBe(false)
  })

  it('does not match an unrelated error', () => {
    expect(isNullStreamChunkError(new Error('network timeout'))).toBe(false)
    expect(isNullStreamChunkError(new ApiError('rate limited'))).toBe(false)
    expect(isNullStreamChunkError(null)).toBe(false)
  })
})

