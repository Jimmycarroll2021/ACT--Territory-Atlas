import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'public/amenities/kingston.json')));
const addresses = JSON.parse(fs.readFileSync(path.join(root, 'public/geo/kingston-addresses.geojson')));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/amenities/manifest.json')));

function meters(a, b) {
  const rad = Math.PI / 180;
  const dy = (b[1] - a[1]) * rad;
  const dx = (b[0] - a[0]) * rad;
  const h = Math.sin(dy / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dx / 2) ** 2;
  return Math.round(12742000 * Math.asin(Math.sqrt(h)));
}

test('published extent, identities and category coverage are coherent', () => {
  assert.equal(snapshot.features.length, manifest.featureCount);
  assert.equal(Object.keys(snapshot.nearestByAddressId).length, manifest.addressCount);
  assert.equal(snapshot.routeDistanceAvailable, false);
  assert.equal(snapshot.schoolCatchmentAvailable, false);
  assert.equal(snapshot.entranceLocationsAvailable, false);
  const ids = new Set();
  const [west, south, east, north] = snapshot.area.bbox;
  for (const feature of snapshot.features) {
    assert.equal(feature.geometry.type, 'Point');
    assert.equal(feature.entranceKnown, false);
    assert.ok(feature.source?.url);
    assert.ok(!ids.has(feature.id), `duplicate ${feature.id}`);
    ids.add(feature.id);
    const [lon, lat] = feature.geometry.coordinates;
    assert.ok(lon >= west && lon <= east && lat >= south && lat <= north, feature.id);
  }
  for (const category of ['grocery', 'cafe', 'medical']) {
    assert.ok(manifest.categoryCounts[category] > 0);
    assert.equal(snapshot.categoryCoverage[category], 'osm_tagged_incomplete');
    assert.ok(snapshot.features.filter(feature => feature.category === category).every(feature => feature.source.licence === 'ODbL 1.0'));
  }
});

test('nearest distances match source ACT address coordinates and global minimum', () => {
  const byId = new Map(addresses.features.map(feature => [String(feature.properties.ADDRESS_ID), feature]));
  const byCategory = Map.groupBy(snapshot.features, feature => feature.category);
  for (const [id, categories] of Object.entries(snapshot.nearestByAddressId).filter((_, index) => index % 97 === 0)) {
    const point = byId.get(id)?.geometry.coordinates;
    assert.ok(point, id);
    for (const [category, nearest] of Object.entries(categories)) {
      const candidates = byCategory.get(category);
      assert.ok(candidates?.some(item => item.id === nearest.featureId));
      assert.equal(nearest.distanceMeters, Math.min(...candidates.map(item => meters(point, item.geometry.coordinates))), `${id} ${category}`);
    }
  }
});
