import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { accessState, buildSearchUrl, unavailableSnapshot } from '../../server/events/atdw.mjs'

const key = 'synthetic-secret-for-test-only'

test('the public snapshot reports unavailable access and contains no event claims', async () => {
  const published = JSON.parse(await readFile(new URL('../../public/events/kingston.json', import.meta.url)))
  assert.deepEqual(published, unavailableSnapshot())
  assert.equal(published.status, 'access-required')
  assert.deepEqual(published.events, [])
  assert.equal(published.asOf, null)
  assert.equal(published.expiresAt, null)
  assert.equal(new URL(published.sourceUrl).protocol, 'https:')
  assert.ok(!JSON.stringify(published).includes(key))
})

test('licence and credential are both required before constructing a request', () => {
  assert.equal(accessState({}), 'access-required')
  assert.equal(accessState({ ATDW_API_KEY: key }), 'access-required')
  assert.equal(accessState({ ATDW_DISTRIBUTOR_LICENSE_ACCEPTED: '1' }), 'access-required')
  assert.throws(() => buildSearchUrl({ startDate: '2026-11-22', endDate: '2026-11-29', env: { ATDW_API_KEY: key } }), /access required/)
})

test('a gated request uses documented event, place, date and JSON filters', () => {
  const env = { ATDW_DISTRIBUTOR_LICENSE_ACCEPTED: '1', ATDW_API_KEY: key }
  const url = buildSearchUrl({ startDate: '2026-11-22', endDate: '2026-11-29', env })
  assert.equal(url.origin, 'https://atlas.atdw-online.com.au')
  assert.equal(url.pathname, '/api/atlas/products')
  for (const [field, value] of Object.entries({ cats: 'EVENT', st: 'ACT', ct: 'Kingston', start: '2026-11-22', end: '2026-11-29', out: 'json' })) {
    assert.equal(url.searchParams.get(field), value)
  }
  assert.equal(url.searchParams.get('key'), key)
  assert.throws(() => buildSearchUrl({ startDate: '2026-11-30', endDate: '2026-11-29', env }), /reversed/)
  assert.throws(() => buildSearchUrl({ startDate: 'not a date', endDate: '2026-11-29', env }), /ISO dates/)
  assert.throws(() => buildSearchUrl({ startDate: '2026-02-31', endDate: '2026-11-29', env }), /ISO dates/)
})
