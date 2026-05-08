import type { ApiProfile, ChatMessage, TaskParams } from '../types'
import { buildApiUrl, isApiProxyAvailable, readClientDevProxyConfig } from './devProxy'
import { getApiErrorMessage } from './imageApiShared'

const CHAT_SYSTEM_INSTRUCTIONS = [
  'You are a lightweight chat assistant inside an image playground application.',
  'Answer normally in plain text by default.',
  'Only call generate_image when the user explicitly asks you to create or generate an image.',
  'The generate_image tool only supports text-to-image generation.',
  'Do not ask for or assume reference images, masks, inpainting, or local file access.',
  'If a tool result is provided, use it to answer the user directly.',
].join(' ')

export interface GenerateImageToolArgs {
  prompt: string
  size?: string
  quality?: TaskParams['quality']
  output_format?: TaskParams['output_format']
  output_compression?: number | null
  moderation?: TaskParams['moderation']
  n?: number
}

export interface ChatToolCall {
  name: 'generate_image'
  argumentsText: string
  arguments: GenerateImageToolArgs
}

export interface StreamChatOptions {
  profile: ApiProfile
  messages: ChatMessage[]
  signal?: AbortSignal
  onTextDelta?: (delta: string) => void
}

export interface StreamChatResult {
  responseId?: string
  assistantText: string
  toolCalls: ChatToolCall[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createRequestHeaders(profile: ApiProfile): Record<string, string> {
  return {
    Authorization: `Bearer ${profile.apiKey}`,
    'Content-Type': 'application/json',
  }
}

function serializeToolCall(message: ChatMessage): string {
  const title = message.toolName ? `Tool call: ${message.toolName}` : 'Tool call'
  const args = message.toolArgsJson?.trim() || message.text.trim()
  return args ? `${title}\n${args}` : title
}

function serializeToolResult(message: ChatMessage): string {
  const summary = message.text.trim() || 'Tool finished without text output.'
  const name = message.toolName || 'generate_image'
  return `Tool result from ${name}:\n${summary}\nContinue assisting the user based on this result.`
}

function buildChatInput(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.status !== 'streaming')
    .map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'user',
          content: [{ type: 'input_text', text: serializeToolResult(message) }],
        }
      }

      if (message.kind === 'tool_call') {
        return {
          role: 'assistant',
          content: [{ type: 'output_text', text: serializeToolCall(message) }],
        }
      }

      return {
        role: message.role,
        content: [{
          type: message.role === 'assistant' ? 'output_text' : 'input_text',
          text: message.text,
        }],
      }
    })
}

function createGenerateImageToolDefinition() {
  return {
    type: 'function',
    name: 'generate_image',
    description: 'Generate one or more new images from a text prompt.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'The full image prompt.' },
        size: { type: 'string', description: 'Optional output size such as auto or 1024x1024.' },
        quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'] },
        output_format: { type: 'string', enum: ['png', 'jpeg', 'webp'] },
        output_compression: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        moderation: { type: 'string', enum: ['auto', 'low'] },
        n: { type: 'integer', minimum: 1, maximum: 16 },
      },
    },
  }
}

function parseEventBlock(block: string): { event?: string; data: string } | null {
  const lines = block.replace(/\r/g, '').split('\n')
  let event: string | undefined
  const dataParts: string[] = []

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataParts.push(line.slice(5).trimStart())
    }
  }

  if (!dataParts.length) return null
  return { event, data: dataParts.join('\n') }
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function getNestedString(source: unknown, path: string[]): string | undefined {
  let current = source
  for (const key of path) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return typeof current === 'string' ? current : undefined
}

function extractTextDelta(event: string | undefined, payload: unknown): string {
  const eventName = event ?? (isRecord(payload) && typeof payload.type === 'string' ? payload.type : '')
  if (!eventName.includes('output_text.delta')) return ''

  return getNestedString(payload, ['delta'])
    ?? getNestedString(payload, ['text'])
    ?? getNestedString(payload, ['item', 'delta'])
    ?? getNestedString(payload, ['item', 'text'])
    ?? ''
}

function extractErrorMessage(payload: unknown): string {
  return getNestedString(payload, ['error', 'message'])
    ?? getNestedString(payload, ['message'])
    ?? 'Chat 请求失败'
}

interface CompletedResponseOutputText {
  type?: string
  text?: string
}

interface CompletedResponseOutputItem {
  type?: string
  content?: CompletedResponseOutputText[]
  name?: string
  arguments?: string
}

interface CompletedResponsePayload {
  id?: string
  output?: CompletedResponseOutputItem[]
}

function extractCompletedPayload(event: string | undefined, payload: unknown): CompletedResponsePayload | null {
  const eventName = event ?? (isRecord(payload) && typeof payload.type === 'string' ? payload.type : '')
  if (eventName !== 'response.completed') return null
  if (!isRecord(payload)) return null
  const response = isRecord(payload.response) ? payload.response : payload
  return response as CompletedResponsePayload
}

