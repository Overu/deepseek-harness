/** Categorized, explicit-draft skill picker for the Insight composition. */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconSparkleRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InsightSkillInventorySnapshot } from '../shared/skill-inventory.ts'
import css from './InsightSkillPicker.module.css'

/** Client loader backed by the generated `insightSkills/list` Remote method. */
export type InsightSkillInventoryLoader = (sessionId: SessionId, signal: AbortSignal) => Promise<InsightSkillInventorySnapshot>

/** Product inventory loader injected into the native input slot. */
export interface InsightSkillPickerInjected {
  readonly loadInventory: InsightSkillInventoryLoader
}

type Props = Pick<PropsRuntime<'conversation.input.left'>, 'sessionId' | 'useInput' | 'inputActions'> & InjectFace<InsightSkillPickerInjected>
type InventoryEntry = InsightSkillInventorySnapshot['entries'][number]

const GROUPS = [
  ['platform', '平台预置'],
  ['user', '用户自定义'],
] as const

const STATUS: Readonly<Record<InsightSkillInventorySnapshot['entries'][number]['availability'], string>> = {
  callable: '',
  shadowed: '已被更高优先级版本覆盖',
  disabled: '此技能未开放给用户调用',
  invalid: '技能文件暂不可用',
  unavailable: '当前工作区未启用此技能',
  unconfirmed: '技能目录正在更新',
}

/** Identify one visible inventory row across refreshes and source changes. */
function entryKey(entry: InventoryEntry): string {
  return `${entry.origin}:${entry.name}`
}

/** Move through selectable visible rows, wrapping at either end. */
function nextSelectable(entries: readonly InventoryEntry[], current: number, direction: 1 | -1): number {
  if (entries.length === 0) return -1
  if (current < 0) {
    return direction === 1
      ? entries.findIndex(entry => entry.availability === 'callable')
      : entries.findLastIndex(entry => entry.availability === 'callable')
  }
  for (let offset = 1; offset <= entries.length; offset += 1) {
    const index = (current + direction * offset + entries.length) % entries.length
    if (entries[index]?.availability === 'callable') return index
  }
  return -1
}

/**
 * Show the three product skill locations without adding an implicit model context.
 * Each selection is a visible `/name` token in the regular DSH draft; the
 * normal composer transaction consequently preserves a draft after failure
 * and clears it only after successful submission.
 */
