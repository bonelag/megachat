/**
 * Some OpenAI-compatible gateways append non-standard SSE events after a chat
 * stream (e.g. {"object":"billing.summary","billing":{...}}). The AI SDK validates
 * every `data:` payload as a ChatCompletionChunk and throws TypeValidationError
 * when `choices` is missing.
 *
 * Strip those vendor billing events so streaming still completes successfully.
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
        return isBillingSummaryPayload(JSON.parse(trimmed))
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

    return new ReadableStream<Uint8Array>({
        async start(controller) {
            const reader = body.getReader()
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
                            const dataContent = normalized.startsWith('data: ')
                                ? normalized.slice(6)
                                : normalized.slice(5)
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
                        const dataContent = normalized.startsWith('data: ')
                            ? normalized.slice(6)
                            : normalized.slice(5)
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
                    reader.releaseLock()
                } catch {
                    /* ignore */
                }
            }
        },
        cancel(reason) {
            // Best-effort cancel of upstream
            try {
                void body.cancel(reason)
            } catch {
                /* ignore */
            }
        },
    })
}

/**
 * If response is SSE, return a cloned response whose body has billing events stripped.
 * Non-SSE responses are returned as-is (except pure billing.summary JSON → clearer error).
 */
export async function sanitizeOpenAICompatibleResponse(response: Response): Promise<Response> {
    if (!response.ok || !response.body) {
        return response
    }

    const contentType = response.headers.get('content-type') || ''
    const isEventStream = contentType.includes('text/event-stream')

    if (isEventStream) {
        const filtered = filterOpenAICompatibleSseStream(response.body)
        // Rebuild headers without content-length (body size changed)
        const headers = new Headers(response.headers)
        headers.delete('content-length')
        return new Response(filtered, {
            status: response.status,
            statusText: response.statusText,
            headers,
        })
    }

    // Non-stream JSON: if the whole body is a billing summary, surface a clear error
    // instead of AI_TypeValidationError about missing `choices`.
    const contentTypeLower = contentType.toLowerCase()
    if (contentTypeLower.includes('application/json') || contentTypeLower.includes('text/json') || !contentType) {
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
