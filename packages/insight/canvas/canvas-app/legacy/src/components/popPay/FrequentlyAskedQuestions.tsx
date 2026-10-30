import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, HelpCircle } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { getMembershipFaqList, type MembershipFaqItem } from '@/api/membership'

interface FrequentlyAskedQuestionsProps {
  className?: string
  /**
   * 是否支持多项同时展开（默认 true，兼容截图中「展开一个其他仍保持关闭状态」的效果）
   */
  allowMultiple?: boolean
  /**
   * 标题区文案（默认「常见问题」+ 副标题）
   */
  title?: string
  subtitle?: string
}

/**
 * 会员购买页底部：常见问题（FAQ）手风琴
 * - 列表：sceneCode = MEMBERSHIP_PURCHASE_FAQ 的 banner 列表（每条 banner = 一条 FAQ，mainTitle = 问题标题，weight = sort_order，id = faq_id）
 * - 答案：对每条 FAQ id 并发调用 `getHomeBannerDetail(id)` 详情接口获取 content = answer（与 Banner content 取数链路完全一致）
 * - 渲染：问题区统一展示 question（不再用 content 作为问题标题）；答案区自动兼容 HTML 字符串（dangerouslySetInnerHTML + 样式隔离）或纯文本（按换行分段）
 * - React Hooks 规则：所有 hooks（useState/useEffect/useCallback/useMemo）必须在组件顶层且任何 early return 之前调用，避免 hooks 顺序改变导致整个弹窗白屏
 */