export function InsightSkillPicker({ sessionId, useInput, inputActions, loadInventory }: Props) {
  const [open, setOpen] = useState(false)
  const [openSession, setOpenSession] = useState<SessionId | undefined>()
  const [snapshots, setSnapshots] = useState<ReadonlyMap<SessionId, InsightSkillInventorySnapshot>>(() => new Map())
  const [failure, setFailure] = useState<{ readonly sessionId: SessionId; readonly text: string } | undefined>()
  const [loading, setLoading] = useState<SessionId | undefined>()
  const [group, setGroup] = useState<(typeof GROUPS)[number][0]>('platform')
  const [query, setQuery] = useState('')
  const [activeKey, setActiveKey] = useState<string>()
  const search = useRef<HTMLInputElement>(null)
  const options = useRef(new Map<string, HTMLLIElement>())
  const lastSession = useRef(sessionId)
  const listboxId = useId()
  const selectedSkills = useInput(input => input.selectedSkills)
  const disabled = useInput(input => input.phase !== 'plain')
  const menuOpen = open && openSession === sessionId

  useEffect(() => {
    if (lastSession.current === sessionId) return
    lastSession.current = sessionId
    setOpen(false)
    setOpenSession(undefined)
  }, [sessionId])

  useEffect(() => {
    if (!menuOpen) return
    let active = true
    let inFlight = false
    let controller: AbortController | undefined
    setFailure(undefined)
    const refresh = (): void => {
      if (inFlight) return
      inFlight = true
      controller = new AbortController()
      setLoading(sessionId)
      void loadInventory(sessionId, controller.signal).then(
        (value) => {
          if (!active || controller?.signal.aborted) return
          setFailure(undefined)
          setLoading(undefined)
          setSnapshots(current => new Map(current).set(sessionId, value))
        },
        () => {
          if (!active || controller?.signal.aborted) return
          setFailure({ sessionId, text: '无法读取技能目录，请稍后重试' })
          setLoading(undefined)
          setSnapshots((current) => {
            const previous = current.get(sessionId)
            if (previous === undefined) return current
            return new Map(current).set(sessionId, {
              complete: false,
              entries: previous.entries.map(entry => ({ ...entry, availability: 'unconfirmed' })),
            })
          })
        },
      ).finally(() => { inFlight = false })
    }
    refresh()
    const interval = window.setInterval(refresh, 2000)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      controller?.abort()
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [loadInventory, menuOpen, sessionId])

  const current = snapshots.get(sessionId)
  const entries = useMemo(() => current?.entries.filter(entry => (group === 'platform' ? entry.origin === 'platform' : entry.origin !== 'platform')
    && `${entry.name} ${entry.description} ${entry.displayName ?? ''} ${entry.shortDescription ?? ''}`.toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name)) ?? [], [current, group, query])
  const selected = new Set(selectedSkills)
  const requestedActive = activeKey === undefined ? -1 : entries.findIndex(entry => entryKey(entry) === activeKey
    && entry.availability === 'callable')
  const active = requestedActive >= 0 ? requestedActive : entries.findIndex(entry => entry.availability === 'callable')
  const activeEntry = active < 0 ? undefined : entries[active]
  const resolvedActiveKey = activeEntry === undefined ? undefined : entryKey(activeEntry)

  useEffect(() => {
    if (!disabled) return
    setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (activeKey === resolvedActiveKey) return
    setActiveKey(resolvedActiveKey)
  }, [activeKey, resolvedActiveKey])

  useEffect(() => {
    if (resolvedActiveKey === undefined) return
    const option = options.current.get(resolvedActiveKey)
    if (typeof option?.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' })
  }, [resolvedActiveKey])

  const choose = (entry: InventoryEntry | undefined): void => {
    if (entry?.availability !== 'callable' || disabled) return
    inputActions.toggleSkill(entry.name)
    search.current?.focus()
  }

  const trigger = <button type="button" className={css.trigger} disabled={disabled} aria-haspopup="dialog" aria-expanded={menuOpen}
    aria-label={selected.size > 0 ? `技能 (${String(selected.size)})` : '技能'}
    onClick={() => {
      if (menuOpen) setOpen(false)
      else {
        setOpenSession(sessionId)
        setOpen(true)
        setGroup('platform')
        setQuery('')
        setActiveKey(undefined)
      }
      setFailure(undefined)
    }}>
    <IconSparkleRegular size={14} />
    <span>{selected.size > 0 ? `已选技能 ${String(selected.size)}` : '专家技能'}</span>
    <IconChevronDownOutlineRegular size={14} className={css.chevron} />
  </button>
  return <div data-insight-skill-picker>
    <Menu open={menuOpen} anchor={trigger} onClose={() => { setOpen(false) }} side="top" align="start" portal
      className={css.anchor} listClassName={css.menu}>
      <div className={css.content} role="dialog" aria-label="选择技能">
        <input ref={search} className={css.search} role="combobox" aria-label="搜索技能" placeholder="搜索技能" aria-controls={listboxId}
          aria-expanded={menuOpen} aria-activedescendant={activeEntry === undefined ? undefined : `${listboxId}-${activeEntry.origin}-${activeEntry.name}`}
          value={query} onChange={(event) => { setQuery(event.target.value) }} autoFocus
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.nativeEvent.isComposing) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const next = nextSelectable(entries, active, event.key === 'ArrowDown' ? 1 : -1)
              setActiveKey(next < 0 || entries[next] === undefined ? undefined : entryKey(entries[next]))
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              choose(activeEntry)
            }
          }} />
        <div className={css.tabs} role="tablist" aria-label="技能来源">
          {GROUPS.map(([id, label], index) => <button key={id} type="button" role="tab" aria-selected={group === id}
            tabIndex={group === id ? 0 : -1}
            onClick={() => { setGroup(id) }}
            onKeyDown={(event) => {
              const next = event.key === 'Home' ? 0
                : event.key === 'End' ? GROUPS.length - 1
                  : event.key === 'ArrowLeft' ? (index + GROUPS.length - 1) % GROUPS.length
                    : event.key === 'ArrowRight' ? (index + 1) % GROUPS.length
                      : undefined
              if (next === undefined) return
              event.preventDefault()
              event.stopPropagation()
              const target = GROUPS[next]
              if (target === undefined) return
              setGroup(target[0])
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
            }}>{label}</button>)}
        </div>
        {failure?.sessionId === sessionId
          ? <p className={css.status} role="status">{failure.text}</p>
          : null}
        {current !== undefined && !current.complete
          ? <p className={css.status} role="status">技能目录正在更新，结果可能不完整</p>
          : null}
        <ul id={listboxId} className={css.entries} role="listbox" aria-label="可选技能"
          aria-multiselectable="true">
          {entries.map((entry, index) => <li className={css.entry} key={`${entry.origin}:${entry.name}`} role="option"
            ref={(element) => {
              const key = entryKey(entry)
              if (element === null) options.current.delete(key)
              else options.current.set(key, element)
            }}
            id={`${listboxId}-${entry.origin}-${entry.name}`} data-active={index === active ? 'true' : undefined}
            aria-selected={entry.availability === 'callable' && selected.has(entry.name)} aria-disabled={entry.availability !== 'callable'}>
            <button type="button" className={css.option} disabled={entry.availability !== 'callable' || disabled}
              aria-label={`${entry.availability === 'callable' && selected.has(entry.name) ? '✓ ' : ''}${entry.displayName ?? entry.name}`}
              onMouseDown={(event) => { event.preventDefault() }} onMouseMove={() => { setActiveKey(entryKey(entry)) }}
              onClick={() => { choose(entry) }}>
              <span className={css.title}>
                <span>{entry.displayName ?? entry.name}</span>
                {entry.availability === 'callable' && selected.has(entry.name) ? <IconCheckOutlineRegular size={14} /> : null}
              </span>
              <span className={css.description} title={entry.shortDescription ?? entry.description}>
                {entry.shortDescription ?? entry.description}
              </span>
            </button>
            {STATUS[entry.availability] === '' ? null : <span role="status">{STATUS[entry.availability]}</span>}
          </li>)}
        </ul>
        {loading === sessionId && current === undefined ? <p className={css.status} role="status">正在读取技能目录</p> : null}
        {current !== undefined && entries.length === 0 ? <p className={css.status} role="status">没有匹配的技能</p> : null}
      </div>
    </Menu>
  </div>
}
