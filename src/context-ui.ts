import type {ContextCard, ContextData} from './context-types'
import {escapeHtml as esc} from './profile'

const timeZone = 'Australia/Sydney'
const canberraDay = new Intl.DateTimeFormat('en-AU', {timeZone, dateStyle: 'short'})
const localTimestamp = new Intl.DateTimeFormat('en-AU', {timeZone, dateStyle: 'medium', timeStyle: 'short'})
const calendarDate = new Intl.DateTimeFormat('en-AU', {timeZone: 'UTC', dateStyle: 'medium'})
const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
const statusLabels = {available: 'Available', unavailable: 'Unavailable', stale: 'Stale'}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && (isDateOnly(value) || isoTimestamp.test(value)) && Number.isFinite(Date.parse(value))
}

function isCard(value: unknown): value is ContextCard {
  if (!value || typeof value !== 'object') return false
  const card = value as Record<keyof ContextCard, unknown>
  return [card.id, card.title, card.summary, card.sourceName, card.sourceUrl, card.coverage]
    .every(field => typeof field === 'string' && field.trim().length > 0)
    && (card.status === 'available' || card.status === 'unavailable' || card.status === 'stale')
    && (card.observedAt === null || isTimestamp(card.observedAt))
    && (card.expiresAt === undefined || typeof card.expiresAt === 'string')
    && (card.action === undefined || typeof card.action === 'string')
    && (card.href === undefined || typeof card.href === 'string')
}

function isContextData(value: unknown): value is ContextData {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<ContextData>
  return isTimestamp(data.asOf) && Array.isArray(data.persistent) && data.persistent.every(isCard)
    && Array.isArray(data.today) && data.today.every(isCard)
}

function sourceLink(label: string, url: string, className: string) {
  if (!/^https?:\/\//i.test(url)) return esc(label)
  return `<a class="${className}" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`
}

function displayTime(value: string) {
  const label = isDateOnly(value) ? calendarDate.format(new Date(value)) : localTimestamp.format(new Date(value)) + ' Canberra time'
  return `<time datetime="${esc(value)}">${esc(label)}</time>`
}

function displayStatus(card: ContextCard, current: boolean, now: Date): ContextCard['status'] {
  if (!current || card.status !== 'available') return card.status
  if (!card.observedAt) return 'unavailable'
  const observed = new Date(card.observedAt)
  if (!isDateOnly(card.observedAt) && observed > now) return 'unavailable'
  if (card.expiresAt !== undefined) {
    return isoTimestamp.test(card.expiresAt) && Date.parse(card.expiresAt) > +now ? 'available' : 'stale'
  }
  return canberraDay.format(observed) === canberraDay.format(now) ? 'available' : 'stale'
}

function renderCard(card: ContextCard, current: boolean, now: Date) {
  const status = displayStatus(card, current, now)
  const summary = current && card.status === 'available' && status !== 'available'
    ? 'This observation needs a fresh check.'
    : card.summary
  const action = card.action && card.href
    ? sourceLink(card.action, card.href, 'contextAction')
    : card.action ? `<p class="contextAction">${esc(card.action)}</p>` : ''
  return `<li class="contextCard">
    <div class="contextCardHeading"><h3>${esc(card.title)}</h3><span class="contextBadge contextBadge-${status}">${statusLabels[status]}</span></div>
    <p class="contextSummary">${esc(summary)}</p>
    ${action}
    <dl class="contextMeta">
      <div><dt>Coverage</dt><dd>${esc(card.coverage)}</dd></div>
      <div><dt>Observed</dt><dd>${card.observedAt ? displayTime(card.observedAt) : 'Unavailable'}</dd></div>
      <div><dt>Source</dt><dd>${sourceLink(card.sourceName, card.sourceUrl, 'sourceLink')}</dd></div>
    </dl>
  </li>`
}

export function createContextViews() {
  const tablist = document.querySelector<HTMLElement>('#kingstonViews')!
  const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>('button'))
  const location = document.querySelector<HTMLElement>('#locationView')!
  const today = document.querySelector<HTMLElement>('#todayView')!
  const facts = document.querySelector<HTMLElement>('#locationFacts')!
  const shortcut = document.querySelector<HTMLButtonElement>('#locationFactsShortcut')!
  const sections = [facts, today]
  const messages = sections.map(section => section.querySelector<HTMLElement>('.contextStatus')!)
  const rows = sections.map(section => section.querySelector<HTMLElement>('.contextRows')!)
  let active = false
  let loading = false
  let data: ContextData | undefined
  let refreshTimer: number | undefined
  const latestMarkup = ['', '']

  function render() {
    if (!data) return
    const {asOf, persistent, today: current} = data
    const now = new Date()
    const groups = [persistent, current.filter(card => card.id !== 'events')]
    groups.forEach((cards, index) => {
      const message = cards.length ? `Context snapshot ${displayTime(asOf)}` : 'Kingston context is unavailable in this view.'
      if (messages[index].innerHTML !== message) messages[index].innerHTML = message
      const markup = cards.length
        ? `<ul class="contextList">${cards.map(card => renderCard(card, index === 1, now)).join('')}</ul>`
        : ''
      if (latestMarkup[index] !== markup) {
        rows[index].innerHTML = markup
        latestMarkup[index] = markup
      }
    })
  }

  function select(index: number) {
    tabs.forEach((tab, position) => {
      tab.setAttribute('aria-selected', String(position === index))
      tab.tabIndex = position === index ? 0 : -1
    })
    location.hidden = index !== 0
    today.hidden = index !== 1
    window.clearInterval(refreshTimer)
    if (index === 1) {
      render()
      refreshTimer = window.setInterval(render, 60_000)
    }
  }

  async function load() {
    if (loading) return
    loading = true
    messages.forEach(message => { message.textContent = 'Loading Kingston context…' })
    rows.forEach(row => row.replaceChildren())
    try {
      const response = await fetch('/context/kingston.json', {cache: 'no-store', signal: AbortSignal.timeout(5000)})
      if (!response.ok) throw new Error('Context request failed')
      const candidate: unknown = await response.json()
      if (!isContextData(candidate)) throw new Error('Context data is invalid')
      data = candidate
      render()
    } catch {
      messages.forEach(message => { message.textContent = 'Kingston context is currently unavailable.' })
      rows.forEach(row => {
        const retry = document.createElement('button')
        retry.type = 'button'
        retry.className = 'retry contextRetry'
        retry.textContent = 'Retry Kingston context'
        retry.onclick = () => {
          const panel = row.closest<HTMLElement>('.contextSection')!
          panel.focus()
          void load()
        }
        row.append(retry)
      })
    } finally {
      loading = false
    }
  }

  tabs.forEach((tab, index) => {
    tab.onclick = () => select(index)
    tab.onkeydown = event => {
      let next: number
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowRight':
          next = 1 - index
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = 1
          break
        default:
          return
      }
      event.preventDefault()
      select(next)
      tabs[next].focus()
    }
  })
  shortcut.onclick = () => {
    facts.scrollIntoView({block: 'start'})
    facts.focus({preventScroll: true})
  }
  document.addEventListener('visibilitychange', () => {
    if (active && !today.hidden && !document.hidden) render()
  })

  return {
    setKingston(selected: boolean) {
      if (active === selected) return
      active = selected
      tablist.hidden = facts.hidden = shortcut.hidden = !active
      if (active) {
        location.setAttribute('role', 'tabpanel')
        location.setAttribute('aria-labelledby', 'locationTab')
        if (!data) void load()
      } else {
        location.removeAttribute('role')
        location.removeAttribute('aria-labelledby')
        select(0)
      }
    }
  }
}
