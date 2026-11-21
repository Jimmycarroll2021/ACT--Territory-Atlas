import type {Item} from './data'
import {escapeHtml as esc} from './profile'

type SnapshotPointer = {schemaVersion: 1; snapshotId: string; zoningUrl: string; daUrl: string}
type Snapshot = {schemaVersion: 1; snapshotId: string; snapshotDate: string}
type Zone = {code: string; label: string; areaM2: number; percent: number; sliver: boolean}
type ZoneMatch = {zones: Zone[]; gapPercent: number; hasGap: boolean; hasOverlap: boolean}
type Zoning = Snapshot & {sourceUrl: string; byBlock: Record<string, ZoneMatch>}
type Application = {
  number: string
  status: 'active' | 'completed'
  decision: string | null
  lodgementDate: string | null
  decisionDate: string | null
  types: string[]
  subclasses: string[]
}
type Applications = Snapshot & {
  completedSince: string
  radiusM: 500
  sourceUrls: {active: string; completed: string}
  applications: Record<string, Application>
  byBlock: Record<string, {onBlock: string[]; nearby: {number: string; distanceM: number}[]}>
}

const pointerUrl = '/planning/current.json'
let pointer: SnapshotPointer | undefined
let zoning: Zoning | undefined
let applications: Applications | undefined
let pending: Promise<void> | undefined
let attempted = false

const formatDate = new Intl.DateTimeFormat('en-AU', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'})
const localDate = new Intl.DateTimeFormat('en-AU', {day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Australia/Sydney'})
const formatNumber = new Intl.NumberFormat('en-AU', {maximumFractionDigits: 2})

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(value)
}

function secureUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

function snapshotUrl(value: unknown, id: string, filename: string): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value, new URL(pointerUrl, location.origin))
    return url.href === `${location.origin}/planning/snapshots/${id}/${filename}`
  } catch { return false }
}

async function json(url: string, cache?: RequestCache): Promise<unknown> {
  const response = await fetch(url, {cache, signal: AbortSignal.timeout(10000)})
  if (!response.ok) throw new Error('Planning snapshot unavailable')
  return response.json()
}

async function readPointer(): Promise<SnapshotPointer> {
  const raw = await json(pointerUrl, 'no-cache')
  if (!record(raw) || raw.schemaVersion !== 1 || typeof raw.snapshotId !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]*$/i.test(raw.snapshotId) ||
      !snapshotUrl(raw.zoningUrl, raw.snapshotId, 'zoning.json') || !snapshotUrl(raw.daUrl, raw.snapshotId, 'da.json')) {
    throw new Error('Invalid planning snapshot pointer')
  }
  return raw as SnapshotPointer
}

function isSnapshot(raw: unknown, snapshotId: string): raw is Snapshot & Record<string, unknown> {
  return record(raw) && raw.schemaVersion === 1 && raw.snapshotId === snapshotId && date(raw.snapshotDate)
}

async function readZoning(snapshot: SnapshotPointer): Promise<Zoning> {
  const raw = await json(new URL(snapshot.zoningUrl, new URL(pointerUrl, location.origin)).href)
  if (!isSnapshot(raw, snapshot.snapshotId) || !secureUrl(raw.sourceUrl) || !record(raw.byBlock)) {
    throw new Error('Invalid zoning snapshot')
  }
  return raw as Zoning
}

async function readApplications(snapshot: SnapshotPointer): Promise<Applications> {
  const raw = await json(new URL(snapshot.daUrl, new URL(pointerUrl, location.origin)).href)
  if (!isSnapshot(raw, snapshot.snapshotId) || !date(raw.completedSince) || raw.radiusM !== 500 ||
      !record(raw.sourceUrls) || !secureUrl(raw.sourceUrls.active) || !secureUrl(raw.sourceUrls.completed) ||
      !record(raw.byBlock) || !record(raw.applications)) {
    throw new Error('Invalid applications snapshot')
  }
  return raw as Applications
}

function loadPlanning(): Promise<void> | undefined {
  if (zoning && applications) return
  if (pending) return pending
  attempted = true
  pending = (async () => {
    pointer ??= await readPointer()
    const [zoneResult, applicationResult] = await Promise.allSettled([
      zoning ?? readZoning(pointer),
      applications ?? readApplications(pointer),
    ])
    zoning = zoneResult.status === 'fulfilled' ? zoneResult.value : undefined
    applications = applicationResult.status === 'fulfilled' ? applicationResult.value : undefined
    if (zoning && applications && zoning.snapshotDate !== applications.snapshotDate) {
      zoning = undefined
      applications = undefined
      pointer = undefined
    }
  })().catch(() => {
    pointer = undefined
  }).finally(() => {
    pending = undefined
  })
  return pending
}

