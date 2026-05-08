import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../types'
import { createDefaultFalProfile, createDefaultOpenAIProfile } from './apiProfiles'
import { streamOpenAICompatibleChat } from './openaiCompatibleChatApi'

function createSseResponse(chunks: string[]) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    role: 'user',
    kind: 'text',
    text: '你好',
    status: 'done',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('streamOpenAICompatibleChat', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('streams text deltas and returns the completed assistant text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse([
      'event: response.output_text.delta\ndata: {"delta":"你好"}\n\n',
      'event: response.output_text.delta\ndata: {"delta":"，世界"}\n\n',
      'event: response.completed\ndata: {"response":{"id":"resp_1","output":[{"type":"message","content":[{"type":"output_text","text":"你好，世界"}]}]}}\n\n',
    ]))

    const deltas: string[] = []
    const result = await streamOpenAICompatibleChat({
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key', chatModel: 'gpt-5.5' }),
      messages: [message()],
      onTextDelta: (delta) => deltas.push(delta),
    })

    expect(deltas).toEqual(['你好', '，世界'])
    expect(result).toEqual({
      responseId: 'resp_1',
      assistantText: '你好，世界',
      toolCalls: [],
    })
  })

  it('parses generate_image tool calls from the completed response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse([
      'event: response.completed\ndata: {"response":{"id":"resp_2","output":[{"type":"function_call","name":"generate_image","arguments":"{\\"prompt\\":\\"cinematic cat\\",\\"n\\":2}"}]}}\n\n',
    ]))

    const result = await streamOpenAICompatibleChat({
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key', chatModel: 'gpt-5.5' }),
      messages: [message()],
    })

    expect(result.responseId).toBe('resp_2')
    expect(result.toolCalls).toEqual([{
      name: 'generate_image',
      argumentsText: '{"prompt":"cinematic cat","n":2}',
      arguments: {
        prompt: 'cinematic cat',
        n: 2,
      },
    }])
  })

  it('serializes assistant history as output_text and user history as input_text', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse([
      'event: response.completed\ndata: {"response":{"id":"resp_3","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}}\n\n',
    ]))

    await streamOpenAICompatibleChat({
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key', chatModel: 'gpt-5.5' }),
      messages: [
        message({ role: 'user', text: '你好' }),
        message({ id: 'message-2', role: 'assistant', text: '你好！有什么我可以帮你的吗？' }),
        message({ id: 'message-3', role: 'user', text: '你是什么模型' }),
      ],
    })

    const request = fetchSpy.mock.calls[0]?.[1]
    const body = typeof request?.body === 'string' ? JSON.parse(request.body) : null

    expect(body?.input).toEqual([
      {
        role: 'user',
        content: [{ type: 'input_text', text: '你好' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: '你好！有什么我可以帮你的吗？' }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: '你是什么模型' }],
      },
    ])
  })

  it('throws the error message from a failed responses stream', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSseResponse([
      'event: response.failed\ndata: {"error":{"message":"rate limited"}}\n\n',
    ]))

    await expect(streamOpenAICompatibleChat({
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key', chatModel: 'gpt-5.5' }),
      messages: [message()],
    })).rejects.toThrow('rate limited')
  })

  it('rejects non-openai profiles', async () => {
    await expect(streamOpenAICompatibleChat({
      profile: createDefaultFalProfile({ apiKey: 'fal-key' }),
      messages: [message()],
    })).rejects.toThrow('当前 API 配置不支持 Chat')
  })
})
