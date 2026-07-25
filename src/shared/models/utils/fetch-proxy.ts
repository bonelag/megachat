import type { ModelDependencies } from '../../types/adapters'
import { sanitizeOpenAICompatibleResponse } from './openai-stream-filter'

/**
 * Creates a fetch function that uses proxy when enabled,
 * or falls back to apiRequest for mobile CORS handling.
 * Also strips non-standard billing.summary SSE events that break AI SDK validation.
 */
export function createFetchWithProxy(
  useProxy: boolean | undefined,
  dependencies: ModelDependencies,
  customHeaders?: Array<{ key: string; value: string }>,
  userAgent?: string
) {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method || 'GET'

    // Normalize and merge headers
    const mergedHeaders: Record<string, string> = {}
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((val, key) => {
          mergedHeaders[key] = val
        })
      } else if (Array.isArray(init.headers)) {
        for (const [key, val] of init.headers) {
          mergedHeaders[key] = val
        }
      } else {
        Object.assign(mergedHeaders, init.headers)
      }
    }

    if (customHeaders) {
      for (const h of customHeaders) {
        if (h.key && h.value) {
          mergedHeaders[h.key] = h.value
        }
      }
    }

    if (userAgent) {
      mergedHeaders['User-Agent'] = userAgent
    }

    if (method === 'POST') {
      // POST to AI providers may be billable; a transient network error can occur
      // after the server already processed the request. Retrying would double-charge.
      const response = await dependencies.request.apiRequest({
        url: url.toString(),
        method: 'POST',
        headers: mergedHeaders,
        body: init?.body,
        signal: init?.signal || undefined,
        useProxy,
        retry: 0,
      })
      // Pass request body so stream:true is never fully buffered (TTFT regression).
      return sanitizeOpenAICompatibleResponse(response, { requestBody: init?.body })
    }

    const response = await dependencies.request.apiRequest({
      url: url.toString(),
      method: 'GET',
      headers: mergedHeaders,
      signal: init?.signal || undefined,
      useProxy,
    })
    return response
  }
}
