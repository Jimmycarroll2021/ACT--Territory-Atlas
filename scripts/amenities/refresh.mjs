import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, 'public/amenities/kingston.json');
const manifestPath = path.join(root, 'data/amenities/manifest.json');
const osmCapturePath = path.join(root, 'data/amenities/osm-capture.json');
const addressPath = path.join(root, 'public/geo/kingston-addresses.geojson');
const box = { south: -35.340, west: 149.114, north: -35.289, east: 149.177 };
const capturedAtUtc = new Date().toISOString();
const check = process.argv.includes('--check');

function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const value = await response.json();
  if (value.error) throw new Error(`${JSON.stringify(value.error)} ${url}`);
  return value;
}
function pointOf(geometry) {
  if (geometry?.type === 'Point') return geometry.coordinates;
  const positions = [];
  function visit(value) { if (typeof value?.[0] === 'number') positions.push(value); else if (Array.isArray(value)) value.forEach(visit); }
  visit(geometry?.coordinates);
  if (!positions.length) return null;
  const longitudes = positions.map(p => p[0]);
  const latitudes = positions.map(p => p[1]);
  return [(Math.min(...longitudes) + Math.max(...longitudes)) / 2, (Math.min(...latitudes) + Math.max(...latitudes)) / 2];
}
function inside([lon, lat]) { return lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north; }
function distance(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}
const catalogue = {
  open_space: { id: '5w5c-3ghz', name: 'ACTGOV Urban Open Space Asset', where: "asset_sub_type in('NEIGHBOURHOOD PARK','DISTRICT PARK','PEDESTRIAN PARKLAND','SEMI NATURAL OPEN SPACE','URBAN PEDESTRIAN AREA')" },
  path: { id: 'eu7q-i9jx', name: 'ACTGOV Community Path Assets', where: "asset_sub_type in('CYCLEPATH','SEPARATED CYCLEPATH')" },
  playground: { id: 'e4ug-7r3x', name: 'ACTGOV Playground Assets' },
  drinking_fountain: { id: 'xfiz-thuk', name: 'ACTGOV Drinking Fountain Assets' },
};
async function socrata(category, spec) {
  const where = [`within_box(the_geom, ${box.north}, ${box.west}, ${box.south}, ${box.east})`, "operational_state='ACTIVE'", spec.where].filter(Boolean).join(' and ');
  const results = [];
  const urls = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`https://www.data.act.gov.au/resource/${spec.id}.json`);
    url.search = new URLSearchParams({ $where: where, $order: 'objectid', $limit: '1000', $offset: String(offset) });
    const page = await json(url);
    if (!Array.isArray(page)) throw new Error(`${category} returned non-array`);
    urls.push(url.toString());
    results.push(...page);
    if (page.length < 1000) break;
  }
  const features = results.map(row => {
    const coordinates = pointOf(row.the_geom);
    if (!coordinates || !inside(coordinates)) return null;
    return {
      id: `${category}:${row.asset_id ?? row.objectid}`, category,
      name: row.asset_name || row.location || category.replace('_', ' '),
      geometry: { type: 'Point', coordinates },
      coordinateConfidence: row.the_geom?.type === 'Point' ? 'source_point' : 'geometry_bbox_center',
      entranceKnown: false,
      source: { publisher: 'ACT Government', dataset: spec.name, url: `https://www.data.act.gov.au/d/${spec.id}`, licence: 'See ACT Open Data dataset terms' },
      properties: { assetId: row.asset_id ?? null, subtype: row.asset_sub_type ?? null, suburb: row.suburb ?? null, operationalState: row.operational_state ?? null, sourceGeometryType: row.the_geom?.type ?? null, lastEditedUtc: row.last_edited_date ?? null }
    };
  }).filter(Boolean);
  return { features, receipt: { category, sourceUrls: urls, sourceRowCount: results.length, retainedCount: features.length, filter: where } };
}
async function busStops() {
  const base = 'https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services/Transport_Canberra_Bus_Stop_view/FeatureServer/1';
  const metadata = await json(`${base}?f=json`);
  const url = new URL(`${base}/query`);
  url.search = new URLSearchParams({ f: 'geojson', geometry: `${box.west},${box.south},${box.east},${box.north}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', where: '1=1', outFields: 'OBJECTID,BUS_STOP_ID,BUS_STOP_NAME', outSR: '4326', resultRecordCount: '2000' });
  const data = await json(url);
  if (!Array.isArray(data.features) || data.features.length >= 2000 || data.exceededTransferLimit) throw new Error('Bus stop response missing or truncated');
  const features = data.features.map(row => ({
    id: `bus_stop:${row.properties.BUS_STOP_ID ?? row.properties.OBJECTID}`, category: 'bus_stop',
    name: row.properties.BUS_STOP_NAME || 'Bus stop', geometry: row.geometry,
    coordinateConfidence: 'source_point', entranceKnown: false,
    source: { publisher: 'Transport Canberra / ACT Government', dataset: 'Transport Canberra Bus Stop view', url: base, licence: 'CC BY 4.0' },
    properties: { stopId: row.properties.BUS_STOP_ID ?? null, sourceObjectId: row.properties.OBJECTID }
  })).filter(row => row.geometry?.type === 'Point' && inside(row.geometry.coordinates));
  return { features, receipt: { category: 'bus_stop', sourceUrls: [url.toString()], sourceRowCount: data.features.length, retainedCount: features.length, sourceDataEditedAtUtc: metadata.editingInfo?.dataLastEditDate ? new Date(metadata.editingInfo.dataLastEditDate).toISOString() : null } };
}
async function schools() {
  const url = 'https://www.act.gov.au/education-and-training/find-a-school-and-enrol/list-of-act-public-schools';
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`School directory ${response.status}`);
  const html = await response.text();
  const sections = html.split('<div class="act-search-result result">').slice(1);
  const features = [];
  for (const section of sections) {
    const title = section.match(/act-search-result__title[\s\S]*?<a href="([^"]+)"[^>]*>([^<]+)<\/a>/);
    const map = section.match(/<iframe[^>]*src="([^"]+)"/);
    const coords = map?.[1]?.match(/!2d(-?[\d.]+)!3d(-?[\d.]+)/);
    if (!title || !coords) continue;
    const coordinates = [Number(coords[1]), Number(coords[2])];
    if (!inside(coordinates)) continue;
    const address = section.match(/Address:<br \/><\/strong>([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? null;
    const level = section.match(/School level: <\/strong>([^<]+)/)?.[1]?.trim() ?? null;
    features.push({ id: `school:${title[2].toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, category: 'school', name: title[2], geometry: { type: 'Point', coordinates }, coordinateConfidence: 'official_page_map_approximate', entranceKnown: false, source: { publisher: 'ACT Education Directorate', dataset: 'List of ACT public schools', url, licence: 'ACT Government website terms' }, properties: { address, level, schoolUrl: title[1] } });
  }
  if (!features.length) throw new Error('No schools parsed from official directory');
  return { features, receipt: { category: 'school', sourceUrls: [url], sourceRowCount: sections.length, retainedCount: features.length, method: 'Official school cards, embedded map coordinates; approximate map points, not entrance or catchment' } };
}
async function osmAmenities() {
  const query = '[out:json][timeout:25];(nwr[shop~"^(supermarket|convenience|greengrocer)$"](-35.340,149.114,-35.289,149.177);nwr[amenity=cafe](-35.340,149.114,-35.289,149.177);nwr[amenity~"^(pharmacy|doctors|clinic|hospital)$"](-35.340,149.114,-35.289,149.177););out center tags;';
  const url = `https://ovp.dresel.systems/api-oc/interpreter?data=${encodeURIComponent(query)}`;
  let capture;
  if (process.argv.includes('--use-saved-osm')) {
    capture = JSON.parse(fs.readFileSync(osmCapturePath));
    if (capture.requestUrl !== url) throw new Error('Saved OSM query differs from current query');
  } else {
    const response = await fetch(url, { headers: { 'User-Agent': 'TerritoryAtlasAmenities/1.0 (Kingston public amenity snapshot)' }, signal: AbortSignal.timeout(30000) });
    const body = await response.text();
    if (!response.ok) throw new Error(`OSM ${response.status}: ${body.slice(0, 160)}`);
    const data = JSON.parse(body);
    if (!Array.isArray(data.elements) || !data.osm3s?.timestamp_osm_base) throw new Error('OSM response incomplete');
    capture = { capturedAtUtc: new Date().toISOString(), requestUrl: url, osmBaseTimestampUtc: data.osm3s.timestamp_osm_base, elements: data.elements };
    fs.writeFileSync(osmCapturePath, stable(capture));
  }
  const features = capture.elements.map(element => {
    const category = element.tags?.shop ? 'grocery' : element.tags?.amenity === 'cafe' ? 'cafe' : 'medical';
    const lon = element.lon ?? element.center?.lon;
    const lat = element.lat ?? element.center?.lat;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !inside([lon, lat])) return null;
    return {
      id: `${category}:osm:${element.type}/${element.id}`, category,
      name: element.tags.name || `${category.replace('_', ' ')} (unnamed)`,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      coordinateConfidence: element.type === 'node' ? 'osm_node' : 'osm_geometry_center',
      entranceKnown: false,
      source: { publisher: 'OpenStreetMap contributors', dataset: 'OpenStreetMap', url: `https://www.openstreetmap.org/${element.type}/${element.id}`, licence: 'ODbL 1.0' },
      properties: { osmType: element.type, osmId: element.id, subtype: element.tags.shop ?? element.tags.amenity ?? null, address: [element.tags['addr:housenumber'], element.tags['addr:street']].filter(Boolean).join(' ') || null, website: element.tags.website ?? null }
    };
  }).filter(Boolean);
  return { features, receipt: { category: 'osm_daily_life', sourceUrls: [url], sourceRowCount: capture.elements.length, retainedCount: features.length, capturedAtUtc: capture.capturedAtUtc, osmBaseTimestampUtc: capture.osmBaseTimestampUtc, savedCaptureFile: 'data/amenities/osm-capture.json', savedCaptureSha256: sha(fs.readFileSync(osmCapturePath)), coverage: 'OSM tagged objects in rectangular extent; incomplete and community maintained' } };
}
function nearest(addresses, features) {
  const byCategory = Map.groupBy(features, feature => feature.category);
  const result = {};
  for (const address of addresses.features) {
    const id = address.properties?.ADDRESS_ID;
    const point = address.geometry?.coordinates;
    if (id == null || !point || point.length !== 2) continue;
    const categories = {};
    for (const [category, items] of byCategory) {
      let best = null;
      for (const item of items) {
        const meters = distance(point, item.geometry.coordinates);
        if (!best || meters < best.distanceMeters) best = { featureId: item.id, distanceMeters: meters };
      }
      if (best) categories[category] = best;
    }
    result[String(id)] = categories;
  }
  return result;
}
function stable(value) { return JSON.stringify(value) + '\n'; }

