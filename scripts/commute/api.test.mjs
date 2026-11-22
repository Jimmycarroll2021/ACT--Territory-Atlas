import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { journey, parseTrip, roadNotices } from '../../server/commute/api.mjs'

const departure = '2026-11-22T09:00:00+11:00'
const query = extra => new URLSearchParams({ originLon: '149.14', originLat: '-35.31', destinationLon: '149.15', destinationLat: '-35.32', departure, mode: 'walk', ...extra })

test('requires selected coordinates, mode and zoned departure', () => {
  assert.equal(parseTrip(query()).mode, 'walk')
  assert.match(parseTrip(query({ mode: 'car' })).error, /Mode/)
  assert.match(parseTrip(query({ departure: '2026-11-22T09:00:00' })).error, /timezone/)
  assert.match(parseTrip(query({ originLon: '181' })).error, /Coordinates/)
  const repeated = query()
  repeated.append('mode', 'transit')
  assert.match(parseTrip(repeated).error, /repeated/)
  const roads = new URLSearchParams({ departure, mode: 'transit' })
  assert.equal(parseTrip(roads, { requireCoordinates: false }).origin, null)
})

test('does not manufacture a journey', () => {
  const result = journey(parseTrip(query()))
  assert.equal(result.status, 'unavailable')
  assert.equal(result.durationMinutes, null)
  assert.equal(result.itinerary, null)
})

test('four-layer road notices are date bounded, point only and expire', () => {
  const boundary = Buffer.from(JSON.stringify({ features: [{ properties: { DIVISION_NAME: 'KINGSTON' }, geometry: { type: 'Polygon', coordinates: [[[149.13, -35.33], [149.16, -35.33], [149.16, -35.30], [149.13, -35.30], [149.13, -35.33]]] } }] }))
  const asOf = Date.parse('2026-11-21T23:00:00Z')
  const row = (id, point, start, end) => ({ id, point, start, end })
  const layers = ['planned-road', 'unplanned-road', 'planned-footpath', 'unplanned-footpath'].map((id, index) => ({ id, count: index === 0 ? 3 : 0, queriedAt: new Date(asOf).toISOString(), rows: index === 0 ? [
    row(1, [149.14, -35.31], asOf - 1000, asOf + 1000 * 60 * 60 * 24),
    row(2, [149.17, -35.31], asOf - 1000, asOf + 1000 * 60 * 60 * 24),
    row(3, [149.14, -35.31], asOf + 1000 * 60 * 60 * 24 * 3, asOf + 1000 * 60 * 60 * 24 * 4),
  ] : [] }))
  const receipt = { asOf: new Date(asOf).toISOString(), divisionsSha256: createHash('sha256').update(boundary).digest('hex'), layers }
  const trip = parseTrip(new URLSearchParams({ departure, mode: 'walk' }), { requireCoordinates: false })
  const current = roadNotices(trip, receipt, boundary, asOf + 1000)
  assert.equal(current.status, 'available')
  assert.deepEqual(current.notices.map(notice => notice.id), ['planned-road:1'])
  assert.equal(current.notices[0].routeImpact, 'unknown')
  const stale = roadNotices(trip, receipt, boundary, asOf + 86_400_000)
  assert.equal(stale.status, 'unavailable')
  assert.equal(stale.notices.length, 0)
})

test('loopback API validates requests and rejects cross-origin calls', async () => {
  const probe = net.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const child = spawn(process.execPath, ['server/start.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' })
  try {
    const base = `http://127.0.0.1:${port}/api/commute`
    let ready = false
    for (let attempt = 0; attempt < 40; attempt++) {
      try { if ((await fetch(`${base}/status`)).ok) { ready = true; break } } catch {}
      await delay(100)
    }
    assert.ok(ready, 'local server started')
    const valid = new URLSearchParams(query())
    const journeyResponse = await fetch(`${base}/journey?${valid}`)
    assert.equal(journeyResponse.status, 200)
    assert.equal((await journeyResponse.json()).durationMinutes, null)
    assert.equal((await fetch(`${base}/journey?mode=car`)).status, 400)
    assert.equal((await fetch(`${base}/status`, { headers: { Origin: 'https://elsewhere.example' } })).status, 403)
    const roads = await fetch(`${base}/roads?${new URLSearchParams({ mode: 'walk', departure })}`)
    assert.equal(roads.status, 200)
    assert.equal((await roads.json()).routeImpact, 'unknown')
  } finally {
    child.kill()
  }
})