function parseGenerateImageArguments(raw: string): GenerateImageToolArgs {
  const parsed = tryParseJson(raw)
  if (!isRecord(parsed) || typeof parsed.prompt !== 'string' || !parsed.prompt.trim()) {
    throw new Error('generate_image 参数无效：缺少 prompt')
  }

  return {
    prompt: parsed.prompt.trim(),
    size: typeof parsed.size === 'string' && parsed.size.trim() ? parsed.size.trim() : undefined,
    quality: parsed.quality === 'auto' || parsed.quality === 'low' || parsed.quality === 'medium' || parsed.quality === 'high'
      ? parsed.quality
      : undefined,
    output_format: parsed.output_format === 'png' || parsed.output_format === 'jpeg' || parsed.output_format === 'webp'
      ? parsed.output_format
      : undefined,
    output_compression: typeof parsed.output_compression === 'number'
      ? parsed.output_compression
      : parsed.output_compression === null
      ? null
      : undefined,
    moderation: parsed.moderation === 'auto' || parsed.moderation === 'low' ? parsed.moderation : undefined,
    n: typeof parsed.n === 'number' && Number.isFinite(parsed.n) ? parsed.n : undefined,
  }
}

function parseCompletedResponse(payload: CompletedResponsePayload | null, streamedText: string): StreamChatResult {
  if (!payload) {
    return {
      assistantText: streamedText,
      toolCalls: [],
    }
  }

  let assistantText = streamedText
  const toolCalls: ChatToolCall[] = []

  for (const item of payload.output ?? []) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      const text = item.content
        .filter((content) => content?.type === 'output_text' && typeof content.text === 'string')
        .map((content) => content.text ?? '')
        .join('')
      if (text && !assistantText) assistantText = text
      continue
    }

    const isFunctionCall = item.type === 'function_call' || item.type === 'function_tool_call' || item.type === 'tool_call'
    if (!isFunctionCall || item.name !== 'generate_image' || typeof item.arguments !== 'string') continue
    toolCalls.push({
      name: 'generate_image',
      argumentsText: item.arguments,
      arguments: parseGenerateImageArguments(item.arguments),
    })
  }

  return {
    responseId: payload.id,
    assistantText,
    toolCalls,
  }
}

async function readSseStream(response: Response, options: StreamChatOptions): Promise<StreamChatResult> {
  if (!response.body) throw new Error('Chat 响应没有可读流')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let streamedText = ''
  let completedPayload: CompletedResponsePayload | null = null

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
    buffer = buffer.replace(/\r\n/g, '\n')

    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const parsed = parseEventBlock(block)
      if (!parsed) {
        boundary = buffer.indexOf('\n\n')
        continue
      }
      if (parsed.data === '[DONE]') {
        boundary = buffer.indexOf('\n\n')
        continue
      }

      const payload = tryParseJson(parsed.data)
      const eventName = parsed.event ?? (isRecord(payload) && typeof payload.type === 'string' ? payload.type : undefined)
      if (eventName === 'error' || eventName === 'response.failed') {
        throw new Error(extractErrorMessage(payload))
      }

      const delta = extractTextDelta(eventName, payload)
      if (delta) {
        streamedText += delta
        options.onTextDelta?.(delta)
      }

      const completed = extractCompletedPayload(eventName, payload)
      if (completed) completedPayload = completed
      boundary = buffer.indexOf('\n\n')
    }

    if (done) break
  }

  if (buffer.trim()) {
    const parsed = parseEventBlock(buffer)
    if (parsed && parsed.data !== '[DONE]') {
      const payload = tryParseJson(parsed.data)
      const eventName = parsed.event ?? (isRecord(payload) && typeof payload.type === 'string' ? payload.type : undefined)
      if (eventName === 'error' || eventName === 'response.failed') {
        throw new Error(extractErrorMessage(payload))
      }
      const delta = extractTextDelta(eventName, payload)
      if (delta) {
        streamedText += delta
        options.onTextDelta?.(delta)
      }
      const completed = extractCompletedPayload(eventName, payload)
      if (completed) completedPayload = completed
    }
  }

  return parseCompletedResponse(completedPayload, streamedText)
}

export async function streamOpenAICompatibleChat(options: StreamChatOptions): Promise<StreamChatResult> {
  const { profile } = options
  if (profile.provider !== 'openai') {
    throw new Error('当前 API 配置不支持 Chat，请切换到 OpenAI 配置。')
  }

  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = profile.apiProxy && isApiProxyAvailable(proxyConfig)
  const response = await fetch(buildApiUrl(profile.baseUrl, 'responses', proxyConfig, useApiProxy), {
    method: 'POST',
    headers: createRequestHeaders(profile),
    cache: 'no-store',
    signal: options.signal,
    body: JSON.stringify({
      model: profile.chatModel,
      instructions: CHAT_SYSTEM_INSTRUCTIONS,
      input: buildChatInput(options.messages),
      tools: [createGenerateImageToolDefinition()],
      tool_choice: 'auto',
      stream: true,
    }),
  })

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response))
  }

  return readSseStream(response, options)
}
