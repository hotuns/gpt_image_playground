import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type ChatMessage } from './types'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from './lib/apiProfiles'

const { streamOpenAICompatibleChat, callImageApi } = vi.hoisted(() => ({
  streamOpenAICompatibleChat: vi.fn(),
  callImageApi: vi.fn(),
}))

vi.mock('./lib/openaiCompatibleChatApi', () => ({
  streamOpenAICompatibleChat,
}))

vi.mock('./lib/api', () => ({
  callImageApi,
}))

vi.mock('./lib/db', () => ({
  CURRENT_THUMBNAIL_VERSION: 2,
  deleteChatMessage: vi.fn().mockResolvedValue(undefined),
  deleteChatSession: vi.fn().mockResolvedValue(undefined),
  getAllTasks: vi.fn().mockResolvedValue([]),
  getAllChatMessages: vi.fn().mockResolvedValue([]),
  getAllChatSessions: vi.fn().mockResolvedValue([]),
  putTask: vi.fn().mockResolvedValue(undefined),
  putChatMessage: vi.fn().mockResolvedValue(undefined),
  putChatSession: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  clearChatMessages: vi.fn().mockResolvedValue(undefined),
  clearChatSessions: vi.fn().mockResolvedValue(undefined),
  clearTasks: vi.fn().mockResolvedValue(undefined),
  getImage: vi.fn().mockResolvedValue(undefined),
  getImageThumbnail: vi.fn().mockResolvedValue(undefined),
  getStoredFreshImageThumbnail: vi.fn().mockResolvedValue(undefined),
  getAllImageIds: vi.fn().mockResolvedValue([]),
  getAllImages: vi.fn().mockResolvedValue([]),
  putImage: vi.fn().mockResolvedValue(undefined),
  putImageThumbnail: vi.fn().mockResolvedValue(undefined),
  deleteImage: vi.fn().mockResolvedValue(undefined),
  clearImages: vi.fn().mockResolvedValue(undefined),
  storeImage: vi.fn().mockResolvedValue('stored-image'),
}))

import { stopChatResponse, submitChatPrompt, useStore } from './store'

async function waitForAssertion(assertion: () => void, attempts = 50) {
  let lastError: unknown
  for (let index = 0; index < attempts; index += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Assertion timed out')
}

function assistantMessages() {
  return useStore.getState().chatMessages.filter((message) => message.role === 'assistant')
}

function toolMessages() {
  return useStore.getState().chatMessages.filter((message) => message.role === 'tool')
}

describe('chat store actions', () => {
  beforeEach(() => {
    streamOpenAICompatibleChat.mockReset()
    callImageApi.mockReset()

    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [createDefaultOpenAIProfile({ apiKey: 'test-key', chatModel: 'gpt-5.5' })],
        activeProfileId: DEFAULT_SETTINGS.activeProfileId,
      }),
      params: { ...DEFAULT_PARAMS },
      prompt: '',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: null,
      reusedTaskApiProfileMissing: false,
      tasks: [],
      chatSessions: [],
      chatMessages: [],
      activeChatSessionId: null,
      detailTaskId: null,
      lightboxImageId: null,
      lightboxImageList: [],
      showSettings: false,
      toast: null,
      confirmDialog: null,
      dismissedCodexCliPrompts: [],
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('creates a new session and stores the assistant reply for a text-only turn', async () => {
    streamOpenAICompatibleChat.mockResolvedValue({
      responseId: 'resp_1',
      assistantText: '你好，这是一条完成的回复。',
      toolCalls: [],
    })

    const submitted = await submitChatPrompt('请简单介绍一下这个工具')

    expect(submitted).toBe(true)

    await waitForAssertion(() => {
      const state = useStore.getState()
      expect(state.chatSessions).toHaveLength(1)
      expect(state.activeChatSessionId).toBe(state.chatSessions[0].id)
      expect(state.chatSessions[0].title).toBe('请简单介绍一下这个工具')
      expect(state.chatSessions[0].status).toBe('idle')
      expect(state.chatMessages).toHaveLength(2)
      expect(state.chatMessages[0]).toMatchObject({
        role: 'user',
        kind: 'text',
        text: '请简单介绍一下这个工具',
        status: 'done',
      })
      expect(assistantMessages()[0]).toMatchObject({
        role: 'assistant',
        kind: 'text',
        text: '你好，这是一条完成的回复。',
        status: 'done',
        responseId: 'resp_1',
      })
    })
  })

  it('marks the streaming assistant message as stopped after a manual abort', async () => {
    streamOpenAICompatibleChat.mockImplementation(({ signal }: { signal?: AbortSignal }) =>
      new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
    )

    const submitted = await submitChatPrompt('开始生成，然后我会停止')

    expect(submitted).toBe(true)

    await waitForAssertion(() => {
      expect(useStore.getState().chatSessions[0]?.status).toBe('streaming')
      expect(assistantMessages()[0]?.status).toBe('streaming')
    })

    stopChatResponse(useStore.getState().activeChatSessionId ?? undefined)

    await waitForAssertion(() => {
      expect(useStore.getState().chatSessions[0]?.status).toBe('idle')
      expect(assistantMessages()[0]).toMatchObject({
        status: 'stopped',
        text: '已停止生成',
      })
    })
  })

  it('records a failed generate_image tool result as a tool text message and links the image task history', async () => {
    streamOpenAICompatibleChat
      .mockResolvedValueOnce({
        responseId: 'resp_tool',
        assistantText: '',
        toolCalls: [{
          name: 'generate_image',
          argumentsText: '{"prompt":"cinematic cat"}',
          arguments: { prompt: 'cinematic cat' },
        }],
      })
      .mockResolvedValueOnce({
        responseId: 'resp_final',
        assistantText: '图片生成失败了，你可以稍后重试。',
        toolCalls: [],
      })
    callImageApi.mockRejectedValue(new Error('image backend down'))

    const submitted = await submitChatPrompt('帮我生成一只电影感的猫')

    expect(submitted).toBe(true)

    await waitForAssertion(() => {
      const state = useStore.getState()
      expect(state.tasks).toHaveLength(1)
      expect(state.tasks[0]).toMatchObject({
        prompt: 'cinematic cat',
        origin: 'chat-tool',
        chatSessionId: state.chatSessions[0].id,
        status: 'error',
        error: 'image backend down',
      })

      expect(state.chatMessages.some((message) =>
        message.kind === 'tool_call' &&
        message.role === 'assistant' &&
        message.toolName === 'generate_image',
      )).toBe(true)

      expect(toolMessages()[0]).toMatchObject({
        role: 'tool',
        kind: 'text',
        status: 'error',
        toolName: 'generate_image',
        relatedTaskId: state.tasks[0].id,
      })
      expect(toolMessages()[0]?.text).toContain('image backend down')

      const assistantList = assistantMessages()
      const lastAssistant = assistantList[assistantList.length - 1] as ChatMessage | undefined
      expect(lastAssistant).toMatchObject({
        role: 'assistant',
        status: 'done',
        text: '图片生成失败了，你可以稍后重试。',
        responseId: 'resp_final',
      })
      expect(state.chatSessions[0]?.status).toBe('idle')
    })
  })
})
