import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'

interface HelpModalProps {
  onClose: () => void
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

export default function HelpModal({ onClose }: HelpModalProps) {
  const isMobile = useIsMobile()
  const modalRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, modalRef)

  return createPortal(
    <div
      data-no-drag-select
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" />
      <div
        ref={modalRef}
        className="relative z-10 w-full max-w-md rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 flex flex-col max-h-[85vh] custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
            操作指南
          </h3>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain mb-6 text-sm text-gray-600 dark:text-gray-300 space-y-6 custom-scrollbar pr-2">
          <section>
            <h4 className="mb-4 text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h18M3 12h18M3 17h18" />
              </svg>
              工作区切换
            </h4>
            <div className="space-y-3">
              <p>顶部提供 <strong className="text-blue-500 dark:text-blue-400 font-medium">图片</strong> 和 <strong className="text-blue-500 dark:text-blue-400 font-medium">Chat</strong> 两个模式切换。</p>
              <p><strong className="text-blue-500 dark:text-blue-400 font-medium">图片</strong> 模式用于直接提交图片生成或编辑任务；<strong className="text-blue-500 dark:text-blue-400 font-medium">Chat</strong> 模式用于多轮文本对话，并可在明确要求时触发图片生成。</p>
            </div>
          </section>

          <section>
            <h4 className="mb-4 text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2 1.586-1.586a2 2 0 012.828 0L20 14m-6-10h6a2 2 0 012 2v6a2 2 0 01-2 2h-6a2 2 0 01-2-2V6a2 2 0 012-2z" />
              </svg>
              图片工作区
            </h4>
            <div className="space-y-3">
              <p>在输入栏填写提示词后可直接提交图片任务；上传参考图后可继续使用图生图、遮罩编辑和已有的任务历史能力。</p>
              <p>Chat 中通过工具生成的图片也会同步写入这里的历史记录，并带有 <strong className="text-amber-600 dark:text-amber-400 font-medium">Chat</strong> 来源标记。</p>
            </div>
          </section>

          <section>
            <h4 className="mb-4 text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h8M8 14h5m8 0a2 2 0 01-2 2H7l-4 4V6a2 2 0 012-2h14a2 2 0 012 2v8z" />
              </svg>
              Chat 工作区
            </h4>
            <div className="space-y-3">
              <p>Chat 支持独立会话列表和多轮上下文。按 <kbd className="px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-sans">Enter</kbd> 发送，按 <kbd className="px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-sans">Shift</kbd> + <kbd className="px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-sans">Enter</kbd> 换行。</p>
              <p>默认只做文本回答。只有当你明确提出“生成图片”之类的请求时，模型才会调用内置的 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">generate_image</code> 工具。</p>
              <p>工具生成成功后，结果会同时显示在当前对话和图片历史中；如果生成失败，Chat 会保留失败说明，不会插入伪造的图片卡片。</p>
              <p>点击 <strong className="text-red-500 dark:text-red-400 font-medium">停止生成</strong> 只会中断当前文本流；如果已经进入图片生成阶段，本版不会取消底层图片任务。</p>
            </div>
          </section>

          {isMobile ? (
            <>
              <section>
                <h4 className="mb-4 text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  多选记录
                </h4>
                <div className="space-y-4">
                  <p>在历史记录卡片上<strong className="text-blue-500 dark:text-blue-400 font-medium">左右滑动</strong>即可选中或取消选中该卡片。</p>
                </div>
              </section>
              <section>
                <h4 className="mb-4 text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  批量操作
                </h4>
                <div className="space-y-4">
                  <p>选中一条或多条记录后，页面底部会出现操作栏，支持<strong className="text-yellow-500 dark:text-yellow-400 font-medium">批量收藏</strong>、<strong className="text-red-500 dark:text-red-400 font-medium">批量删除</strong>，或<strong className="text-blue-500 dark:text-blue-400 font-medium">全选当前可见记录</strong>。</p>
                </div>
              </section>
            </>
          ) : (
            <>
              <section>
                <h4 className="mb-4 text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  多选记录
                </h4>
                <div className="space-y-4">
                  <ul className="list-disc pl-4 space-y-2">
                    <li>使用鼠标在空白处<strong className="text-blue-500 dark:text-blue-400 font-medium">拖拽框选</strong>。</li>
                    <li>按住 <kbd className="px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-sans">Ctrl</kbd> 或 <kbd className="px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-sans">⌘</kbd> 并点击卡片，可添加或移除单项。</li>
                    <li>再次框选已选中的卡片会将其取消选中。</li>
                    <li>点击卡片外任意空白处可取消所有选择。</li>
                  </ul>
                </div>
              </section>
              <section>
                <h4 className="mb-4 text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  批量操作
                </h4>
                <div className="space-y-4">
                  <p>选中一条或多条记录后，页面底部会出现操作栏，支持<strong className="text-yellow-500 dark:text-yellow-400 font-medium">批量收藏</strong>、<strong className="text-red-500 dark:text-red-400 font-medium">批量删除</strong>，或<strong className="text-blue-500 dark:text-blue-400 font-medium">全选当前可见记录</strong>。</p>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
