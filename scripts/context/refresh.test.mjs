import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { buildContext } from './refresh.mjs'

const root = new URL('../../', import.meta.url)
const load = path => readFile(new URL(path, root))
const [divisions, captureBytes, amenityBytes, snapshotBytes] = await Promise.all([
  load('public/geo/divisions.geojson'), load('data/context/kingston-closures.json'),
  load('data/context/kingston-amenities.json'), load('public/context/kingston.json'),
])
const capture = JSON.parse(captureBytes)
const amenities = JSON.parse(amenityBytes)
const day = 24 * 60 * 60 * 1000
const roadCard = (receipt = capture) => buildContext(receipt, divisions, amenities).today.find(card => card.id === 'road-closures')

test('public snapshot exactly replays and all cards have source and coverage metadata', () => {
  const snapshot = buildContext(capture, divisions, amenities)
  assert.equal(JSON.stringify(snapshot, null, 2) + '\n', snapshotBytes.toString())
  const cards = [...snapshot.persistent, ...snapshot.today]
  assert.equal(new Set(cards.map(card => card.id)).size, cards.length)
  for (const card of cards) {
    for (const key of ['id', 'title', 'summary', 'sourceName', 'coverage', 'action']) assert.ok(card[key].trim())
    for (const key of ['sourceUrl', 'href']) assert.equal(new URL(card[key]).protocol, 'https:')
    assert.ok(['available', 'unavailable', 'stale'].includes(card.status))
    if (card.status === 'available') assert.ok(Number.isFinite(Date.parse(card.observedAt)))
  }
  for (const id of ['flood', 'bushfire', 'transit', 'transit-alerts', 'events']) {
    const card = cards.find(card => card.id === id)
    assert.equal(card.status, 'unavailable')
    assert.equal(card.observedAt, null)
  }
  assert.ok(Date.parse(roadCard().expiresAt) > Date.parse(capture.asOf))
  assert.ok(Date.parse(roadCard().expiresAt) <= Date.parse(capture.asOf) + day)
})

test('roads count only dated, spatially matched notices in the seven-day window', () => {
  const fixture = structuredClone(capture)
  for (const layer of fixture.layers) Object.assign(layer, { count: 0, rows: [] })
  const asOf = Date.parse(fixture.asOf)
  const inKingston = [149.146728169605, -35.313342881904937]
  const inBoxOutsideKingston = [149.1373482854745, -35.309259060448646]
  const road = fixture.layers.find(layer => layer.id === 'planned-road')
  road.rows = [
    { id: 1, start: asOf - day, end: asOf + day / 2, point: inKingston },
    { id: 2, start: asOf - day, end: asOf + day / 2, point: inBoxOutsideKingston },
    { id: 3, start: asOf - day, end: null, point: inKingston },
    { id: 4, start: asOf - day, end: asOf, point: inKingston },
    { id: 5, start: asOf + 8 * day, end: asOf + 9 * day, point: inKingston },
  ]
  road.count = road.rows.length
  const path = fixture.layers.find(layer => layer.id === 'planned-footpath')
  path.rows = [{ id: 1, start: asOf + day, end: asOf + 2 * day, point: inKingston }]
  path.count = path.rows.length
  assert.match(roadCard(fixture).summary, /^1 road notice and 1 footpath notice/)
  assert.equal(Date.parse(roadCard(fixture).expiresAt), asOf + day / 2)
})

test('incomplete or invalid receipts cannot become a zero-notice snapshot', () => {
  const fixture = structuredClone(capture)
  fixture.layers[0].count++
  assert.throws(() => roadCard(fixture), /Invalid capture/)
  const badAmenities = structuredClone(amenities)
  badAmenities[0].ids.pop()
  assert.throws(() => buildContext(capture, divisions, badAmenities), /Invalid amenity capture/)
  assert.throws(() => buildContext(capture, Buffer.concat([divisions, Buffer.from(' ')]), amenities), /boundary/)
})
