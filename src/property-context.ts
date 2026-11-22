import type {Item} from './data'
import {address, bounds} from './data'
import {escapeHtml as esc} from './profile'

type Screening = {status: 'intersection' | 'no mapped intersection' | 'unknown'; areaM2?: number; boundaryContact?: boolean; sourceIds?: string[]}
type HazardData = {schemaVersion: 1; byBlock: Record<string, {flood?: Screening; bushfire?: Screening & {categories?: string[]}}> ; sources?: Record<string, {title?: string; sourceUrl?: string; url?: string; URL?: string; edition?: string; sourceEditedAtUtc?: string; coverage?: string}>}
type Amenity = {id: string; category: string; name: string; geometry: {type: 'Point'; coordinates: [number, number]}; source?: {publisher?: string; url?: string}}
type AmenityData = {schemaVersion: 1; distanceMethod: string; routeDistanceAvailable: false; features: Amenity[]; nearestByAddressId?: Record<string, Record<string, {featureId: string; distanceMeters: number}>>; categoryCoverage?: Record<string, string>; capturedAtUtc?: string}

const root = document.querySelector<HTMLElement>('#selectedContext')!
const commuteForm = document.querySelector<HTMLFormElement>('#commuteForm')!
const commuteResult = document.querySelector<HTMLElement>('#commuteResult')!
const commuteDeparture = document.querySelector<HTMLInputElement>('#commuteDeparture')!
const roadNotices = document.querySelector<HTMLElement>('#roadNotices')!
const destinationSearch = document.querySelector<HTMLInputElement>('#destinationSearch')!
const destinationMatches = document.querySelector<HTMLElement>('#destinationMatches')!
const destinationLon = document.querySelector<HTMLInputElement>('#destinationLon')!
const destinationLat = document.querySelector<HTMLInputElement>('#destinationLat')!
const eventsStatus = document.querySelector<HTMLElement>('#eventsStatus')!
const eventsRows = document.querySelector<HTMLElement>('#eventsRows')!
let hazardData: HazardData | undefined
let amenityData: AmenityData | undefined
let pending: Promise<void> | undefined
let attempted = false
let selectedBlock: Item | undefined
let selectedHome: Item | undefined
let selected = false
let availableAddresses: Item[] = []
let destinationAddress: Item | undefined

function source(name: string, url?: string) {
  return url && /^https:\/\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name)
}

function hazardRow(name: string, value: Screening | undefined, url?: string) {
  const status = value?.status === 'intersection' ? 'Mapped intersection' : value?.status === 'no mapped intersection' ? 'No mapped intersection in this layer' : 'Unknown'
  const area = value?.status === 'intersection' && typeof value.areaM2 === 'number' && Number.isFinite(value.areaM2) ? ` About ${value.areaM2.toFixed(1)} m² of mapped overlap.` : ''
  return `<li><strong>${esc(name)}:</strong> ${status}.${area} ${source('Source layer', url)}</li>`
}

function point(item: Item): [number, number] | undefined {
  const [[west, south], [east, north]] = bounds(item)
  return [west, south, east, north].every(Number.isFinite) ? [(west + east) / 2, (south + north) / 2] : undefined
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180
  const lat = (a[1] + b[1]) / 2 * rad
  const dx = (a[0] - b[0]) * rad * Math.cos(lat)
  const dy = (a[1] - b[1]) * rad
  return Math.round(6371000 * Math.hypot(dx, dy))
}

