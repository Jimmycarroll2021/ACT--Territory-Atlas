import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const root = new URL('../../', import.meta.url)
const divisionsPath = new URL('public/geo/divisions.geojson', root)
const receiptPath = new URL('data/context/kingston-closures.json', root)
const amenitiesPath = new URL('data/context/kingston-amenities.json', root)
const snapshotPath = new URL('public/context/kingston.json', root)
const services = 'https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services/'
const closuresMap = 'https://www.cityservices.act.gov.au/roads-and-paths/act_public_road_closures'
const webMap = 'https://www.arcgis.com/sharing/rest/content/items/dcc7ff1d43104b05a340dd87617112b7/data'
const sourceCheckedAt = '2026-11-21T23:42:00Z'
const day = 24 * 60 * 60 * 1000

const layers = [
  { id: 'planned-road', service: 'Road_Closures_public_view_HISTORICAL', title: 'Planned Road Closures', kind: 'road' },
  { id: 'unplanned-road', service: 'Public_Temporary_Road_Closures', title: 'Road Closures', kind: 'road' },
  { id: 'planned-footpath', service: 'Footpath_Closures_public_view', title: 'Planned Footpath Closures', kind: 'footpath', suffix: 'Footpath' },
  { id: 'unplanned-footpath', service: 'Public_Temporary_Footpath_Closures', title: 'Footpath Closures', kind: 'footpath' },
].map(layer => ({
  ...layer,
  url: `${services}${layer.service}/FeatureServer/0`,
  startField: `startTimeClosure${layer.suffix ?? ''}`,
  endField: `endTimeClosure${layer.suffix ?? ''}`,
}))
const amenities = [
  { id: 'playgrounds', dataset: 'e4ug-7r3x', title: 'Public playgrounds', singular: 'playground record', plural: 'playground records' },
  { id: 'fountains', dataset: 'xfiz-thuk', title: 'Public drinking fountains', singular: 'fountain asset', plural: 'fountain assets' },
]

const json = value => JSON.stringify(value, null, 2) + '\n'
const hash = value => createHash('sha256').update(value).digest('hex')

