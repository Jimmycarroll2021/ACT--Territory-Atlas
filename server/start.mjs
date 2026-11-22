import http from 'node:http'
import path from 'node:path'
import { readFile, realpath, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { journey, loadRoadNotices, parseTrip, status as commuteStatus } from './commute/api.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = path.join(root, 'dist')
const dev = process.argv.includes('--dev')
const port = Number(process.env.PORT || (dev ? 5173 : 4173))
const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]'].map(host => host + ':' + port))
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.geojson':'application/geo+json', '.woff2':'font/woff2', '.svg':'image/svg+xml', '.png':'image/png' }

function reply(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store, private', 'X-Content-Type-Options':'nosniff'})
  res.end(JSON.stringify(data))
}

let cached, modified
async function property(addressId) {
  const file = process.env.KINGSTON_PRIVATE_DATA_PATH
  if (!file) return null
  const resolved = await realpath(file)
  const relative = path.relative(root, resolved)
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw Error('Private data must be external')
  const stamp = (await stat(resolved)).mtimeMs
  if (!cached || stamp !== modified) {
    cached = JSON.parse(await readFile(resolved, 'utf8'))
    modified = stamp
  }
  const row = cached[addressId]
  if (!row || String(row.addressId) !== addressId) return null
  const scalar = v => typeof v === 'string' || typeof v === 'number' ? v : null
  const result = { addressId }
  for (const field of ['displayAddress','beds','baths','parking','featuresSource','featuresObservedAt']) result[field] = scalar(row[field])
  result.sales = Array.isArray(row.sales) ? row.sales.map(sale => Object.fromEntries(['date','price','source','matchStatus'].map(key=>[key,scalar(sale[key])]))) : []
  return result
}

const vite = dev ? await (await import('vite')).createServer({
  root, server:{middlewareMode:true, hmr:false, fs:{strict:true,allow:[root],deny:['**/.env','**/.env.*','**/.git/**','**/data/private-prep/**','**/server/**']}}
}) : null

const server = http.createServer(async (req, res) => {
  try {
    if (!allowedHosts.has(req.headers.host)) return reply(res,403,{error:'Local host required'})
    const url = new URL(req.url, 'http://' + req.headers.host)
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.origin && req.headers.origin !== url.origin || req.headers['sec-fetch-site'] === 'cross-site') return reply(res,403,{error:'Same-origin request required'})
      if (req.method !== 'GET') return reply(res,405,{error:'GET required'})
      if (url.pathname === '/api/commute/status') return reply(res,200,commuteStatus())
      if (url.pathname === '/api/commute/journey' || url.pathname === '/api/commute/roads') {
        const trip = parseTrip(url.searchParams,{requireCoordinates:url.pathname.endsWith('/journey')})
        if (trip.error) return reply(res,400,{error:trip.error})
        return reply(res,200,url.pathname.endsWith('/journey') ? journey(trip) : await loadRoadNotices(trip))
      }
      const match = /^\/api\/properties\/(\d{1,16})$/.exec(url.pathname)
      if (!match) return reply(res,404,{error:'Unknown resource'})
      let data
      try { data = await property(match[1]) } catch { return reply(res,503,{error:'Local profile unavailable'}) }
      return data ? reply(res,200,data) : reply(res,404,{error:'Profile unavailable'})
    }
    if (vite) return vite.middlewares(req, res)
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res,405,{error:'Unsupported method'})
    const resolved = path.resolve(dist, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
    if (!resolved.startsWith(dist + path.sep)) return reply(res,404,{error:'Unknown resource'})
    let body
    try { body = await readFile(resolved) } catch { return reply(res,404,{error:'Unknown resource'}) }
    res.writeHead(200,{'Content-Type':mime[path.extname(resolved)] || 'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'})
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch { if (!res.headersSent) reply(res,400,{error:'Invalid request'}) }
})
server.listen(port,'127.0.0.1',()=>console.log('Territory Atlas running at http://127.0.0.1:' + port))

