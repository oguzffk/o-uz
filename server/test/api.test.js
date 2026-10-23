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

test('grup düzenleme: yol ekle, çıkar, yeniden adlandır', async () => {
  await withServer(async ({ req, valhalla }) => {
    valhalla.locateEdge = async ({ lat, lon }) => ({
      shapeEncoded: `seg-${lat}-${lon}`,
      coordinates: [[lat, lon], [lat + 0.001, lon]],
      wayId: 1,
      names: ['Pazar Sk.'],
      distanceMeters: 2,
    });
    await req('/api/closures/toggle', { method: 'POST', token: 'secret', body: { lat: 40.97, lon: 29.01 } });
    const { body } = await req('/api/zones', { method: 'POST', token: 'secret', body: { name: 'Pazar' } });
    const id = body.zone.id;
    const edit = (lon) => req(`/api/zones/${id}/toggle-segment`, { method: 'POST', token: 'secret', body: { lat: 40.97, lon } });

    const added = await edit(29.02);
    assert.equal(added.body.action, 'added');
    assert.equal(added.body.zone.segments.length, 2);

    // Kaydedilmemiş bir kapatma gruba eklenirse tekil listeden çıkar.
    await req('/api/closures/toggle', { method: 'POST', token: 'secret', body: { lat: 40.97, lon: 29.03 } });
    await edit(29.03);
    let state = await req('/api/closures');
    assert.equal(state.body.closures.length, 3);
    assert.ok(state.body.closures.every((c) => c.zoneId === id));

    const removed = await edit(29.01);
    assert.equal(removed.body.action, 'removed');
    assert.equal(removed.body.zone.segments.length, 2);

    const renamed = await req(`/api/zones/${id}`, { method: 'PATCH', token: 'secret', body: { name: 'Bağcılar pazarı' } });
    assert.equal(renamed.body.zone.name, 'Bağcılar pazarı');

    const missing = await req('/api/zones/yok/toggle-segment', { method: 'POST', token: 'secret', body: { lat: 40.97, lon: 29.01 } });
    assert.equal(missing.status, 404);
    const noAuth = await req(`/api/zones/${id}/toggle-segment`, { method: 'POST', body: { lat: 40.97, lon: 29.01 } });
    assert.equal(noAuth.status, 401);
  });
});

test('yoğun saat dönemleri İstanbul saatine göre', async () => {
  const { trafficPeriod, adjustedTime } = await import('../src/traffic.js');
  // 2026-10-26 Pazartesi. UTC saatleri: İstanbul = UTC+3.
  assert.equal(trafficPeriod(new Date('2026-10-26T05:30:00Z')).key, 'peak'); // 08:30
  assert.equal(trafficPeriod(new Date('2026-10-26T15:00:00Z')).key, 'peak'); // 18:00
  assert.equal(trafficPeriod(new Date('2026-10-26T10:00:00Z')).key, 'busy'); // 13:00
  assert.equal(trafficPeriod(new Date('2026-10-26T23:00:00Z')).key, 'night'); // 02:00 Salı
  assert.equal(trafficPeriod(new Date('2026-10-25T15:00:00Z')).key, 'busy'); // Pazar 18:00
  assert.equal(trafficPeriod(new Date('2026-10-25T05:30:00Z')).key, 'normal'); // Pazar 08:30
  // Hızlı yol yoğun saatte sokaktan daha çok yavaşlar; gece değişmez.
  assert.equal(adjustedTime(10, 600, 'peak'), 1200); // 60 km/sa → ×2
  assert.equal(adjustedTime(1, 180, 'peak'), 180 * 1.3); // 20 km/sa → ×1.3
  assert.equal(adjustedTime(10, 600, 'night'), 600);
});