function kingstonBoundary(bytes) {
  const features = JSON.parse(bytes).features.filter(feature => feature.properties.DIVISION_NAME === 'KINGSTON')
  if (features.length !== 1) throw new Error('Expected one official Kingston division')
  const geometry = features[0].geometry
  const polygons = { Polygon: [geometry.coordinates], MultiPolygon: geometry.coordinates }[geometry.type]
  if (!polygons?.length) throw new Error('Invalid Kingston division geometry')
  const coordinates = polygons.flat(2)
  const xs = coordinates.map(point => point[0])
  const ys = coordinates.map(point => point[1])
  return { polygons, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }
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

function inKingston(point, polygons) {
  return polygons.some(([exterior, ...holes]) => inRing(point, exterior) && !holes.some(hole => inRing(point, hole)))
}

async function getJson(base, params = {}) {
  const url = new URL(base)
  url.search = new URLSearchParams(params)
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url.pathname}`)
  const result = await response.json()
  if (result?.error) throw new Error(`ArcGIS error ${result.error.code} from ${url.pathname}`)
  return result
}

const arcgis = (base, params) => getJson(base, { f: 'json', ...params })

async function captureLayer(layer, bounds) {
  const query = {
    where: '1=1', geometry: bounds.join(','), geometryType: 'esriGeometryEnvelope',
    inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
  }
  const url = `${layer.url}/query`
  const [meta, countResult, result] = await Promise.all([
    arcgis(layer.url),
    arcgis(url, { ...query, returnCountOnly: 'true' }),
    arcgis(url, { ...query, outSR: '4326', outFields: `objectid,${layer.startField},${layer.endField}` }),
  ])
  const fields = new Map(meta.fields?.map(field => [field.name, field.type]))
  if (meta.geometryType !== 'esriGeometryPoint' || fields.get('objectid') !== 'esriFieldTypeOID' ||
      fields.get(layer.startField) !== 'esriFieldTypeDate' || fields.get(layer.endField) !== 'esriFieldTypeDate' ||
      !Number.isSafeInteger(meta.editingInfo?.dataLastEditDate)) {
    throw new Error(`Unexpected schema for ${layer.id}`)
  }
  const { count } = countResult
  if (!Array.isArray(result.features) || count !== result.features.length || result.exceededTransferLimit ||
      (count > 0 && result.spatialReference?.wkid !== 4326)) {
    throw new Error(`Incomplete or unexpected coordinates for ${layer.id}`)
  }
  const rows = result.features.map(({ attributes, geometry }) => ({
    id: attributes?.objectid,
    start: attributes?.[layer.startField],
    end: attributes?.[layer.endField],
    point: [geometry?.x, geometry?.y],
  })).sort((a, b) => a.id - b.id)
  return {
    id: layer.id, sourceUrl: layer.url, itemId: meta.serviceItemId,
    sourceEditedAt: new Date(meta.editingInfo.dataLastEditDate).toISOString(),
    queriedAt: new Date().toISOString(), query, count, rows,
  }
}

async function capture(divisions) {
  const { bounds } = kingstonBoundary(divisions)
  const map = await arcgis(webMap)
  const urls = new Map(map.operationalLayers?.map(layer => [layer.title, layer.url.toLowerCase()]))
  if (layers.some(layer => urls.get(layer.title) !== layer.url.toLowerCase())) {
    throw new Error('Roads ACT changed the closure map layers')
  }
  const results = []
  for (const layer of layers) results.push(await captureLayer(layer, bounds))
  return {
    asOf: new Date().toISOString(), webMap: webMap + '?f=json',
    divisionsSha256: hash(divisions), layers: results,
  }
}

const amenityFilter = "suburb='KINGSTON' and operational_state='ACTIVE'"
async function captureAmenities() {
  return Promise.all(amenities.map(async ({ dataset }) => {
    const url = `https://www.data.act.gov.au/resource/${dataset}.json`
    const [result, counts] = await Promise.all([
      getJson(url, { $where: amenityFilter, $select: 'asset_id', $order: 'asset_id', $limit: '100' }),
      getJson(url, { $where: amenityFilter, $select: 'count(*) as count' }),
    ])
    return {
      dataset, sourceUrl: url, where: amenityFilter, observedAt: new Date().toISOString(),
      count: Number(counts[0]?.count), ids: result.map(row => row.asset_id),
    }
  }))
}

function amenityCards(receipts) {
  if (receipts.length !== amenities.length) throw new Error('Incomplete Kingston amenities capture')
  return amenities.map((item, index) => {
    const receipt = receipts[index]
    const { count, ids, observedAt } = receipt
    if (receipt.dataset !== item.dataset || receipt.where !== amenityFilter || !Number.isFinite(Date.parse(observedAt)) ||
        count !== ids.length || new Set(ids).size !== count || ids.some(id => typeof id !== 'string' || !id)) {
      throw new Error(`Invalid amenity capture for ${item.dataset}`)
    }
    return {
      id: item.id, title: item.title, status: 'available',
      summary: `The ACT asset register lists ${count} active ${count === 1 ? item.singular : item.plural} tagged Kingston.`,
      coverage: 'Government asset records tagged Kingston. Coverage can exclude privately managed or unlisted facilities. Active is an inventory status.',
      sourceName: 'ACT Government Open Data', sourceUrl: `https://www.data.act.gov.au/d/${item.dataset}`,
      observedAt, action: 'View the official asset register',
    }
  })
}

