import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { ClosureStore } from '../src/closures.js';
import { decodePolyline, midpointAlong } from '../src/geo.js';

// Valhalla'nın gerçek locate cevabından alınmış bir kenar geometrisi.
const SHAPE = '_vggmAgc}gv@ooB?';

function fakeValhalla() {
  const calls = [];
  return {
    calls,
    status: async () => ({ version: 'test' }),
    locateEdge: async ({ lat, lon }) =>
      lat > 41.5
        ? { shapeEncoded: SHAPE, coordinates: decodePolyline(SHAPE), wayId: 7, names: ['Uzak Sk.'], distanceMeters: 500 }
        : { shapeEncoded: SHAPE, coordinates: decodePolyline(SHAPE), wayId: 7, names: ['Test Sk.'], distanceMeters: 3 },
    route: async (body) => {
      calls.push(body);
      return {
        trip: {
          summary: { length: 1.2, time: 120 },
          legs: [{ shape: SHAPE, maneuvers: [{ type: 1, instruction: 'Başla', length: 1.2, time: 120, begin_shape_index: 0, end_shape_index: 1 }] }],
        },
      };
    },
  };
}

async function withServer(fn) {
  const valhalla = fakeValhalla();
  const store = new ClosureStore(join(mkdtempSync(join(tmpdir(), 'nav-')), 'closures.json'));
  const app = createApp({ valhalla, store, adminToken: 'secret' });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const req = (path, { method = 'GET', body, token } = {}) =>
    fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) },
      body: body && JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    await fn({ req, valhalla, store });
  } finally {
    server.close();
  }
}

test('polyline6 çözümü ve orta nokta', () => {
  const coords = decodePolyline(SHAPE);
  assert.deepEqual(coords, [
    [41.03, 28.982340],
    [41.0318, 28.982340],
  ]);
  const [lat, lon] = midpointAlong(coords);
  assert.ok(Math.abs(lat - 41.0309) < 1e-9);
  assert.equal(lon, 28.98234);
});

test('kapatma yönetici anahtarı ister', async () => {
  await withServer(async ({ req }) => {
    const r = await req('/api/closures/toggle', { method: 'POST', body: { lat: 41.03, lon: 28.98 } });
    assert.equal(r.status, 401);
  });
});

test('dokun → kapat, tekrar dokun → aç; rota kapalı segmenti dışlar', async () => {
  await withServer(async ({ req, valhalla }) => {
    const closed = await req('/api/closures/toggle', { method: 'POST', token: 'secret', body: { lat: 41.031, lon: 28.9823 } });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.action, 'closed');
    assert.equal(closed.body.closure.name, 'Test Sk.');

    const list = await req('/api/closures');
    assert.equal(list.body.closures.length, 1);
    assert.equal(list.body.version, 1);

    const route = await req('/api/route', { method: 'POST', body: { from: { lat: 41.03, lon: 28.98 }, to: { lat: 41.04, lon: 28.99 } } });
    assert.equal(route.status, 200);
    assert.equal(route.body.closuresVersion, 1);
    const sent = valhalla.calls.at(-1);
    assert.equal(sent.exclude_polygons.length, 1);
    assert.equal(sent.directions_options.language, 'tr-TR');

    const opened = await req('/api/closures/toggle', { method: 'POST', token: 'secret', body: { lat: 41.031, lon: 28.9823 } });
    assert.equal(opened.body.action, 'opened');
    await req('/api/route', { method: 'POST', body: { from: { lat: 41.03, lon: 28.98 }, to: { lat: 41.04, lon: 28.99 } } });
    assert.equal(valhalla.calls.at(-1).exclude_polygons, undefined);
  });
});

test('yola uzak dokunuş ve İstanbul dışı noktalar reddedilir', async () => {
  await withServer(async ({ req }) => {
    const far = await req('/api/closures/toggle', { method: 'POST', token: 'secret', body: { lat: 41.55, lon: 28.9 } });
    assert.equal(far.status, 404);
    const ankara = await req('/api/route', { method: 'POST', body: { from: { lat: 39.93, lon: 32.85 }, to: { lat: 41.04, lon: 28.99 } } });
    assert.equal(ankara.status, 400);
  });
});

test('kapatmalar dosyaya yazılır ve yeniden yüklenir', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'nav-')), 'closures.json');
  const a = new ClosureStore(file);
  const c = a.add({ shapeEncoded: SHAPE, coordinates: decodePolyline(SHAPE), wayId: 1, names: [] });
  const b = new ClosureStore(file);
  assert.equal(b.version, 1);
  assert.equal(b.get(c.id).name, 'İsimsiz yol');
});

