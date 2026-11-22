import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const root = new URL('../../', import.meta.url)
const receiptPath = new URL('data/context/kingston-closures.json', root)
const boundaryPath = new URL('public/geo/divisions.geojson', root)
const mapUrl = 'https://www.cityservices.act.gov.au/roads-and-paths/act_public_road_closures'
const plannerUrl = 'https://www.transport.act.gov.au/'
const dayMs = 86_400_000
const layerIds = ['planned-road', 'unplanned-road', 'planned-footpath', 'unplanned-footpath']

function number(value, lower, upper) {
  if (value === null || value === '' || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= lower && parsed <= upper ? parsed : null
}

function parseDeparture(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseTrip(searchParams, { requireCoordinates = true } = {}) {
  const allowed = new Set(['originLon', 'originLat', 'destinationLon', 'destinationLat', 'departure', 'mode'])
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) return { error: 'Unexpected or repeated trip parameter' }
  }
  const mode = searchParams.get('mode')
  const departure = parseDeparture(searchParams.get('departure'))
  if (!['walk', 'transit'].includes(mode)) return { error: 'Mode must be walk or transit' }
  if (departure === null) return { error: 'Departure must be an ISO date-time with timezone' }
  const coordinateKeys = ['originLon', 'originLat', 'destinationLon', 'destinationLat']
  const present = coordinateKeys.filter(key => searchParams.has(key))
  if (requireCoordinates && present.length !== 4 || !requireCoordinates && present.length !== 0 && present.length !== 4) {
    return { error: 'Both origin and destination coordinates are required together' }
  }
  const values = present.length === 4 ? coordinateKeys.map((key, index) => number(searchParams.get(key), index % 2 ? -90 : -180, index % 2 ? 90 : 180)) : []
  if (values.includes(null)) return { error: 'Coordinates must be valid longitude and latitude' }
  return { mode, departure: new Date(departure).toISOString(), origin: values.length ? [values[0], values[1]] : null, destination: values.length ? [values[2], values[3]] : null }
}

export function journey(trip) {
  return {
    status: 'unavailable', mode: trip.mode, departure: trip.departure,
    origin: trip.origin, destination: trip.destination,
    durationMinutes: null, arrival: null, itinerary: null,
    reason: trip.mode === 'transit' ? 'Approved MyWay+ timetable access and a local OpenTripPlanner graph are not configured.' : 'A local walk routing graph is not configured.',
    source: { name: 'Transport Canberra journey planner', url: plannerUrl },
  }
}

export function status() {
  return {
    walk: { status: 'unavailable', reason: 'Local walk routing graph is not configured.' },
    transit: { status: 'unavailable', reason: 'Approved MyWay+ timetable access and a local OpenTripPlanner graph are not configured.' },
    roads: { status: 'check_required', scope: 'Kingston mapped notice points; freshness is checked for the selected departure', sourceUrl: mapUrl },
  }
}

function inRing([x, y], ring) {
  let inside = false
  for (let index = 1; index < ring.length; index++) {
    const [ax, ay] = ring[index - 1]
    const [bx, by] = ring[index]
    if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside
  }
  return inside
}

function inKingston(point, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  return polygons.some(([outer, ...holes]) => inRing(point, outer) && !holes.some(ring => inRing(point, ring)))
}

export function roadNotices(trip, receipt, boundaryBytes, now = Date.now()) {
  const unavailable = reason => ({
    status: 'unavailable', mode: trip.mode, departure: trip.departure, notices: [],
    reason, source: { name: 'Roads ACT closure map', url: mapUrl },
    routeImpact: 'unknown', coverage: 'Mapped points within Kingston only. A point is not a closure extent or proof of route impact.',
  })
  const observed = Date.parse(receipt?.asOf)
  if (!Number.isFinite(observed) || observed > now + 60_000 || now - observed >= dayMs) return unavailable('Saved road notices are stale; check the official map.')
  if (receipt?.divisionsSha256 !== createHash('sha256').update(boundaryBytes).digest('hex')) return unavailable('Road notice boundary does not match the saved capture.')
  if (!Array.isArray(receipt.layers) || receipt.layers.length !== 4 || receipt.layers.some((layer, i) => layer.id !== layerIds[i] || layer.count !== layer.rows?.length || !Number.isFinite(Date.parse(layer.queriedAt)) || now - Date.parse(layer.queriedAt) >= dayMs)) {
    return unavailable('Road notice capture is incomplete or stale.')
  }
  const boundary = JSON.parse(boundaryBytes).features.filter(feature => feature.properties?.DIVISION_NAME === 'KINGSTON')
  if (boundary.length !== 1) return unavailable('Kingston boundary is unavailable.')
  const departure = Date.parse(trip.departure)
  if (departure < observed - dayMs || departure > observed + 30 * dayMs) return unavailable('Chosen departure is outside the 30-day notice window of this capture.')
  const endOfDay = departure + dayMs
  const notices = []
  for (const layer of receipt.layers) {
    for (const row of layer.rows) {
      if (!Number.isSafeInteger(row.id) || !Array.isArray(row.point) || row.point.length !== 2 || !row.point.every(Number.isFinite) ||
          !Number.isSafeInteger(row.start) || !Number.isSafeInteger(row.end) || row.start >= row.end ||
          !inKingston(row.point, boundary[0].geometry) || row.end <= departure || row.start >= endOfDay) continue
      notices.push({ id: `${layer.id}:${row.id}`, layer: layer.id, kind: layer.id.endsWith('footpath') ? 'footpath' : 'road',
        point: row.point, startsAt: new Date(row.start).toISOString(), endsAt: new Date(row.end).toISOString(), routeImpact: 'unknown' })
    }
  }
  return {
    status: 'available', mode: trip.mode, departure: trip.departure, notices, observedAt: receipt.asOf,
    expiresAt: new Date(Math.min(observed + dayMs, ...receipt.layers.map(layer => Date.parse(layer.queriedAt) + dayMs))).toISOString(),
    source: { name: 'Roads ACT closure map', url: mapUrl }, routeImpact: 'unknown',
    coverage: 'Four planned and unplanned road and footpath layers. Mapped points in Kingston with date ranges overlapping the selected 24-hour period. Operating hours, early changes and other road managers may differ. These points do not establish route impact.',
  }
}

export async function loadRoadNotices(trip) {
  try {
    const [receipt, boundary] = await Promise.all([readFile(receiptPath, 'utf8'), readFile(boundaryPath)])
    return roadNotices(trip, JSON.parse(receipt), boundary)
  } catch {
    return { status: 'unavailable', mode: trip.mode, departure: trip.departure, notices: [], reason: 'Saved road notices are unavailable.', source: { name: 'Roads ACT closure map', url: mapUrl }, routeImpact: 'unknown' }
  }
}
