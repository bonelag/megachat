import { describe, expect, it } from 'vitest'
import { filterOpenAICompatibleSseStream, sanitizeOpenAICompatibleResponse } from './openai-stream-filter'

async function readStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let out = ''
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        out += decoder.decode(value, { stream: true })
    }
    out += decoder.decode()
    return out
}

describe('filterOpenAICompatibleSseStream', () => {
    it('drops billing.summary data events and keeps chat chunks', async () => {
        const sse = [
            'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hi"}}]}\n',
            '\n',
            'data: {"object":"billing.summary","billing":{"source":"request"}}\n',
            '\n',
            'data: [DONE]\n',
            '\n',
        ].join('')

        const input = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(sse))
                controller.close()
            },
        })

        const filtered = filterOpenAICompatibleSseStream(input)
        const text = await readStreamText(filtered)

        expect(text).toContain('chat.completion.chunk')
        expect(text).toContain('[DONE]')
        expect(text).not.toContain('billing.summary')
    })

    it('handles split chunks across network reads', async () => {
        const part1 = 'data: {"object":"billing.summary","billing":{'
        const part2 = '"x":1}}\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n'

        const input = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(part1))
                controller.enqueue(new TextEncoder().encode(part2))
                controller.close()
            },
        })

        const filtered = filterOpenAICompatibleSseStream(input)
        const text = await readStreamText(filtered)

        expect(text).not.toContain('billing.summary')
        expect(text).toContain('"content":"ok"')
    })

    it('drops null data frames that would fail AI SDK chunk validation', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"content":"Hi"}}]}\n',
            '\n',
            'data: null\n',
            '\n',
            'data: [DONE]\n',
            '\n',
        ].join('')

        const input = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(sse))
                controller.close()
            },
        })

        const text = await readStreamText(filterOpenAICompatibleSseStream(input))

        expect(text).toContain('"content":"Hi"')
        expect(text).toContain('[DONE]')
        expect(text).not.toContain('data: null')
    })

    it('drops a trailing null frame left in the buffer', async () => {
        const input = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: null')
                )
                controller.close()
            },
        })

        const text = await readStreamText(filterOpenAICompatibleSseStream(input))

        expect(text).toContain('"content":"Hi"')
        expect(text).not.toContain('null')
    })
})

describe('sanitizeOpenAICompatibleResponse', () => {
    it('rewrites pure billing.summary JSON to a clear error', async () => {
        const body = JSON.stringify({
            object: 'billing.summary',
            billing: { source: 'request' },
        })
        const response = new Response(body, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })

        const sanitized = await sanitizeOpenAICompatibleResponse(response)
        expect(sanitized.status).toBe(502)
        const json = await sanitized.json()
        expect(json.error.code).toBe('billing_summary_only')
    })

    it('filters billing events from event-stream responses', async () => {
        const sse =
            'data: {"choices":[{"delta":{"content":"A"}}]}\n\n' +
            'data: {"object":"billing.summary","billing":{}}\n\n' +
            'data: [DONE]\n\n'

        const response = new Response(sse, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
        })

        const sanitized = await sanitizeOpenAICompatibleResponse(response)
        const text = await sanitized.text()
        expect(text).toContain('"content":"A"')
        expect(text).not.toContain('billing.summary')
    })

    it('does not buffer full body when request asked for stream:true even if content-type is application/json', async () => {
        let resolveMore!: () => void
        const more = new Promise<void>((r) => {
            resolveMore = r
        })

        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                controller.enqueue(
                    new TextEncoder().encode('data: {"choices":[{"delta":{"content":"fast"}}]}\n\n')
                )
                // Simulate long-running stream — if sanitize buffered with text(), this would block
                await more
                controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
                controller.close()
            },
        })

        const response = new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })

        const sanitized = await sanitizeOpenAICompatibleResponse(response, {
            requestBody: JSON.stringify({ stream: true, messages: [] }),
        })

        const reader = sanitized.body!.getReader()
        const first = await reader.read()
        const text = new TextDecoder().decode(first.value)
        expect(text).toContain('fast')
        // Unblock remaining stream before cancel
        resolveMore()
        // Drain rest so the producer finishes cleanly
        while (!(await reader.read()).done) {
            /* drain */
        }
    })
})
