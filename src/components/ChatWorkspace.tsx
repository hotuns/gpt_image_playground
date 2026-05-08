import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatMessage, ChatSession } from '../types'
import { getActiveApiProfile } from '../lib/apiProfiles'
import {
  createChatSession,
  deleteChatSession,
  ensureImageThumbnailCached,
  stopChatResponse,
  submitChatPrompt,
  subscribeImageThumbnail,
  useStore,
} from '../store'
import { CloseIcon, PlusIcon, TrashIcon } from './icons'

function renderTextSegments(text: string) {
  const blocks = text.split(/```([\w-]*)\n([\s\S]*?)```/g)
  const nodes: ReactNode[] = []

  for (let index = 0; index < blocks.length; index += 3) {
    const prose = blocks[index]
    if (prose) {
      nodes.push(
        <p key={`text-${index}`} className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-800 dark:text-gray-100">
          {prose}
        </p>,
      )
    }

    const language = blocks[index + 1]
    const code = blocks[index + 2]
    if (code == null) continue
    nodes.push(
      <div key={`code-${index}`} className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-950 dark:border-white/[0.08]">
        <div className="border-b border-white/10 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-gray-400">
          {language || 'code'}
        </div>
        <pre className="overflow-x-auto px-4 py-3 text-xs leading-6 text-gray-100">
          <code>{code}</code>
        </pre>
      </div>,
    )
  }

  return nodes.length ? nodes : [
    <p key="plain" className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-800 dark:text-gray-100">
      {text}
    </p>,
  ]
}

function MessageText({ text }: { text: string }) {
  return <div className="space-y-3">{renderTextSegments(text)}</div>
}

function SessionBadge({ session }: { session: ChatSession }) {
  if (session.status === 'streaming') {
    return <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-300">生成中</span>
  }
  if (session.status === 'tool_running') {
    return <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">图片生成中</span>
  }
  if (session.status === 'error') {
    return <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-300">异常</span>
  }
  return null
}