function amenities(origin: [number, number], addressId?: string) {
  if (!amenityData?.features?.length) return '<p class="contextIntro">Nearby facility distances are unavailable.</p>'
  const byId = new Map(amenityData.features.map(item => [item.id, item]))
  const suggested = addressId && amenityData.nearestByAddressId?.[addressId]
  const entries = suggested ? Object.entries(suggested).map(([category, nearest]) => ({category, item: byId.get(nearest.featureId), distance: nearest.distanceMeters}))
    : [...new Set(amenityData.features.map(item => item.category))].map(category => {
      const options = amenityData!.features.filter(item => item.category === category && item.geometry?.type === 'Point' && item.geometry.coordinates.length >= 2)
      const ranked = options.map(item => ({item, distance: distanceMeters(origin, item.geometry.coordinates)})).sort((a, b) => a.distance - b.distance)
      return {category, ...ranked[0]}
    })
  const rows = entries.filter(row => row.item && Number.isFinite(row.distance) && row.distance >= 0).sort((a, b) => a.distance - b.distance).slice(0, 9)
  if (!rows.length) return '<p class="contextIntro">Nearby facility distances are unavailable.</p>'
  const unavailable = ['grocery', 'cafe', 'medical'].filter(category => amenityData?.categoryCoverage?.[category]?.startsWith('unavailable'))
  const osmIncomplete = ['grocery', 'cafe', 'medical'].filter(category => amenityData?.categoryCoverage?.[category]?.startsWith('osm_tagged_incomplete'))
  return `<p class="contextIntro">Approximate straight-line distance from the ${addressId ? 'selected address point' : 'selected block centre'} to mapped feature points. These are not walking distances, route access or entrance locations.</p><ul class="contextList">${rows.map(row => `<li class="amenityRow"><div><strong>${source(row.item!.name, row.item!.source?.url)}</strong><span>${esc(row.category.replaceAll('_', ' '))}</span></div><span>${Math.round(row.distance / 10) * 10} m</span></li>`).join('')}</ul>${unavailable.length ? `<p class="contextIntro">${esc(unavailable.join(', '))} listings unavailable from this data source.</p>` : ''}${osmIncomplete.length ? `<p class="contextIntro">${esc(osmIncomplete.join(', '))} listings use incomplete OpenStreetMap tags; absence of a listing does not mean absence of a service. OSM data © OpenStreetMap contributors, ODbL.</p>` : ''}`
}

function render() {
  if (!selected) return
  const blockKey = selectedBlock?.properties.BLOCK_KEY
  const origin = selectedHome ? point(selectedHome) : selectedBlock ? point(selectedBlock) : undefined
  if (!selectedBlock || !origin) {
    root.innerHTML = '<div class="selectedContextEmpty">Select a Kingston block or address for block-level hazard screening and nearby mapped facilities.</div>'
    commuteResult.textContent = 'Select a Kingston address to set the origin. Journey times are unavailable until route data is connected.'
    return
  }
  const entry = hazardData?.byBlock?.[String(blockKey)]
  const floodUrl = hazardData?.sources?.flood?.sourceUrl ?? hazardData?.sources?.flood?.url ?? hazardData?.sources?.flood?.URL ?? 'https://www.actmapi.act.gov.au/map-links/flood-map'
  const bushfireUrl = hazardData?.sources?.bushfire?.sourceUrl ?? hazardData?.sources?.bushfire?.url ?? hazardData?.sources?.bushfire?.URL ?? 'https://www.actmapi.act.gov.au/map-links/bushfire'
  root.innerHTML = `<div class="selectedContextBox"><h3>${selectedHome ? esc(address(selectedHome)) : `Block ${esc(String(selectedBlock.properties.BLOCK_NUMBER ?? ''))}, section ${esc(String(selectedBlock.properties.SECTION_NUMBER ?? ''))}`}</h3><p class="contextIntro">ACT block ${esc(String(blockKey))}. Screening uses published source polygons over the Kingston block area. It is not a dwelling assessment; no mapped intersection does not establish absence of hazard or insurance suitability.</p><h4>Hazard map screening</h4><ul class="screeningList">${hazardRow('Flood', entry?.flood, floodUrl)}${hazardRow('Bushfire prone area', entry?.bushfire, bushfireUrl)}</ul><h4>Nearby mapped facilities</h4>${amenities(origin, selectedHome ? String(selectedHome.properties.ADDRESS_ID) : undefined)}${!hazardData || !amenityData ? '<button id="retryContextLayers" type="button" class="retry">Retry map context</button>' : ''}</div>`
  commuteResult.textContent = selectedHome ? `Origin: ${address(selectedHome)}. Journey times are unavailable until route data is connected.` : 'Select an address on this block for the commute origin. Journey times are unavailable until route data is connected.'
}
root.addEventListener('click', event => {
  if ((event.target as HTMLElement).id === 'retryContextLayers') void load()
})