const flood = {
  id: 'flood', title: 'Flood mapping', status: 'unavailable',
  summary: 'Address-level screening is unavailable here. Check the Kingston address on the official 1% annual exceedance probability flood map.',
  coverage: 'Indicative mapping for major stormwater channels, creeks and rivers. Street-scale overland flow and individual-block drainage need separate checks.',
  sourceName: 'ACT Government', sourceUrl: 'https://www.act.gov.au/environment/water/flood-maps',
  action: 'Open ACTmapi Flood Map', href: 'https://www.actmapi.act.gov.au/map-links/flood-map',
}
const bushfire = {
  id: 'bushfire', title: 'Bushfire prone areas', status: 'unavailable',
  summary: 'Address-level screening is unavailable here. Search the Kingston address on the official Bushfire Map for its mapped designation.',
  coverage: 'ACT bushfire prone area designation. A detailed site assessment is a separate check.',
  sourceName: 'ACT Emergency Services Agency', sourceUrl: 'https://esa.act.gov.au/be-emergency-ready/bushfires',
  action: 'Open ACTmapi Bushfire Map', href: 'https://www.actmapi.act.gov.au/map-links/bushfire',
}
const library = {
  id: 'library', title: 'Kingston Library', status: 'available',
  summary: 'Kingston Library is at 54 Giles Street. Libraries ACT publishes branch hours, contact details and facilities.',
  coverage: 'One verified Kingston facility. Check the branch page for current hours.',
  sourceName: 'Libraries ACT', sourceUrl: 'https://www.library.act.gov.au/visit/find-us',
  action: 'See library locations and hours',
}
const activeTravel = {
  id: 'active-travel', title: 'Walking and cycling', status: 'available',
  summary: 'Transport Canberra publishes a walking and cycling map for exploring connections from Kingston.',
  coverage: 'Canberra network overview. Check the route and any temporary closures before travelling.',
  sourceName: 'Transport Canberra', sourceUrl: 'https://www.transport.act.gov.au/getting-around/find-a-stop-or-map',
  action: 'Find walking and cycling maps',
}
const station = {
  id: 'station', title: 'Canberra Station', status: 'available',
  summary: 'Canberra Station is on Burke Crescent in Kingston. The official station page lists access, facilities and departures.',
  coverage: 'Station facilities and accessibility. Check the operator for trips and current running information.',
  sourceName: 'Transport for NSW', sourceUrl: 'https://transportnsw.info/stop?q=26041',
  action: 'See station facilities',
}
const transit = {
  id: 'transit', title: 'Public transport departures', status: 'unavailable',
  summary: 'Live departures and delays are unavailable in this view. Enter a Kingston address in the Transport Canberra journey planner.',
  coverage: 'The MyWay+ schedule and real-time developer feeds require approved access. Check the official planner for your chosen trip.',
  sourceName: 'Transport Canberra', sourceUrl: 'https://www.transport.act.gov.au/contact-us/information-for-developers',
  observedAt: null, action: 'Open journey planner', href: 'https://www.transport.act.gov.au/',
}
const alerts = {
  id: 'transit-alerts', title: 'Public transport changes', status: 'unavailable',
  summary: 'Live Kingston service alerts are unavailable in this view. Transport Canberra publishes diversions and upcoming changes.',
  coverage: 'Operator notices for the ACT network. Check the notice against your route, stop and date.',
  sourceName: 'Transport Canberra', sourceUrl: 'https://www.transport.act.gov.au/news/service-alerts-and-updates',
  observedAt: null, action: 'Check service alerts',
}
const events = {
  id: 'events', title: 'Events today and this week', status: 'unavailable',
  summary: 'A Kingston events feed is unavailable in this view. Browse VisitCanberra for today or the next seven days and check the venue.',
  coverage: 'The official calendar covers listed Canberra-region events. ATDW API redistribution requires a distributor licence.',
  sourceName: 'VisitCanberra', sourceUrl: 'https://visitcanberra.com.au/events',
  observedAt: null, action: 'Browse the events calendar',
}