function ChatImageResultCard({ message }: { message: ChatMessage }) {
  const setLightboxImageId = useStore((state) => state.setLightboxImageId)
  const setDetailTaskId = useStore((state) => state.setDetailTaskId)
  const hasRelatedTask = useStore((state) => message.relatedTaskId ? state.tasks.some((task) => task.id === message.relatedTaskId) : false)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  useEffect(() => {
    let disposed = false
    const unsubscribers: Array<() => void> = []

    for (const imageId of message.relatedImageIds ?? []) {
      unsubscribers.push(subscribeImageThumbnail(imageId, (thumbnail) => {
        if (disposed) return
        setThumbs((current) => ({ ...current, [imageId]: thumbnail.dataUrl }))
      }))
      ensureImageThumbnailCached(imageId).then((thumbnail) => {
        if (disposed || !thumbnail) return
        setThumbs((current) => ({ ...current, [imageId]: thumbnail.dataUrl }))
      }).catch(() => {
        // keep placeholder
      })
    }

    return () => {
      disposed = true
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [message.relatedImageIds])

  return (
    <div className="space-y-3 rounded-2xl border border-gray-200/80 bg-white/80 p-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">图片结果</p>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{message.text}</p>
        </div>
        {message.relatedTaskId && hasRelatedTask && (
          <button
            type="button"
            onClick={() => setDetailTaskId(message.relatedTaskId ?? null)}
            className="shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.06]"
          >
            查看任务
          </button>
        )}
      </div>
      {!!message.relatedImageIds?.length && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {message.relatedImageIds.map((imageId, index) => {
            const thumb = thumbs[imageId]
            return (
              <button
                key={imageId}
                type="button"
                onClick={() => setLightboxImageId(imageId, message.relatedImageIds)}
                className="group overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 transition hover:border-gray-300 dark:border-white/[0.08] dark:bg-white/[0.04]"
              >
                {thumb ? (
                  <img src={thumb} alt="生成结果缩略图" className="aspect-square h-full w-full object-cover transition group-hover:scale-[1.02]" />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-xs text-gray-400 dark:text-gray-500">图片 {index + 1}</div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'
  const isToolCall = message.kind === 'tool_call'
  const isToolResult = message.kind === 'image_result'
  const isAssistant = message.role === 'assistant'

  if (isToolResult) {
    return (
      <div className="max-w-3xl rounded-3xl border border-amber-200/70 bg-amber-50/80 p-4 dark:border-amber-400/20 dark:bg-amber-500/10">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300">
          Tool Result
          {message.status === 'streaming' && <span className="text-[11px] normal-case tracking-normal">生成中</span>}
          {message.status === 'error' && <span className="text-[11px] normal-case tracking-normal">失败</span>}
        </div>
        <ChatImageResultCard message={message} />
      </div>
    )
  }

  const bubbleClass = isUser
    ? 'ml-auto border-blue-500/20 bg-blue-500 text-white'
    : isToolCall
    ? 'border-gray-200 bg-gray-100 text-gray-700 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-gray-200'
    : isTool
    ? 'border-amber-200/70 bg-amber-50/80 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100'
    : 'border-gray-200 bg-white text-gray-800 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100'

  return (
    <div className={`max-w-3xl rounded-3xl border px-4 py-3 shadow-sm ${bubbleClass}`}>
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-70">
        {isUser ? 'You' : isToolCall ? 'Tool Call' : isTool ? 'Tool' : 'Assistant'}
        {isAssistant && message.status === 'streaming' && <span className="normal-case tracking-normal">生成中</span>}
        {isAssistant && message.status === 'stopped' && <span className="normal-case tracking-normal">已停止</span>}
        {isAssistant && message.status === 'error' && <span className="normal-case tracking-normal">失败</span>}
        {isTool && message.status === 'error' && <span className="normal-case tracking-normal">失败</span>}
      </div>
      {message.toolArgsJson && isToolCall ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">{message.text}</p>
          <pre className="overflow-x-auto rounded-2xl bg-black/80 px-3 py-2 text-xs leading-6 text-gray-100">
            <code>{message.toolArgsJson}</code>
          </pre>
        </div>
      ) : isUser ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-white">{message.text}</p>
      ) : isToolCall ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-700 dark:text-gray-100">{message.text}</p>
      ) : isTool ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-amber-900 dark:text-amber-100">{message.text}</p>
      ) : (
        <MessageText text={message.text} />
      )}
    </div>
  )
}

export default function ChatWorkspace() {
  const settings = useStore((state) => state.settings)
  const chatSessions = useStore((state) => state.chatSessions)
  const chatMessages = useStore((state) => state.chatMessages)
  const activeChatSessionId = useStore((state) => state.activeChatSessionId)
  const setActiveChatSessionId = useStore((state) => state.setActiveChatSessionId)
  const setShowSettings = useStore((state) => state.setShowSettings)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)

  const [draft, setDraft] = useState('')
  const [showMobileSessions, setShowMobileSessions] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeProfile = useMemo(() => getActiveApiProfile(settings), [settings])
  const activeSession = useMemo(
    () => chatSessions.find((session) => session.id === activeChatSessionId) ?? chatSessions[0] ?? null,
    [chatSessions, activeChatSessionId],
  )
  const sessionMessages = useMemo(
    () => activeSession ? chatMessages.filter((message) => message.sessionId === activeSession.id).sort((a, b) => a.createdAt - b.createdAt || a.updatedAt - b.updatedAt) : [],
    [activeSession, chatMessages],
  )
  const isOpenAIProfile = activeProfile.provider === 'openai'
  const isStreaming = activeSession?.status === 'streaming'
  const isToolRunning = activeSession?.status === 'tool_running'

  useEffect(() => {
    if (!activeChatSessionId && chatSessions[0]) {
      setActiveChatSessionId(chatSessions[0].id)
    }
  }, [activeChatSessionId, chatSessions, setActiveChatSessionId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [sessionMessages.length, sessionMessages[sessionMessages.length - 1]?.updatedAt, activeSession?.status])

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${Math.min(220, element.scrollHeight)}px`
  }, [draft])

  const handleCreateSession = async () => {
    const session = await createChatSession()
    setActiveChatSessionId(session.id)
    setShowMobileSessions(false)
  }

  const confirmDeleteSession = (sessionId: string) => {
    setConfirmDialog({
      title: '删除会话',
      message: '确定要删除这段对话吗？会话消息会被删除，但已生成的图片任务会保留在图片历史中。',
      action: () => {
        void deleteChatSession(sessionId)
        setShowMobileSessions(false)
      },
    })
  }

  const handleSubmit = async () => {
    if (!draft.trim() || isStreaming || isToolRunning) return
    const text = draft
    const submitted = await submitChatPrompt(text)
    if (submitted) {
      setDraft('')
    }
  }

  const emptyState = (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-500 dark:bg-white/[0.05] dark:text-gray-300">
          <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h8M8 14h5m8 0a2 2 0 01-2 2H7l-4 4V6a2 2 0 012-2h14a2 2 0 012 2v8z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">轻量 Chat Workspace</h2>
        <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">使用 Responses API 做流式对话；当你明确要求生成图片时，模型可以调用内置的 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">generate_image</code> 工具。</p>
        <button
          type="button"
          onClick={() => void handleCreateSession()}
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
        >
          <PlusIcon className="h-4 w-4" />
          新建会话
        </button>
      </div>
    </div>
  )

  if (!isOpenAIProfile) {
    return (
      <main className="safe-area-x pb-10">
        <div className="mx-auto max-w-6xl px-0 pt-6 sm:pt-8">
          <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-gray-400">Chat Unavailable</p>
            <h2 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-gray-100">当前 Chat 仅支持 OpenAI 配置</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-500 dark:text-gray-400">当前激活的是 <span className="font-medium text-gray-700 dark:text-gray-200">{activeProfile.name}</span>。请切换到 OpenAI profile，并在设置中填写 API URL、API Key 和 Chat 模型。</p>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="mt-6 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
            >
              打开设置
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="safe-area-x pb-10">
      <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-6xl gap-4 pt-4 sm:pt-6">
        <aside className="hidden w-72 shrink-0 flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03] md:flex">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4 dark:border-white/[0.08]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Chat</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{chatSessions.length} 个会话</p>
            </div>
            <button type="button" onClick={() => void handleCreateSession()} className="rounded-2xl border border-gray-200 p-2 text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.06]">
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3 custom-scrollbar">
            {chatSessions.map((session) => {
              const selected = activeSession?.id === session.id
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setActiveChatSessionId(session.id)}
                  className={`group w-full rounded-2xl border px-3 py-3 text-left transition ${selected ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.02] dark:hover:bg-white/[0.06]'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-medium ${selected ? 'text-white dark:text-gray-900' : 'text-gray-900 dark:text-gray-100'}`}>{session.title}</p>
                      <p className={`mt-1 text-xs ${selected ? 'text-white/70 dark:text-gray-700' : 'text-gray-500 dark:text-gray-400'}`}>{new Date(session.updatedAt).toLocaleString('zh-CN')}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <SessionBadge session={session} />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          confirmDeleteSession(session.id)
                        }}
                        className={`rounded-lg p-1 opacity-0 transition group-hover:opacity-100 ${selected ? 'text-white/70 hover:bg-white/10 dark:text-gray-700 dark:hover:bg-gray-200' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-gray-200'}`}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4 dark:border-white/[0.08]">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowMobileSessions(true)}
                className="rounded-2xl border border-gray-200 p-2 text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 md:hidden dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.06]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">{activeProfile.chatModel || 'Chat'}</p>
                <h2 className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">{activeSession?.title ?? '新对话'}</h2>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activeSession && <SessionBadge session={activeSession} />}
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="rounded-2xl border border-gray-200 px-3 py-2 text-sm text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.06]"
              >
                设置
              </button>
            </div>
          </div>

          {activeSession ? (
            <>
              <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4 custom-scrollbar sm:px-6">
                {sessionMessages.length === 0 ? (
                  <div className="flex min-h-full items-center justify-center">
                    <div className="max-w-md text-center">
                      <p className="text-sm leading-7 text-gray-500 dark:text-gray-400">开始一段对话。明确提出“生成图片”的请求时，模型才会调用内置图片工具。</p>
                    </div>
                  </div>
                ) : (
                  sessionMessages.map((message) => (
                    <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <MessageBubble message={message} />
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-gray-100 px-4 py-4 dark:border-white/[0.08] sm:px-6">
                <div className="rounded-3xl border border-gray-200 bg-gray-50 p-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
                  <textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void handleSubmit()
                      }
                    }}
                    placeholder="输入消息。明确要求生成图片时，模型会调用 generate_image。"
                    className="max-h-[220px] min-h-[56px] w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Enter 发送，Shift+Enter 换行</p>
                    <div className="flex items-center gap-2">
                      {isStreaming ? (
                        <button
                          type="button"
                          onClick={() => stopChatResponse(activeSession.id)}
                          className="rounded-2xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-400/20 dark:text-red-300 dark:hover:bg-red-500/10"
                        >
                          停止生成
                        </button>
                      ) : isToolRunning ? (
                        <button
                          type="button"
                          disabled
                          className="rounded-2xl border border-amber-200 px-3 py-2 text-sm font-medium text-amber-700 opacity-70 dark:border-amber-400/20 dark:text-amber-300"
                        >
                          图片生成中
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleSubmit()}
                        disabled={!draft.trim() || isStreaming || isToolRunning}
                        className="rounded-2xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
                      >
                        发送
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            emptyState
          )}
        </section>
      </div>

      {showMobileSessions && (
        <div className="fixed inset-0 z-[75] md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMobileSessions(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[88vw] max-w-sm flex-col border-r border-gray-200 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-gray-950">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4 dark:border-white/[0.08]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">会话列表</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{chatSessions.length} 个会话</p>
              </div>
              <button type="button" onClick={() => setShowMobileSessions(false)} className="rounded-2xl border border-gray-200 p-2 text-gray-700 dark:border-white/[0.08] dark:text-gray-200">
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b border-gray-100 px-4 py-3 dark:border-white/[0.08]">
              <button type="button" onClick={() => void handleCreateSession()} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-gray-900">
                <PlusIcon className="h-4 w-4" />
                新建会话
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3 custom-scrollbar">
              {chatSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => {
                    setActiveChatSessionId(session.id)
                    setShowMobileSessions(false)
                  }}
                  className={`w-full rounded-2xl border px-3 py-3 text-left transition ${activeSession?.id === session.id ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900' : 'border-gray-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.02]'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{session.title}</p>
                      <p className={`mt-1 text-xs ${activeSession?.id === session.id ? 'text-white/70 dark:text-gray-700' : 'text-gray-500 dark:text-gray-400'}`}>{new Date(session.updatedAt).toLocaleString('zh-CN')}</p>
                    </div>
                    <SessionBadge session={session} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
