import platform from '@/platform'
import { ApiError, BaseError, NetworkError } from '../../shared/models/errors'
import { isLocalHost } from '../../shared/utils/network_utils'
import { handleMobileRequest } from './mobile-request'

interface RequestOptions {
  method: string
  headers?: RequestInit['headers']
  body?: RequestInit['body']
  signal?: AbortSignal
  retry?: number
  useProxy?: boolean
}

async function retryRequest<T>(fn: () => Promise<T>, retry: number, url: string): Promise<T> {
  let requestError: BaseError | null = null

  for (let i = 0; i <= retry; i++) {
    try {
      return await fn()
    } catch (e) {
      // 对 ApiError（通常代表 4xx/业务错误）不重试
      if (e instanceof ApiError) {
        throw e
      }
      let origin = 'unknown'
      try {
        origin = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost').origin
      } catch {}
      requestError = e instanceof BaseError ? e : new NetworkError((e as Error).message, origin)

      if (i < retry) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  }

  throw requestError || new Error('Unknown error')
}

/** Normalize HeadersInit to a plain object (preserves User-Agent; browser Headers may drop it). */
export function headersToRecord(headers?: RequestInit['headers']): Record<string, string> {
  const result: Record<string, string> = {}
  if (!headers) return result

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = value
    })
  } else if (Array.isArray(headers)) {
    for (const [key, val] of headers) {
      result[key] = val
    }
  } else {
    for (const [key, val] of Object.entries(headers)) {
      if (val !== undefined && val !== null) {
        result[key] = String(val)
      }
    }
  }
  return result
}

function getHeaderIgnoreCase(record: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === lower) return value
  }
  return undefined
}

function setHeaderIgnoreCase(record: Record<string, string>, name: string, value: string) {
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      delete record[key]
    }
  }
  record[name] = value
}

function hasCustomUserAgent(record: Record<string, string>): boolean {
  return Boolean(getHeaderIgnoreCase(record, 'User-Agent'))
}

function buildHeaderRecord(options: RequestOptions, url: string): Record<string, string> {
  const headers = headersToRecord(options.headers)

  if (!getHeaderIgnoreCase(headers, 'Content-Type')) {
    setHeaderIgnoreCase(headers, 'Content-Type', 'application/json')
  }

  if (options.useProxy && !isLocalHost(url) && platform.type !== 'mobile') {
    setHeaderIgnoreCase(headers, 'CHATBOX-TARGET-URI', url)
    setHeaderIgnoreCase(headers, 'CHATBOX-PLATFORM', platform.type)
  }

  return headers
}

/**
 * Direct browser/Electron fetch. Do NOT rewrite URLs to a Vite proxy — that path
 * broke local API traffic when the middleware was missing or mis-ordered.
 *
 * User-Agent:
 * - Web: browsers forbid setting User-Agent (no-op); request still goes to the real API.
 * - Desktop Electron: session.webRequest.onBeforeSendHeaders applies custom UA.
 * - Mobile: CapacitorHttp/native stream can set User-Agent.
 */
async function doRequest(url: string, options: RequestOptions): Promise<Response> {
  const { signal, retry = 3, useProxy = false, body, method } = options
  let requestUrl = url
  const headers = buildHeaderRecord(options, url)
  const needsNativeUserAgent = hasCustomUserAgent(headers)

  if (useProxy && !isLocalHost(url) && platform.type !== 'mobile') {
    const version = await platform.getVersion()
    setHeaderIgnoreCase(headers, 'CHATBOX-VERSION', version || 'unknown')
    requestUrl = 'https://cors-proxy.chatboxai.app/proxy-api/completions'
  }

  const makeRequest = async () => {
    // Mobile: native HTTP can set User-Agent (browser Headers drops it).
    if (platform.type === 'mobile' && (useProxy || needsNativeUserAgent)) {
      return handleMobileRequest(requestUrl, method, headers, body, signal)
    }

    const fetchHeaders = new Headers()
    for (const [key, value] of Object.entries(headers)) {
      // Forbidden request header in browsers — skip to avoid confusion; real UA
      // is applied on desktop via Electron and on mobile via CapacitorHttp.
      if (key.toLowerCase() === 'user-agent') {
        continue
      }
      fetchHeaders.set(key, value)
    }

    const res = await fetch(requestUrl, { method, headers: fetchHeaders, body, signal })
    if (!res.ok) {
      const err = await res.text().catch(() => null)
      throw new ApiError(`Status Code ${res.status}`, err ?? undefined)
    }
    return res
  }

  return retryRequest(makeRequest, retry, requestUrl)
}

export const apiRequest = {
  async post(
    url: string,
    headers: Record<string, string>,
    body: RequestInit['body'],
    options?: Partial<RequestOptions>
  ) {
    return doRequest(url, { ...options, method: 'POST', headers, body })
  },

  async get(url: string, headers: Record<string, string>, options?: Partial<RequestOptions>) {
    return doRequest(url, { ...options, method: 'GET', headers })
  },
}

export async function fetchWithProxy(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return doRequest(input.toString(), {
    method: init?.method || 'GET',
    headers: init?.headers,
    body: init?.body,
    signal: init?.signal || undefined,
    useProxy: true,
  })
}