test('kayıtlı grup: kaydet → trafiğe aç → tekrar kapat → sil', async () => {
  await withServer(async ({ req, valhalla }) => {
    // Her dokunuş farklı bir segment döndürsün.
    valhalla.locateEdge = async ({ lat, lon }) => ({
      shapeEncoded: `seg-${lat}-${lon}`,
      coordinates: [[lat, lon], [lat + 0.001, lon]],
      wayId: 1,
      names: ['Bağdat Cd.'],
      distanceMeters: 2,
    });
    const route = async () => {
      await req('/api/route', { method: 'POST', body: { from: { lat: 41.03, lon: 28.98 }, to: { lat: 41.04, lon: 28.99 } } });
      return valhalla.calls.at(-1).exclude_polygons?.length ?? 0;
    };

    const empty = await req('/api/zones', { method: 'POST', token: 'secret', body: { name: 'Boş' } });
    assert.equal(empty.status, 400);

    for (const lon of [29.01, 29.02, 29.03]) {
      await req('/api/closures/toggle', { method: 'POST', token: 'secret', body: { lat: 40.97, lon } });
    }
    const created = await req('/api/zones', { method: 'POST', token: 'secret', body: { name: 'Maraton güzergâhı' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.zone.segments.length, 3);
    assert.equal(created.body.zone.active, true);

    let state = await req('/api/closures');
    assert.equal(state.body.closures.length, 3, 'grup kapalıyken segmentler rotadan çıkar');
    assert.ok(state.body.closures.every((c) => c.zoneName === 'Maraton güzergâhı'));
    assert.equal(await route(), 3);

    // Grubun bir segmentine tek tek dokunmak onu açmaz; grup üzerinden yönetilir.
    const tap = await req('/api/closures/toggle', { method: 'POST', token: 'secret', body: { lat: 40.97, lon: 29.01 } });
    assert.equal(tap.status, 409);

    const id = created.body.zone.id;
    const opened = await req(`/api/zones/${id}`, { method: 'PATCH', token: 'secret', body: { active: false } });
    assert.equal(opened.body.zone.active, false);
    state = await req('/api/closures');
    assert.equal(state.body.closures.length, 0);
    assert.equal(state.body.zones.length, 1);
    assert.equal(await route(), 0);

    await req(`/api/zones/${id}`, { method: 'PATCH', token: 'secret', body: { active: true } });
    assert.equal(await route(), 3);

    const noAuth = await req(`/api/zones/${id}`, { method: 'DELETE' });
    assert.equal(noAuth.status, 401);
    await req(`/api/zones/${id}`, { method: 'DELETE', token: 'secret' });
    state = await req('/api/closures');
    assert.equal(state.body.zones.length, 0);
    assert.equal(await route(), 0);
  });
});

test('gruplar dosyaya yazılır ve yeniden yüklenir', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'nav-')), 'closures.json');
  const a = new ClosureStore(file);
  a.add({ shapeEncoded: SHAPE, coordinates: decodePolyline(SHAPE), wayId: 1, names: ['Test Sk.'] });
  const zone = a.createZone('Pazar yeri');
  a.updateZone(zone.id, { active: false });
  const b = new ClosureStore(file);
  assert.equal(b.getZone(zone.id).name, 'Pazar yeri');
  assert.equal(b.getZone(zone.id).active, false);
  assert.equal(b.list().length, 0);
  assert.equal(b.effectiveClosures().length, 0);
});

test('tüm yolları tek seferde aç: tekiller silinir, gruplar kalır ama açılır', async () => {
  await withServer(async ({ req, valhalla }) => {
    valhalla.locateEdge = async ({ lat, lon }) => ({
      shapeEncoded: `seg-${lat}-${lon}`,
      coordinates: [[lat, lon], [lat + 0.001, lon]],
      wayId: 1,
      names: ['Test Cd.'],
      distanceMeters: 2,
    });
    const tap = (lon) => req('/api/closures/toggle', { method: 'POST', token: 'secret', body: { lat: 40.97, lon } });
    await tap(29.01);
    await tap(29.02);
    await req('/api/zones', { method: 'POST', token: 'secret', body: { name: 'Grup' } });
    await tap(29.03);
    let state = await req('/api/closures');
    assert.equal(state.body.closures.length, 3);

    const noAuth = await req('/api/closures/open-all', { method: 'POST' });
    assert.equal(noAuth.status, 401);

    const r = await req('/api/closures/open-all', { method: 'POST', token: 'secret' });
    assert.deepEqual([r.body.removed, r.body.zonesOpened], [1, 1]);
    state = await req('/api/closures');
    assert.equal(state.body.closures.length, 0);
    assert.equal(state.body.zones.length, 1);
    assert.equal(state.body.zones[0].active, false);
    await req('/api/route', { method: 'POST', body: { from: { lat: 41.03, lon: 28.98 }, to: { lat: 41.04, lon: 28.99 } } });
    assert.equal(valhalla.calls.at(-1).exclude_polygons, undefined);
  });
});
