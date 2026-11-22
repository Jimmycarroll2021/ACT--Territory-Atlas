// Server-only ATDW integration seam. No licensed response is persisted here.
export const OFFICIAL_CALENDAR = 'https://visitcanberra.com.au/events'
export const ATDW_SEARCH = 'https://atlas.atdw-online.com.au/api/atlas/products'

export function accessState(env = process.env) {
  if (env.ATDW_DISTRIBUTOR_LICENSE_ACCEPTED !== '1') return 'access-required'
  if (!env.ATDW_API_KEY?.trim()) return 'access-required'
  return 'configured-unverified'
}

export function unavailableSnapshot() {
  return {
    schemaVersion: 1,
    status: 'access-required',
    asOf: null,
    expiresAt: null,
    sourceName: 'VisitCanberra',
    sourceUrl: OFFICIAL_CALENDAR,
    coverage: 'A Kingston events feed requires licensed ATDW distributor access. Check the official calendar for current events.',
    events: [],
  }
}

// Construction is gated to prevent accidental calls with trial or unlicensed access.
// Never log, serialize, or send this URL to a browser: ATDW uses a query-string key.
export function buildSearchUrl({ startDate, endDate, env = process.env }) {
  if (accessState(env) !== 'configured-unverified') throw new Error('ATDW distributor access required')
  for (const date of [startDate, endDate]) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(Date.parse(date + 'T00:00:00Z')) ||
        new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) {
      throw new Error('Valid ISO dates required')
    }
  }
  if (startDate > endDate) throw new Error('Date range reversed')
  const url = new URL(ATDW_SEARCH)
  url.search = new URLSearchParams({
    key: env.ATDW_API_KEY.trim(), cats: 'EVENT', st: 'ACT', ct: 'Kingston',
    start: startDate, end: endDate, out: 'json', size: '50', pge: '1',
  }).toString()
  return url
}

// A publication parser is deliberately absent until the licensed response shape,
// redistribution terms, attribution and tracking requirements are verified.