test('alternatif rotalar: istenirse gelir, yoğun saat süresine göre sıralanır, kapatmalar hepsine uygulanır', async () => {
  await withServer(async ({ req, valhalla }) => {
    const trip = (km, sec, shape = SHAPE) => ({
      summary: { length: km, time: sec },
      legs: [{ shape, maneuvers: [{ type: 1, instruction: 'Başla', length: km, time: sec, begin_shape_index: 0, end_shape_index: 1 }] }],
    });
    valhalla.route = async (body) => {
      valhalla.calls.push(body);
      // Ana rota otoyol (hızlı ama yoğun saatte çok yavaşlar), alternatif ara yol.
      return { trip: trip(10, 600), ...(body.alternates ? { alternates: [{ trip: trip(6, 720) }] } : {}) };
    };
    await req('/api/closures/toggle', { method: 'POST', token: 'secret', body: { lat: 41.031, lon: 28.9823 } });
    const body = { from: { lat: 41.03, lon: 28.98 }, to: { lat: 41.04, lon: 28.99 } };

    const single = await req('/api/route', { method: 'POST', body });
    assert.equal(valhalla.calls.at(-1).alternates, undefined);
    assert.equal(single.body.routes.length, 1);

    const night = await req('/api/route', { method: 'POST', body: { ...body, alternatives: true, departAt: '2026-10-26T23:00:00Z' } });
    assert.equal(valhalla.calls.at(-1).alternates, 2);
    assert.equal(valhalla.calls.at(-1).exclude_polygons.length, 1);
    assert.equal(night.body.traffic.key, 'night');
    assert.deepEqual(night.body.routes.map((r) => r.distanceKm), [10, 6]); // gece otoyol daha hızlı

    const peak = await req('/api/route', { method: 'POST', body: { ...body, alternatives: true, departAt: '2026-10-26T15:00:00Z' } });
    assert.equal(peak.body.traffic.key, 'peak');
    assert.deepEqual(peak.body.routes.map((r) => r.distanceKm), [6, 10]); // yoğun saatte ara yol öne geçer
    assert.equal(peak.body.distanceKm, 6);
    assert.equal(peak.body.routes[1].durationSec, 1200);
    assert.equal(peak.body.routes[1].freeFlowDurationSec, 600);
  });
});

test('ücretli yollardan kaçın: Valhalla use_tolls=0 alır, rota ücretli yol içeriyorsa belirtilir', async () => {
  await withServer(async ({ req, valhalla }) => {
    valhalla.route = async (body) => {
      valhalla.calls.push(body);
      return {
        trip: {
          summary: { length: 5, time: 400, has_toll: !body.costing_options },
          legs: [{ shape: SHAPE, maneuvers: [{ type: 1, instruction: 'Başla', length: 5, time: 400, begin_shape_index: 0, end_shape_index: 1 }] }],
        },
      };
    };
    const body = { from: { lat: 41.03, lon: 28.98 }, to: { lat: 41.04, lon: 28.99 }, costing: 'motorcycle' };
    const normal = await req('/api/route', { method: 'POST', body });
    assert.equal(valhalla.calls.at(-1).costing_options, undefined);
    assert.equal(normal.body.hasToll, true);
    assert.equal(normal.body.avoidTolls, false);

    const avoid = await req('/api/route', { method: 'POST', body: { ...body, avoidTolls: true } });
    assert.deepEqual(valhalla.calls.at(-1).costing_options, { motorcycle: { use_tolls: 0 } });
    assert.equal(avoid.body.hasToll, false);
    assert.equal(avoid.body.avoidTolls, true);
  });
});

test('Türkçe talimatlarda "Caddesi caddesine" tekrarı düzeltilir', async () => {
  const { fixStreetSuffixes: f } = await import('../src/turkish.js');
  assert.equal(f('Atatürk Caddesi caddesine doğru sola dönün.'), "Atatürk Caddesi'ne doğru sola dönün.");
  assert.equal(f('Lale Sokak caddesinde kuzey yönüne doğru sürün.'), "Lale Sokak'ta kuzey yönüne doğru sürün.");
  assert.equal(f('Vatan Cd. caddesine girin'), "Vatan Caddesi'ne girin");
  assert.equal(f('E-5 Yolu caddesinde kalmak için sola'), "E-5 Yolu'nda kalmak için sola");
  assert.equal(f('İSTİKLAL CADDESİ caddesine'), "İSTİKLAL CADDESİ'ne");
  assert.equal(f('Bağdat caddesine doğru sağa dönün.'), 'Bağdat caddesine doğru sağa dönün.');
  assert.equal(f('15 Temmuz Şehitler Köprüsü caddesi üzerinden'), '15 Temmuz Şehitler Köprüsü üzerinden');
  assert.equal(f(null), null);
});