export default function FrequentlyAskedQuestions({ className, allowMultiple = true, title = '常见问题', subtitle = '答疑解惑，护航创作灵感迸发' }: FrequentlyAskedQuestionsProps) {
  const [list, setList] = useState<MembershipFaqItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string | number>>(new Set())

  /* ------------- 拉取 FAQ 数据（接口返回 MembershipFaqItem[]，数组；并发拉详情会在 Network 里看到 N 条 /banner/:id 请求） ------------- */
  useEffect(() => {
    let ignore = false
    setLoading(true)
    setError('')

    getMembershipFaqList()
      .then((data) => {
        if (ignore) return
        if (Array.isArray(data)) {
          setList(data)
        } else if (data && typeof data === 'object') {
          // 防御：接口层异常返回单条对象时，做归一化处理，避免 list 非数组扩散到 [...list] 报错
          const obj = data as MembershipFaqItem
          setList([
            {
              faq_id: obj.faq_id ?? 'fallback',
              question: obj.question ?? '',
              answer: obj.answer ?? '',
              sort_order: obj.sort_order ?? 0,
            },
          ])
        } else {
          setList([])
        }
      })
      .catch((err) => {
        console.error('[FrequentlyAskedQuestions] fetch failed:', err)
        if (!ignore) setError('常见问题加载失败')
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })

    return () => {
      ignore = true
    }
  }, [])

  /* ------------- 展开/切换（hooks 必须在 early return 之前） ------------- */
  const toggle = useCallback(
    (id: string | number) => {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) {
          next.delete(id)
          return next
        }
        // 单选模式：先清空其他
        if (!allowMultiple) {
          next.clear()
        }
        next.add(id)
        return next
      })
    },
    [allowMultiple],
  )

  /* ---------- 预处理：sortedList + 每条 answer 的 HTML/纯文本判别 ----------
   * 【hooks 规则】useMemo 必须在任何 early return 之前调用；否则上次渲染 early return 少调一个 hooks，这次又调用一次 → React 抛 hooks 顺序错误 → 整个弹窗白屏
   */
  const sortedList = useMemo(() => {
    const safeList = Array.isArray(list) ? list : []
    return [...safeList].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (b.faq_id ?? 0) - (a.faq_id ?? 0))
  }, [list])

  const htmlAnswerFlags = useMemo(() => {
    const flags = new Map<string | number, boolean>()
    for (const item of sortedList) {
      const answer = String(item.answer || '')
      flags.set(item.faq_id, /<[a-zA-Z!][^>]*>/.test(answer))
    }
    return flags
  }, [sortedList])

  const paragraphMap = useMemo(() => {
    const map = new Map<string | number, string[]>()
    for (const item of sortedList) {
      if (htmlAnswerFlags.get(item.faq_id)) continue
      const lines = String(item.answer || '')
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
      map.set(item.faq_id, lines)
    }
    return map
  }, [sortedList, htmlAnswerFlags])

  /* ------------- 加载态骨架 ------------- */
  if (loading) {
    return (
      <section className={cn('mx-auto w-full min-w-[min(1112px,100%)] max-w-full mobile:min-w-0 py-8 mobile:py-4', className)}>
        <div className='mb-5 flex flex-col items-center gap-2'>
          <Skeleton className='h-6 w-24 rounded-md bg-white/[0.10]' />
          <Skeleton className='h-4 w-52 rounded-md bg-white/[0.08]' />
        </div>
        <div className='mx-auto flex w-[min(960px,100%)] flex-col gap-3 mobile:gap-2.5'>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className='rounded-xl bg-white/[0.05] px-4 py-3.5 mobile:py-3'>
              <div className='flex items-center justify-between gap-3'>
                <Skeleton className='h-4 w-40 rounded-md bg-white/[0.10]' />
                <Skeleton className='h-4 w-4 rounded-md bg-white/[0.10]' />
              </div>
              <Skeleton className='mt-4 h-3 w-2/3 rounded-md bg-white/[0.08]' />
              <Skeleton className='mt-2 h-3 w-1/2 rounded-md bg-white/[0.08]' />
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (error) {
    // 静默失败，不影响主体：直接返回空区
    return null
  }

  if (sortedList.length === 0) {
    return null
  }

  return (
    <section className={cn('mx-auto w-full min-w-[min(1112px,100%)] max-w-full mobile:min-w-0 py-8 mobile:py-4', className)}>
      {/* 标题区 */}
      <div className='mb-5 mobile:mb-4 flex flex-col items-center gap-2 text-center'>
        <h3 className='flex items-center gap-2 text-xl mobile:text-lg font-semibold leading-snug text-white/95'>
          <HelpCircle size={18} className='text-white/70' />
          {title}
        </h3>
        <p className='text-[13px] text-white/50'>{subtitle}</p>
      </div>

      {/* FAQ 列表（每条 banner = 一条问题；答案 content 通过 getHomeBannerDetail 获取） */}
      <ul className='mx-auto flex w-[min(960px,100%)] flex-col gap-3 mobile:gap-2.5'>
        {sortedList.map((item) => {
          const expanded = expandedIds.has(item.faq_id)
          const rawAnswer = String(item.answer || '')
          const isHtmlAnswer = htmlAnswerFlags.get(item.faq_id) ?? false
          const answerParagraphs = paragraphMap.get(item.faq_id) ?? []

          return (
            <li
              key={item.faq_id}
              className={cn(
                'group rounded-xl border border-white/10 bg-white/[0.05] px-5 mobile:px-4 overflow-hidden transition-[border-color,box-shadow] duration-200 ease-out',
                expanded && 'border-white/20 bg-white/[0.07] shadow-[0_6px_22px_rgba(0,0,0,0.25)]',
              )}
            >
              {/* 触发条：问题标题 = banner.mainTitle（不再用 content 当标题） */}
              <button
                type='button'
                aria-expanded={expanded}
                onClick={() => toggle(item.faq_id)}
                className='flex w-full items-center justify-between gap-4 py-3.5 mobile:py-3 text-left focus:outline-none focus-visible:outline-none'
              >
                <span className='text-[15px] mobile:text-sm font-medium leading-snug text-white/90'>{item.question}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-full p-1 text-white/60 transition-transform duration-200 ease-out group-hover:text-white/85',
                    expanded && 'rotate-180 text-white/90',
                  )}
                  aria-hidden='true'
                >
                  <ChevronDown size={16} />
                </span>
              </button>

              {/* 答案：折叠动画（AnimatePresence + height auto；答案内容与 FAQ 组件历史写法一致：HTML/纯文本兼容渲染） */}
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div
                    key={`answer-${item.faq_id}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className='overflow-hidden'
                  >
                    <div className='pb-4 mobile:pb-3 pr-6 mobile:pr-4 text-[13px] mobile:text-[13px] leading-[1.75] text-white/70'>
                      {isHtmlAnswer ? (
                        // getHomeBannerDetail.content 可能是富文本 HTML（含 <p>/<ul>/<ol>/<a>/<img> 等）
                        <div className='faq-answer-html space-y-2 [&_a]:text-[#70E0FF] [&_a]:underline [&_a]:decoration-white/30 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_img]:rounded-md [&_img]:max-w-full [&_img]:shadow-[0_6px_18px_rgba(0,0,0,0.3)]'>
                          <div dangerouslySetInnerHTML={{ __html: rawAnswer }} />
                        </div>
                      ) : answerParagraphs.length > 0 ? (
                        answerParagraphs.map((line, idx) => (
                          <p key={idx} className={idx === 0 ? '' : 'mt-1.5'}>
                            {line}
                          </p>
                        ))
                      ) : rawAnswer ? (
                        <p className='m-0 whitespace-pre-wrap break-words'>{rawAnswer}</p>
                      ) : null}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