destinationSearch.oninput = () => {
  destinationAddress = undefined
  destinationMatches.replaceChildren()
  const query = destinationSearch.value.trim().toLowerCase()
  if (query.length < 2) return
  const matches = availableAddresses.filter(item => address(item).toLowerCase().includes(query)).slice(0, 20)
  if (!matches.length) { destinationMatches.textContent = 'No mapped Kingston address matches.'; return }
  const select = document.createElement('select')
  select.className = 'searchResults'
  select.setAttribute('aria-label', 'Destination address matches')
  select.append(new Option(`Choose a destination (${matches.length} shown)`, ''))
  matches.forEach((item, index) => select.append(new Option(address(item), String(index))))
  select.onchange = () => {
    destinationAddress = select.value === '' ? undefined : matches[Number(select.value)]
    if (destinationAddress) {
      destinationSearch.value = address(destinationAddress)
      destinationLon.value = destinationLat.value = ''
      destinationMatches.textContent = `Selected mapped destination: ${address(destinationAddress)}`
    }
  }
  destinationMatches.append(select)
}
destinationLon.oninput = destinationLat.oninput = () => { destinationAddress = undefined }

function chosenDestination(): {point: [number, number]; label: string} | undefined {
  if (destinationLon.value || destinationLat.value) {
    const lon = Number(destinationLon.value), lat = Number(destinationLat.value)
    if (!destinationLon.value || !destinationLat.value || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return
    return {point: [lon, lat], label: `coordinate ${lon}, ${lat}`}
  }
  const mapped = destinationAddress && point(destinationAddress)
  return mapped ? {point: mapped, label: address(destinationAddress!)} : undefined
}

async function load() {
  if (pending) return pending
  attempted = true
  pending = (async () => {
    const paths = ['/hazards/kingston.json', '/amenities/kingston.json']
    const results = await Promise.allSettled(paths.map(async path => {
      const response = await fetch(path, {cache: 'no-store', signal: AbortSignal.timeout(5000)})
      if (!response.ok) throw new Error('Layer unavailable')
      return response.json() as Promise<unknown>
    }))
    const hazard = results[0].status === 'fulfilled' ? results[0].value as Partial<HazardData> : undefined
    const amenity = results[1].status === 'fulfilled' ? results[1].value as Partial<AmenityData> : undefined
    if (hazard?.schemaVersion === 1 && hazard.byBlock && typeof hazard.byBlock === 'object') hazardData = hazard as HazardData
    if (amenity?.schemaVersion === 1 && typeof amenity.distanceMethod === 'string' && amenity.routeDistanceAvailable === false && Array.isArray(amenity.features)) amenityData = amenity as AmenityData
    render()
  })().finally(() => { pending = undefined })
  return pending
}

commuteForm.onsubmit = async event => {
  event.preventDefault()
  const destination = chosenDestination()
  const mode = (document.querySelector<HTMLSelectElement>('#commuteMode')!).selectedOptions[0].textContent
  const departure = commuteDeparture.value
  const modeValue = (document.querySelector<HTMLSelectElement>('#commuteMode')!).value
  const origin = selectedHome && point(selectedHome)
  if (!origin || !destination) {
    commuteResult.textContent = !origin ? 'Select a mapped Kingston address for the origin.' : 'Choose a mapped destination address or valid longitude and latitude.'
    return
  }
  const departureIso = new Date(departure).toISOString()
  commuteResult.textContent = `${mode} from ${address(selectedHome!)} to ${destination.label} at ${departure.replace('T', ' ')} device time: checking journey availability.`
  try {
    const params = new URLSearchParams({originLon: String(origin[0]), originLat: String(origin[1]), destinationLon: String(destination.point[0]), destinationLat: String(destination.point[1]), departure: departureIso, mode: modeValue})
    const [statusResponse, journeyResponse] = await Promise.all([
      fetch('/api/commute/status', {cache: 'no-store', signal: AbortSignal.timeout(5000)}),
      fetch(`/api/commute/journey?${params}`, {cache: 'no-store', signal: AbortSignal.timeout(5000)}),
    ])
    if (!statusResponse.ok || !journeyResponse.ok) throw new Error('Journey unavailable')
    const status = await statusResponse.json() as Record<string, {status?: string; reason?: string}>
    const journey = await journeyResponse.json() as {status?: string; reason?: string; durationMinutes?: number | null}
    const reason = journey.reason ?? status[modeValue]?.reason ?? 'Check the official journey planner.'
    commuteResult.textContent = journey.status === 'available' && Number.isFinite(journey.durationMinutes) && journey.durationMinutes! >= 0
      ? `${mode} from ${address(selectedHome!)} to ${destination.label}: ${journey.durationMinutes} minutes estimated for ${departure.replace('T', ' ')} device time. Confirm with the operator.`
      : `${mode} from ${address(selectedHome!)} to ${destination.label}: journey time unavailable. ${reason}`
  } catch {
    commuteResult.textContent = 'Journey service status is unavailable. Check the official journey planner for this trip.'
  }
  try {
    const params = new URLSearchParams({departure: departureIso, mode: modeValue})
    const response = await fetch(`/api/commute/roads?${params}`, {cache: 'no-store', signal: AbortSignal.timeout(5000)})
    if (!response.ok) throw new Error('Road notices unavailable')
    const roads = await response.json() as {status?: string; notices?: unknown[]; observedAt?: string; reason?: string; source?: {url?: string}}
    roadNotices.innerHTML = roads.status === 'available' && Array.isArray(roads.notices)
      ? `<p class="contextIntro">${roads.notices.length} mapped Kingston road or footpath notices overlap the 24 hours from this departure. Route impact is unknown. Saved notice check: ${roads.observedAt ? esc(new Date(roads.observedAt).toLocaleString('en-AU', {timeZone: 'Australia/Sydney'})) : 'unknown'}. ${source('Check the live Roads ACT map', roads.source?.url)}</p>`
      : `<p class="contextIntro">Road notice check unavailable: ${esc(roads.reason ?? 'check the current map')}. ${source('Check the live Roads ACT map', roads.source?.url)}</p>`
  } catch {
    roadNotices.innerHTML = `<p class="contextIntro">Road notice check unavailable. ${source('Check the live Roads ACT map', 'https://www.cityservices.act.gov.au/roads-and-paths/act_public_road_closures')}</p>`
  }
}
roadNotices.innerHTML = `<p class="contextIntro">Road and footpath notices can change. ${source('Check the latest Roads ACT closure map', 'https://www.cityservices.act.gov.au/roads-and-paths/act_public_road_closures')} before travelling.</p>`

async function loadEvents() {
  try {
    const response = await fetch('/events/kingston.json', {cache: 'no-store', signal: AbortSignal.timeout(5000)})
    if (!response.ok) throw new Error('Events unavailable')
    const feed = await response.json() as {schemaVersion?: number; status?: string; asOf?: string | null; expiresAt?: string | null; coverage?: string; sourceUrl?: string; events?: unknown[]}
    if (feed.schemaVersion !== 1 || !Array.isArray(feed.events)) throw new Error('Events invalid')
    const rows = feed.events.filter((item): item is {title: string; startsAt: string; url?: string} => {
      if (!item || typeof item !== 'object') return false
      const row = item as Record<string, unknown>
      return typeof row.title === 'string' && typeof row.startsAt === 'string' && Number.isFinite(Date.parse(row.startsAt))
    })
    if (feed.status === 'available' && rows.length && feed.asOf && Number.isFinite(Date.parse(feed.asOf)) && feed.expiresAt && Date.parse(feed.expiresAt) > Date.now()) {
      eventsStatus.textContent = `Listings captured ${new Date(feed.asOf).toLocaleString('en-AU', {timeZone: 'Australia/Sydney'})} Canberra time. Confirm dates and details with the organiser.`
      eventsRows.innerHTML = `<ul class="contextList">${rows.map(row => `<li class="contextCard"><strong>${esc(row.title)}</strong><p>${esc(new Date(row.startsAt).toLocaleString('en-AU', {timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short'}))} Canberra time</p>${row.url ? source('Event details', row.url) : ''}</li>`).join('')}</ul>`
    } else {
      eventsStatus.innerHTML = `A dated Kingston event feed is unavailable. ${esc(feed.coverage ?? '')} ${source('Browse VisitCanberra events', feed.sourceUrl ?? 'https://visitcanberra.com.au/events')}`
    }
  } catch {
    eventsStatus.innerHTML = `Dated Kingston event listings are unavailable. ${source('Browse VisitCanberra events', 'https://visitcanberra.com.au/events')}`
  }
}
void loadEvents()

export function updatePropertyContext(isKingston: boolean, block?: Item, home?: Item, addresses: Item[] = []) {
  selected = isKingston
  selectedBlock = block
  selectedHome = home
  availableAddresses = addresses
  if (selected) { render(); if (!attempted) void load() }
}