function closureCard(receipt, divisions) {
  const { polygons, bounds } = kingstonBoundary(divisions)
  const observed = Date.parse(receipt.asOf)
  if (!Number.isFinite(observed) || receipt.divisionsSha256 !== hash(divisions) ||
      receipt.layers.length !== layers.length) throw new Error('Closure receipt does not match the Kingston boundary')
  const cutoff = observed + 7 * day
  const counts = { road: 0, footpath: 0 }
  let expires = observed + day
  for (const [index, layer] of layers.entries()) {
    const capture = receipt.layers[index]
    const queriedAt = Date.parse(capture.queriedAt)
    if (capture.id !== layer.id || capture.sourceUrl !== layer.url || capture.query.geometry !== bounds.join(',') ||
        capture.count !== capture.rows.length || new Set(capture.rows.map(row => row.id)).size !== capture.count ||
        !Number.isFinite(queriedAt) || queriedAt > observed || observed - queriedAt >= day) {
      throw new Error(`Invalid capture for ${layer.id}`)
    }
    expires = Math.min(expires, queriedAt + day)
    for (const row of capture.rows) {
      const validDate = date => date === null || Number.isSafeInteger(date)
      if (!Number.isSafeInteger(row.id) || row.point.length !== 2 || !row.point.every(Number.isFinite) ||
          !validDate(row.start) || !validDate(row.end) ||
          (row.start !== null && row.end !== null && row.end < row.start)) {
        throw new Error(`Invalid closure record in ${layer.id}`)
      }
      if (!inKingston(row.point, polygons) || row.start === null || row.end === null || row.start === row.end) continue
      if (row.end <= observed) continue
      if (row.start > cutoff) {
        expires = Math.min(expires, row.start - 7 * day)
        continue
      }
      counts[layer.kind]++
      expires = Math.min(expires, row.end)
    }
  }
  const notices = (count, kind) => `${count} ${kind} ${count === 1 ? 'notice' : 'notices'}`
  return {
    id: 'road-closures', title: 'Road and footpath notices', status: 'available',
    summary: `${notices(counts.road, 'road')} and ${notices(counts.footpath, 'footpath')} mapped in Kingston have date ranges overlapping the seven days from this check. Check the map for locations and operating hours.`,
    coverage: 'Roads ACT planned and unplanned notices with a mapped point in Kingston and a start and end date. Notices can overlap, apply at certain hours or finish early. Other road managers and unmapped disruptions may be missing.',
    sourceName: 'Roads ACT', sourceUrl: closuresMap, action: 'Check the latest closure map',
    observedAt: receipt.asOf, expiresAt: new Date(expires).toISOString(),
  }
}

export function buildContext(receipt, divisions, amenityReceipts) {
  const withAction = cards => cards.map(card => ({ ...card, href: card.href ?? card.sourceUrl }))
  return {
    asOf: receipt.asOf,
    persistent: withAction([
      ...[flood, bushfire].map(card => ({ ...card, observedAt: null })),
      ...[library, activeTravel, station].map(card => ({ ...card, observedAt: sourceCheckedAt })),
      ...amenityCards(amenityReceipts),
    ]),
    today: withAction([transit, alerts, closureCard(receipt, divisions), events]),
  }
}

async function writeAtomic(path, value) {
  await mkdir(new URL('.', path), { recursive: true })
  const pending = new URL(`./${path.pathname.split('/').at(-1)}.${process.pid}.tmp`, path)
  await writeFile(pending, value, { flag: 'wx' })
  await rename(pending, path)
}

async function main() {
  const divisions = await readFile(divisionsPath)
  const args = process.argv.slice(2).join(' ')
  if (args === '--check') {
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    const amenityReceipts = JSON.parse(await readFile(amenitiesPath, 'utf8'))
    if (json(buildContext(receipt, divisions, amenityReceipts)) !== await readFile(snapshotPath, 'utf8')) {
      throw new Error('Public context differs from the saved capture')
    }
    console.log(`Reproduced Kingston context as of ${receipt.asOf}`)
    return
  }
  if (args && args !== '--refresh-amenities') throw new Error('Expected no arguments, --check or --refresh-amenities')
  const amenityReceipts = args === '--refresh-amenities'
    ? await captureAmenities()
    : JSON.parse(await readFile(amenitiesPath, 'utf8'))
  const receipt = await capture(divisions)
  const snapshot = buildContext(receipt, divisions, amenityReceipts)
  if (args === '--refresh-amenities') await writeAtomic(amenitiesPath, json(amenityReceipts))
  await writeAtomic(receiptPath, json(receipt))
  await writeAtomic(snapshotPath, json(snapshot))
  console.log(`Refreshed Kingston context as of ${snapshot.asOf}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Kingston context refresh failed: ${error.message}`)
    process.exitCode = 1
  })
}