if (check) {
  const publicBytes = fs.readFileSync(output);
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  const snapshot = JSON.parse(publicBytes);
  if (sha(publicBytes) !== manifest.publicSha256) throw new Error('Public snapshot hash differs from manifest');
  if (snapshot.features.length !== manifest.featureCount) throw new Error('Feature count differs from manifest');
  if (Object.keys(snapshot.nearestByAddressId).length !== manifest.addressCount) throw new Error('Address count differs from manifest');
  console.log(`Verified ${snapshot.features.length} features, ${manifest.addressCount} addresses, SHA-256 ${manifest.publicSha256}`);
} else {
  const captured = await Promise.all([schools(), busStops(), ...Object.entries(catalogue).map(([category, spec]) => socrata(category, spec)), osmAmenities()]);
  const features = captured.flatMap(item => item.features).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(features.map(feature => feature.id)).size !== features.length) throw new Error('Duplicate feature IDs');
  const addresses = JSON.parse(fs.readFileSync(addressPath));
  const snapshot = {
    schemaVersion: 1, capturedAtUtc,
    area: { name: 'Kingston and surrounding area', bbox: [box.west, box.south, box.east, box.north], bufferDescription: 'Approximately 2 km beyond the Kingston division bounding box; rectangular extent' },
    distanceMethod: 'WGS 84 haversine straight-line distance from ACT address point to amenity point or geometry bounding-box centre',
    routeDistanceAvailable: false, schoolCatchmentAvailable: false, entranceLocationsAvailable: false,
    categoryCoverage: { school: 'official_directory', bus_stop: 'ACT_view_last_edited_2024_verify_current_service', open_space: 'official_asset_register', path: 'official_cyclepath_assets_only', playground: 'official_asset_register', drinking_fountain: 'official_asset_register', grocery: 'osm_tagged_incomplete', cafe: 'osm_tagged_incomplete', medical: 'osm_tagged_incomplete' },
    features, nearestByAddressId: nearest(addresses, features)
  };
  const bytes = stable(snapshot);
  const manifest = { schemaVersion: 1, capturedAtUtc, publicFile: 'public/amenities/kingston.json', publicSha256: sha(bytes), featureCount: features.length, addressCount: Object.keys(snapshot.nearestByAddressId).length, categoryCounts: Object.fromEntries(Object.entries(snapshot.categoryCoverage).map(([key]) => [key, features.filter(feature => feature.category === key).length])), sourceReceipts: captured.map(item => item.receipt), addressSource: 'public/geo/kingston-addresses.geojson', addressSourceSha256: sha(fs.readFileSync(addressPath)) };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(output, bytes);
  fs.writeFileSync(manifestPath, stable(manifest));
  console.log(`Saved ${features.length} features, ${manifest.addressCount} addresses, SHA-256 ${manifest.publicSha256}`);
}
