/**
 * Some OpenAI-compatible gateways append non-standard SSE events after a chat
 * stream (e.g. {"object":"billing.summary","billing":{...}}). The AI SDK validates
 * every `data:` payload as a ChatCompletionChunk and throws TypeValidationError
 * when `choices` is missing.
 *
 * Strip those vendor billing events so streaming still completes successfully.
 *
 * CRITICAL: Never buffer a streaming response with response.text() — many gateways
 * return stream:true with Content-Type application/json or missing type. Buffering
 * waits until the full completion finishes, making TTFT look extremely slow.
 */

function isBillingSummaryPayload(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return false
    }
    const obj = payload as Record<string, unknown>
    if (obj.object === 'billing.summary') return true
    if (typeof obj.object === 'string' && obj.object.startsWith('billing.')) return true
    // billing envelope without OpenAI chat fields
    if ('billing' in obj && !('choices' in obj) && !('delta' in obj) && !('error' in obj)) {
        return true
    }
    return false
}

function shouldDropSseDataLine(dataContent: string): boolean {
    const trimmed = dataContent.trim()
    if (!trimmed || trimmed === '[DONE]') {
        return false
    }
    try {
        const payload: unknown = JSON.parse(trimmed)
        // Some gateways emit `data: null` (or a null-valued frame) mid-stream or as a
        // trailer. Every branch of the AI SDK chunk schema expects an object, so a null
        // frame fails validation with `Type validation failed: Value: null` even though
        // the answer streamed fine. It carries no content — drop it.
        if (payload === null) return true
        return isBillingSummaryPayload(payload)
    } catch {
        return false
    }
}

/**
 * Filter SSE body: drop `data: {...billing.summary...}` lines (and empty event blocks
 * that only contained that data). Pass everything else through unchanged.
 */
export function filterOpenAICompatibleSseStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let buffer = ''
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

    return new ReadableStream<Uint8Array>({
        async start(controller) {
            reader = body.getReader()
            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    buffer += decoder.decode(value, { stream: true })

                    // Process complete lines; keep incomplete trailing line in buffer
                    const lines = buffer.split('\n')
                    buffer = lines.pop() ?? ''

                    const outLines: string[] = []
                    for (const line of lines) {
                        // Preserve CRLF: split on \n leaves \r on the line
                        const raw = line
                        const normalized = raw.endsWith('\r') ? raw.slice(0, -1) : raw

                        if (normalized.startsWith('data:')) {
                            // "data:" or "data: "
                            const dataContent = normalized.startsWith('data: ') ? normalized.slice(6) : normalized.slice(5)
                            if (shouldDropSseDataLine(dataContent)) {
                                continue
                            }
                        }
                        outLines.push(raw)
                    }

                    if (outLines.length > 0) {
                        controller.enqueue(encoder.encode(`${outLines.join('\n')}\n`))
                    }
                }

                // Flush remaining buffer
                if (buffer.length > 0) {
                    const normalized = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
                    if (normalized.startsWith('data:')) {
                        const dataContent = normalized.startsWith('data: ') ? normalized.slice(6) : normalized.slice(5)
                        if (!shouldDropSseDataLine(dataContent)) {
                            controller.enqueue(encoder.encode(buffer))
                        }
                    } else {
                        controller.enqueue(encoder.encode(buffer))
                    }
                }

                controller.close()
            } catch (err) {
                controller.error(err)
            } finally {
                try {
                    reader?.releaseLock()
                } catch {
                    /* ignore */
                }
            }
        },
        async cancel(reason) {
            try {
                await reader?.cancel(reason)
            } catch {
                /* ignore locked / closed streams */
            }
        },
    })
}

function looksLikeSseContentType(contentType: string): boolean {
    const ct = contentType.toLowerCase()
    return ct.includes('text/event-stream') || ct.includes('application/x-ndjson') || ct.includes('text/plain')
}

function requestBodyWantsStream(body: RequestInit['body'] | undefined): boolean {
    if (typeof body !== 'string') return false
    try {
        const parsed: unknown = JSON.parse(body)
        return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as { stream?: unknown }).stream === true)
    } catch {
        return false
    }
}

export type SanitizeOptions = {
    /** True when the outbound request asked for stream:true */
    requestWantsStream?: boolean
    requestBody?: RequestInit['body']
}

/**
 * If response is a stream (or the client requested stream:true), strip billing SSE
 * events without buffering. Only fully buffer non-stream JSON for billing-only detection.
 */
export async function sanitizeOpenAICompatibleResponse(
    response: Response,
    options?: SanitizeOptions
): Promise<Response> {
    if (!response.ok || !response.body) {
        return response
    }

    const contentType = response.headers.get('content-type') || ''
    const wantsStream =
        options?.requestWantsStream === true ||
        requestBodyWantsStream(options?.requestBody) ||
        looksLikeSseContentType(contentType)

    // Streaming path: never await response.text() — that would wait until generation ends.
    if (wantsStream) {
        const filtered = filterOpenAICompatibleSseStream(response.body)
        const headers = new Headers(response.headers)
        headers.delete('content-length')
        // Ensure AI SDK treats it as a stream even if upstream lied about content-type
        if (!contentType.includes('text/event-stream')) {
            headers.set('Content-Type', 'text/event-stream; charset=utf-8')
        }
        return new Response(filtered, {
            status: response.status,
            statusText: response.statusText,
            headers,
        })
    }

    // Non-stream JSON only: safe to buffer for billing.summary detection
    const contentTypeLower = contentType.toLowerCase()
    if (contentTypeLower.includes('application/json') || contentTypeLower.includes('text/json')) {
        const text = await response.text()
        try {
            const parsed: unknown = JSON.parse(text)
            if (isBillingSummaryPayload(parsed)) {
                return new Response(
                    JSON.stringify({
                        error: {
                            message:
                                'Provider returned a billing.summary payload instead of a chat completion. ' +
                                'The stream may have ended early, or this endpoint is not OpenAI chat-completions compatible.',
                            type: 'invalid_response',
                            code: 'billing_summary_only',
                        },
                    }),
                    {
                        status: 502,
                        headers: { 'Content-Type': 'application/json' },
                    }
                )
            }
        } catch {
            // not JSON — re-wrap original text
        }
        return new Response(text, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        })
    }

    return response
}