function stale(snapshotDate: string): boolean {
  const parts = Object.fromEntries(localDate.formatToParts(new Date()).map(part => [part.type, part.value]))
  return Date.parse(`${parts.year}-${parts.month}-${parts.day}`) - Date.parse(snapshotDate) > 7 * 86400000
}

function link(url: string, label: string): string {
  return `<a class="sourceLink" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
}

function dateLabel(value: string | null): string {
  return date(value) ? formatDate.format(new Date(value)) : 'Unavailable'
}

function metadata(snapshotDate: string): string {
  const warning = stale(snapshotDate) ? '<p class="planningWarning">Stale snapshot. Check official record.</p>' : ''
  return `<p class="notice">Snapshot ${dateLabel(snapshotDate)}</p>${warning}`
}

function state(message: string): string {
  return `<p class="notice" role="status">${message}</p>`
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validZone(zone: unknown): zone is Zone {
  return record(zone) && typeof zone.code === 'string' && typeof zone.label === 'string' &&
    finite(zone.areaM2) && finite(zone.percent) && typeof zone.sliver === 'boolean'
}

function percent(value: number): string {
  return value > 0 && value < 0.01 ? '&lt;0.01%' : `${formatNumber.format(value)}%`
}

function zoningContent(key: string, loading: boolean): string {
  if (!zoning) return state(loading ? 'Loading zoning…' : 'Zoning data unavailable.')
  const match = zoning.byBlock[key]
  const details = metadata(zoning.snapshotDate) + `<p>${link(zoning.sourceUrl, 'ACTmapi zoning source')}</p>`
  if (!record(match) || !Array.isArray(match.zones) || !match.zones.every(validZone) ||
      typeof match.hasGap !== 'boolean' || typeof match.hasOverlap !== 'boolean' || !finite(match.gapPercent)) {
    return state('Zoning coverage unavailable for this block.') + details
  }
  const rows = match.zones.map(zone => `<li><strong>${esc(zone.code)}</strong> ${esc(zone.label)}<span class="zoneShare">${percent(zone.percent)} of block${zone.sliver ? ' · small mapped intersection' : ''}</span></li>`)
  const gap = match.hasGap ? `<p class="planningWarning">Mapped zoning leaves ${percent(match.gapPercent)} of this block uncovered.</p>` : ''
  const overlap = match.hasOverlap ? '<p class="planningWarning">Mapped zone polygons overlap. Shares can add to more than 100%.</p>' : ''
  return (rows.length ? `<ul class="zoneList">${rows.join('')}</ul><p class="notice">Area shares are approximate polygon intersections.</p>` : state('No mapped zoning intersects this block in this snapshot.')) + gap + overlap + details
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

function validApplication(row: unknown, number: string): row is Application {
  return record(row) && row.number === number && (row.status === 'active' || row.status === 'completed') &&
    (row.decision === null || typeof row.decision === 'string') &&
    (row.lodgementDate === null || date(row.lodgementDate)) && (row.decisionDate === null || date(row.decisionDate)) &&
    strings(row.types) && strings(row.subclasses)
}

function applicationRow(app: Application, distanceM?: number): string {
  const status = app.status === 'active' ? 'Active in snapshot' : 'Completed in snapshot'
  const description = [...new Set([...app.types, ...app.subclasses])].join(' · ')
  const distance = distanceM === undefined ? '' : ` · ${formatNumber.format(distanceM)} m`
  return `<li><h4>DA ${esc(app.number)}</h4><p class="bodyText">${status}${distance}</p>` +
    (description ? `<p class="bodyText">${esc(description)}</p>` : '') +
    `<dl class="facts"><dt>Lodged</dt><dd>${dateLabel(app.lodgementDate)}</dd>` +
    `<dt>Decision</dt><dd>${esc(app.decision || 'Unavailable')}</dd>` +
    `<dt>Decision date</dt><dd>${dateLabel(app.decisionDate)}</dd></dl></li>`
}

function applicationMatch(key: string) {
  if (!applications) return
  const {byBlock, radiusM, applications: byNumber} = applications
  const match = byBlock[key]
  if (record(match) && strings(match.onBlock) && Array.isArray(match.nearby) &&
      match.onBlock.every(number => validApplication(byNumber[number], number)) &&
      match.nearby.every(row => record(row) && typeof row.number === 'string' && finite(row.distanceM) &&
        row.distanceM <= radiusM && validApplication(byNumber[row.number], row.number))) {
    return match
  }
}

function applicationBlockKeys(match: ReturnType<typeof applicationMatch>): Set<string> {
  const keys = new Set<string>()
  if (!applications || !match) return keys
  const relevant = new Set([...match.onBlock, ...match.nearby.map(row => row.number)])
  for (const [key, row] of Object.entries(applications.byBlock)) {
    if (record(row) && strings(row.onBlock) && row.onBlock.some(number => relevant.has(number))) keys.add(key)
  }
  return keys
}

function applicationContent(match: ReturnType<typeof applicationMatch>, loading: boolean): string {
  if (!applications) return state(loading ? 'Loading development applications…' : 'Development application data unavailable.')
  const {sourceUrls, snapshotDate, completedSince, radiusM, applications: byNumber} = applications
  const sourceLinks = `<p class="planningLinks">${link(sourceUrls.active, 'ACT active DA source')} ${link(sourceUrls.completed, 'ACT completed DA source')}</p>`
  const coverage = metadata(snapshotDate) + `<p class="notice">Active records in the snapshot and completed records since ${dateLabel(completedSince)}. Nearby distances are measured from the selected block to the mapped application geometry.</p>` + sourceLinks
  if (!match) return state('Development application coverage unavailable for this block.') + coverage
  const exact = match.onBlock.map(number => applicationRow(byNumber[number]))
  const nearby = match.nearby.map(row => applicationRow(byNumber[row.number], row.distanceM))
  return coverage + '<h4 class="planningGroup">On this registered block</h4>' +
    (exact.length ? `<ul class="applicationList">${exact.join('')}</ul>` : state('No on-block applications found in this snapshot.')) +
    (nearby.length ? `<details class="nearby"><summary>Nearby within ${radiusM} m (${nearby.length})</summary><ul class="applicationList">${nearby.join('')}</ul></details>` :
      `<h4 class="planningGroup">Nearby within ${radiusM} m</h4>${state('No nearby applications found in this snapshot.')}`)
}

export function showPlanning(container: HTMLElement, block: Item | undefined, home: Item | undefined,
  showApplicationBlocks: (keys: ReadonlySet<string>) => void) {
  const key = String(block?.properties.BLOCK_KEY ?? home?.properties.BLOCK_KEY ?? '')
  if (!/^\d+$/.test(key)) {
    showApplicationBlocks(new Set())
    container.innerHTML = state('Planning unavailable. This address has no registered block key.')
    return
  }
  const scope = block ? `Section ${esc(block.properties.SECTION_NUMBER)} · Block ${esc(block.properties.BLOCK_NUMBER)}` : `Block key ${esc(key)}`
  function render(loading: boolean) {
    if (!container.isConnected) return
    const match = applicationMatch(key)
    showApplicationBlocks(applicationBlockKeys(match))
    const mapKey = match ? '<p class="notice planningMapKey"><span class="swatch application" aria-hidden="true"></span>Yellow marks Kingston blocks linked to these applications. Nearby applications without a Kingston block match appear in the list.</p>' : ''
    const retry = !loading && (!zoning || !applications) ? '<button class="retry">Retry planning data</button>' : ''
    container.innerHTML = `<p class="bodyText">${scope}${home ? ' · parent block' : ''}</p>` +
      '<p class="notice">Check the official records for current zoning, permissions and application decisions.</p>' +
      `<div class="planningSection"><h3>Mapped zoning</h3>${zoningContent(key, loading)}</div>` +
      `<div class="planningSection"><h3>Development applications</h3>${mapKey}${applicationContent(match, loading)}</div>${retry}`
    const button = container.querySelector('button')
    if (button) button.onclick = refresh
  }
  function refresh() {
    const request = loadPlanning()
    render(!!request)
    if (request) void request.then(() => render(false))
  }
  if (!attempted) refresh()
  else {
    render(!!pending)
    if (pending) void pending.then(() => render(false))
  }
}
