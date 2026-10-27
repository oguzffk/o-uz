import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { ClosureStore } from '../src/closures.js';
import { UserStore } from '../src/users.js';
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

// Her test kendi sunucusunu kurar: bir sahip ve bir yönetici hesabı açılır, istekler varsayılan
// olarak yöneticinin oturumuyla gider (`token: null` oturumsuz, `token: x` başka oturum).
async function withServer(fn, { now, mailer: customMailer, revenuecat = { webhookAuth: 'rc-gizli', allowSandbox: false } } = {}) {
  const valhalla = fakeValhalla();
  const dir = mkdtempSync(join(tmpdir(), 'nav-'));
  const store = new ClosureStore(join(dir, 'closures.json'));
  const clock = { t: Date.parse('2026-10-25T09:00:00Z') };
  const users = new UserStore(join(dir, 'users.json'), { now: now ?? (() => clock.t) });
  const mail = []; // gönderilen giriş kodları
  const mailer = customMailer ?? { configured: true, sendLoginCode: async (to, code) => mail.push({ to, code }) };
  const app = createApp({ valhalla, store, users, mailer, revenuecat, now: now ?? (() => clock.t) });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const raw = (path, { method = 'GET', body, token } = {}) =>
    fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body && JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
  // Hesap açıp ilk şifreyi değiştirerek oturum anahtarı döndürür.
  const account = async (role, phone) => {
    const created =
      role === 'owner' ? users.ensureOwner({ phone, password: 'sahip-sifre' }) : users.create({ name: role, phone, email: `${role}@test.tr`, role });
    const password = created.tempPassword ?? 'sahip-sifre';
    const { body } = await raw('/api/auth/login', { method: 'POST', body: { phone, password } });
    if (body.user.mustChangePassword) await raw('/api/auth/password', { method: 'POST', token: body.token, body: { newPassword: 'yeni-sifre' } });
    return body.token;
  };
  const ownerToken = await account('owner', '05000000000');
  const adminToken = await account('admin', '05000000001');
  const req = (path, opts = {}) => raw(path, { ...opts, token: 'token' in opts ? opts.token : adminToken });
  // E-posta koduyla giriş: kod istenir, "gelen kutusundan" alınıp girilir.
  const emailLogin = async (email) => {
    const sent = await raw('/api/auth/email-code', { method: 'POST', body: { email } });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const code = mail.filter((m) => m.to === email.trim().toLowerCase()).at(-1)?.code;
    return raw('/api/auth/email-login', { method: 'POST', body: { email, code } });
  };
  try {
    await fn({ req, valhalla, store, users, ownerToken, adminToken, clock, raw, mail, emailLogin, base });
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

test('kapatma oturum ister', async () => {
  await withServer(async ({ req }) => {
    const r = await req('/api/closures/toggle', { method: 'POST', token: null, body: { lat: 41.03, lon: 28.98 } });
    assert.equal(r.status, 401);
  });
});

test('dokun → kapat, tekrar dokun → aç; rota kapalı segmenti dışlar', async () => {
  await withServer(async ({ req, valhalla }) => {
    const closed = await req('/api/closures/toggle', { method: 'POST', body: { lat: 41.031, lon: 28.9823 } });
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

    const opened = await req('/api/closures/toggle', { method: 'POST', body: { lat: 41.031, lon: 28.9823 } });
    assert.equal(opened.body.action, 'opened');
    await req('/api/route', { method: 'POST', body: { from: { lat: 41.03, lon: 28.98 }, to: { lat: 41.04, lon: 28.99 } } });
    assert.equal(valhalla.calls.at(-1).exclude_polygons, undefined);
  });
});

test('yola uzak dokunuş ve İstanbul dışı noktalar reddedilir', async () => {
  await withServer(async ({ req }) => {
    const far = await req('/api/closures/toggle', { method: 'POST', body: { lat: 41.55, lon: 28.9 } });
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

    const empty = await req('/api/zones', { method: 'POST', body: { name: 'Boş' } });
    assert.equal(empty.status, 400);

    for (const lon of [29.01, 29.02, 29.03]) {
      await req('/api/closures/toggle', { method: 'POST', body: { lat: 40.97, lon } });
    }
    const created = await req('/api/zones', { method: 'POST', body: { name: 'Maraton güzergâhı' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.zone.segments.length, 3);
    assert.equal(created.body.zone.active, true);

    let state = await req('/api/closures');
    assert.equal(state.body.closures.length, 3, 'grup kapalıyken segmentler rotadan çıkar');
    assert.ok(state.body.closures.every((c) => c.zoneName === 'Maraton güzergâhı'));
    assert.equal(await route(), 3);

    // Grubun bir segmentine tek tek dokunmak onu açmaz; grup üzerinden yönetilir.
    const tap = await req('/api/closures/toggle', { method: 'POST', body: { lat: 40.97, lon: 29.01 } });
    assert.equal(tap.status, 409);

    const id = created.body.zone.id;
    const opened = await req(`/api/zones/${id}`, { method: 'PATCH', body: { active: false } });
    assert.equal(opened.body.zone.active, false);
    state = await req('/api/closures');
    assert.equal(state.body.closures.length, 0);
    assert.equal(state.body.zones.length, 1);
    assert.equal(await route(), 0);

    await req(`/api/zones/${id}`, { method: 'PATCH', body: { active: true } });
    assert.equal(await route(), 3);

    const noAuth = await req(`/api/zones/${id}`, { token: null, method: 'DELETE' });
    assert.equal(noAuth.status, 401);
    await req(`/api/zones/${id}`, { method: 'DELETE' });
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
    const tap = (lon) => req('/api/closures/toggle', { method: 'POST', body: { lat: 40.97, lon } });
    await tap(29.01);
    await tap(29.02);
    await req('/api/zones', { method: 'POST', body: { name: 'Grup' } });
    await tap(29.03);
    let state = await req('/api/closures');
    assert.equal(state.body.closures.length, 3);

    const noAuth = await req('/api/closures/open-all', { token: null, method: 'POST' });
    assert.equal(noAuth.status, 401);

    const r = await req('/api/closures/open-all', { method: 'POST' });
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
    await req('/api/closures/toggle', { method: 'POST', body: { lat: 40.97, lon: 29.01 } });
    const { body } = await req('/api/zones', { method: 'POST', body: { name: 'Pazar' } });
    const id = body.zone.id;
    const edit = (lon) => req(`/api/zones/${id}/toggle-segment`, { method: 'POST', body: { lat: 40.97, lon } });

    const added = await edit(29.02);
    assert.equal(added.body.action, 'added');
    assert.equal(added.body.zone.segments.length, 2);

    // Kaydedilmemiş bir kapatma gruba eklenirse tekil listeden çıkar.
    await req('/api/closures/toggle', { method: 'POST', body: { lat: 40.97, lon: 29.03 } });
    await edit(29.03);
    let state = await req('/api/closures');
    assert.equal(state.body.closures.length, 3);
    assert.ok(state.body.closures.every((c) => c.zoneId === id));

    const removed = await edit(29.01);
    assert.equal(removed.body.action, 'removed');
    assert.equal(removed.body.zone.segments.length, 2);

    const renamed = await req(`/api/zones/${id}`, { method: 'PATCH', body: { name: 'Bağcılar pazarı' } });
    assert.equal(renamed.body.zone.name, 'Bağcılar pazarı');

    const missing = await req('/api/zones/yok/toggle-segment', { method: 'POST', body: { lat: 40.97, lon: 29.01 } });
    assert.equal(missing.status, 404);
    const noAuth = await req(`/api/zones/${id}/toggle-segment`, { token: null, method: 'POST', body: { lat: 40.97, lon: 29.01 } });
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
    await req('/api/closures/toggle', { method: 'POST', body: { lat: 41.031, lon: 28.9823 } });
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

test('rota bulunamazsa hedef en yakın halka açık / ana yola bağlanarak tekrar denenir', async () => {
  const { ValhallaError } = await import('../src/valhalla.js');
  await withServer(async ({ req, valhalla }) => {
    const ok = {
      trip: {
        summary: { length: 30, time: 1800 },
        legs: [{ shape: SHAPE, maneuvers: [{ type: 1, instruction: 'Başla', length: 30, time: 1800, begin_shape_index: 0, end_shape_index: 1 }] }],
      },
    };
    const noPath = () => new ValhallaError('No path could be found for input', 400, { error_code: 442 });
    // Havalimanı gibi: düz istek başarısız, servis yolları hariç tutulunca başarılı.
    valhalla.route = async (body) => {
      valhalla.calls.push(body);
      if (!body.locations[1].search_filter) throw noPath();
      return ok;
    };
    const body = { from: { lat: 41.03, lon: 28.98 }, to: { lat: 41.27, lon: 28.75 } };
    const r = await req('/api/route', { method: 'POST', body });
    assert.equal(r.status, 200);
    assert.equal(r.body.snappedToRoad, true);
    assert.deepEqual(valhalla.calls.at(-1).locations[1].search_filter, { min_road_class: 'residential' });

    // Hiçbir deneme tutmazsa: kapalı yol yokken kapalı yolları suçlamayan mesaj.
    valhalla.route = async (b) => {
      valhalla.calls.push(b);
      throw noPath();
    };
    const fail = await req('/api/route', { method: 'POST', body });
    assert.equal(fail.status, 400);
    assert.match(fail.body.error, /araçla gidilebilen bir yol bulunamadı/);
    assert.equal(valhalla.calls.at(-1).locations[1].search_filter.min_road_class, 'tertiary');

    // Kapalı yol varsa mesaj onları da anar.
    await req('/api/closures/toggle', { method: 'POST', body: { lat: 41.031, lon: 28.9823 } });
    const fail2 = await req('/api/route', { method: 'POST', body });
    assert.match(fail2.body.error, /Kapalı yollar/);

    // Normal başarılı rotada yedek kullanılmaz.
    valhalla.route = async (b) => {
      valhalla.calls.push(b);
      return ok;
    };
    const normal = await req('/api/route', { method: 'POST', body });
    assert.equal(normal.body.snappedToRoad, false);
  });
});

test('ara durak: duraklar Valhalla\'ya "break" olarak gider, bacaklar tek çizgide birleşir', async () => {
  await withServer(async ({ req, valhalla }) => {
    const leg = (arrive) => ({
      shape: SHAPE,
      maneuvers: [
        { type: 1, instruction: 'Başla', length: 0.2, time: 20, begin_shape_index: 0, end_shape_index: 1 },
        { type: arrive, instruction: 'Hedefinize vardınız.', length: 0, time: 0, begin_shape_index: 1, end_shape_index: 1 },
      ],
    });
    valhalla.route = async (body) => {
      valhalla.calls.push(body);
      return { trip: { summary: { length: 0.4, time: 40 }, legs: [leg(4), leg(5)] } };
    };
    const via = [{ lat: 41.035, lon: 28.985 }];
    const r = await req('/api/route', {
      method: 'POST',
      body: { from: { lat: 41.03, lon: 28.98 }, via, to: { lat: 41.04, lon: 28.99 }, alternatives: true },
    });
    assert.equal(r.status, 200);
    const call = valhalla.calls.at(-1);
    assert.equal(call.locations.length, 3);
    assert.deepEqual(call.locations[1], { ...via[0], type: 'break' });
    assert.equal(call.alternates, undefined); // duraklı rotada alternatif yok
    assert.equal(r.body.coordinates.length, 4);
    assert.deepEqual(r.body.stops, [{ shapeIndex: 1 }]);
    assert.deepEqual(r.body.maneuvers.map((m) => m.beginShapeIndex), [0, 1, 2, 3]);
    assert.equal(r.body.maneuvers[1].instruction, '1. ara durağa varış');
    assert.equal(r.body.maneuvers[1].stop, 1);
    assert.equal(r.body.maneuvers[3].instruction, 'Hedefinize vardınız.'); // son varış dokunulmaz

    const tooMany = await req('/api/route', {
      method: 'POST',
      body: { from: { lat: 41.03, lon: 28.98 }, via: [via[0], via[0], via[0], via[0]], to: { lat: 41.04, lon: 28.99 } },
    });
    assert.equal(tooMany.status, 400);
    const outside = await req('/api/route', {
      method: 'POST',
      body: { from: { lat: 41.03, lon: 28.98 }, via: [{ lat: 39.9, lon: 32.8 }], to: { lat: 41.04, lon: 28.99 } },
    });
    assert.equal(outside.status, 400);
    assert.match(outside.body.error, /1\. ara durak/);
  });
});

test('hız sınırı: yol parçalarının sınırı birleşik çizgi indeksleriyle gelir; servis hatası rotayı bozmaz', async () => {
  await withServer(async ({ req, valhalla }) => {
    const shape3 = '_vggmA_qxgv@?gqC?gqC'; // 3 noktalı çizgi
    const leg = { shape: shape3, maneuvers: [{ type: 1, instruction: 'Başla', length: 0.4, time: 40, begin_shape_index: 0, end_shape_index: 2 }] };
    valhalla.route = async () => ({ trip: { summary: { length: 0.8, time: 80 }, legs: [leg, leg] } });
    valhalla.traceAttributes = async (body) => {
      assert.equal(body.shape_match, 'edge_walk');
      return {
        shape: body.encoded_polyline,
        edges: [
          { speed_limit: 50, begin_shape_index: 0, end_shape_index: 1 },
          { speed_limit: 50, begin_shape_index: 1, end_shape_index: 2 },
        ],
      };
    };
    const body = { from: { lat: 41.03, lon: 28.98 }, via: [{ lat: 41.035, lon: 28.985 }], to: { lat: 41.04, lon: 28.99 } };
    const r = await req('/api/route', { method: 'POST', body });
    assert.deepEqual(r.body.speedLimits, [
      { from: 0, to: 2, kph: 50 },
      { from: 3, to: 5, kph: 50 },
    ]);

    // Sınırı bilinmeyen parça atlanır; Valhalla çizgisi rotanınkiyle uyuşmazsa hiç sınır verilmez.
    valhalla.traceAttributes = async () => ({ shape: shape3, edges: [{ begin_shape_index: 0, end_shape_index: 1 }, { speed_limit: 30, begin_shape_index: 1, end_shape_index: 2 }] });
    assert.deepEqual((await req('/api/route', { method: 'POST', body })).body.speedLimits, [
      { from: 1, to: 2, kph: 30 },
      { from: 4, to: 5, kph: 30 },
    ]);
    valhalla.traceAttributes = async () => ({ shape: SHAPE, edges: [{ speed_limit: 30, begin_shape_index: 0, end_shape_index: 1 }] });
    assert.deepEqual((await req('/api/route', { method: 'POST', body })).body.speedLimits, []);

    valhalla.traceAttributes = async () => {
      throw new Error('trace_attributes kapalı');
    };
    const r2 = await req('/api/route', { method: 'POST', body });
    assert.equal(r2.status, 200);
    assert.deepEqual(r2.body.speedLimits, []);
  });
});

// --- Giriş, roller ve üyelik süresi ---

const ROUTE_BODY = { from: { lat: 41.03, lon: 28.98 }, to: { lat: 41.04, lon: 28.99 } };

test('e-posta ile giriş: kayıtlı adrese kod gider, kod ile oturum açılır; üyenin şifresi yoktur', async () => {
  await withServer(async ({ raw, ownerToken, mail, clock }) => {
    const created = await raw('/api/users', { method: 'POST', token: ownerToken, body: { name: 'Ayşe Kaya', email: ' Ayse@Ornek.com ', phone: '' } });
    assert.equal(created.status, 200);
    assert.equal(created.body.user.email, 'ayse@ornek.com');
    assert.equal(created.body.user.phone, null);
    assert.equal(created.body.tempPassword, null); // üyeye şifre verilmez

    // Kayıtlı olmayan adres de aynı cevabı alır ama e-posta gitmez.
    const unknown = await raw('/api/auth/email-code', { method: 'POST', body: { email: 'yok@ornek.com' } });
    assert.equal(unknown.status, 200);
    assert.equal(mail.length, 0);
    assert.equal((await raw('/api/auth/email-code', { method: 'POST', body: { email: 'gecersiz' } })).status, 400);

    assert.equal((await raw('/api/auth/email-code', { method: 'POST', body: { email: 'ayse@ornek.com' } })).status, 200);
    assert.equal(mail.length, 1);
    assert.match(mail[0].code, /^\d{6}$/);
    // Bir dakika dolmadan yeni kod istenemez.
    assert.equal((await raw('/api/auth/email-code', { method: 'POST', body: { email: 'ayse@ornek.com' } })).status, 429);

    const wrongCode = mail[0].code === '000000' ? '111111' : '000000';
    const wrong = await raw('/api/auth/email-login', { method: 'POST', body: { email: 'ayse@ornek.com', code: wrongCode } });
    assert.equal(wrong.status, 401);
    const login = await raw('/api/auth/email-login', { method: 'POST', body: { email: 'AYSE@ornek.com', code: mail[0].code } });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.mustChangePassword, false);
    // Kod tek kullanımlık.
    assert.equal((await raw('/api/auth/email-login', { method: 'POST', body: { email: 'ayse@ornek.com', code: mail[0].code } })).status, 401);
    // Süresi olmayan üye rota alamaz.
    const expired = await raw('/api/route', { method: 'POST', token: login.body.token, body: ROUTE_BODY });
    assert.equal(expired.status, 402);
    assert.equal(expired.body.code, 'expired');
    // Üye şifreyle giremez, şifre belirleyemez.
    assert.equal((await raw('/api/auth/password', { method: 'POST', token: login.body.token, body: { newPassword: 'abcdef' } })).status, 400);

    // Kod 10 dakika geçerli.
    clock.t += 61000;
    await raw('/api/auth/email-code', { method: 'POST', body: { email: 'ayse@ornek.com' } });
    clock.t += 11 * 60000;
    const late = await raw('/api/auth/email-login', { method: 'POST', body: { email: 'ayse@ornek.com', code: mail.at(-1).code } });
    assert.equal(late.status, 401);
    assert.match(late.body.error, /süresi doldu/);
  });
});

test('e-posta kodu: 5 hatalı denemede kod geçersiz olur; saatte en fazla 5 kod', async () => {
  await withServer(async ({ raw, users, mail, clock }) => {
    users.create({ name: 'Üye', email: 'uye@ornek.com' });
    await raw('/api/auth/email-code', { method: 'POST', body: { email: 'uye@ornek.com' } });
    const code = mail.at(-1).code;
    const bad = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await raw('/api/auth/email-login', { method: 'POST', body: { email: 'uye@ornek.com', code: bad } });
    const after = await raw('/api/auth/email-login', { method: 'POST', body: { email: 'uye@ornek.com', code } });
    assert.equal(after.status, 401); // doğru kod bile artık geçmez
    for (let i = 0; i < 4; i++) {
      clock.t += 61000;
      assert.equal((await raw('/api/auth/email-code', { method: 'POST', body: { email: 'uye@ornek.com' } })).status, 200);
    }
    clock.t += 61000;
    assert.equal((await raw('/api/auth/email-code', { method: 'POST', body: { email: 'uye@ornek.com' } })).status, 429);
  });
});

test('yönetici: e-posta koduyla ya da yedek olarak telefon + geçici şifreyle girer', async () => {
  await withServer(async ({ raw, ownerToken, emailLogin }) => {
    const created = await raw('/api/users', {
      method: 'POST',
      token: ownerToken,
      body: { name: 'Ali Veli', email: 'ali@ornek.com', phone: '0533 222 33 44', role: 'admin' },
    });
    assert.equal(created.body.user.role, 'admin');
    assert.match(created.body.tempPassword, /^\d{6}$/);
    // Yönetici için telefon zorunlu (yedek giriş).
    assert.equal((await raw('/api/users', { method: 'POST', token: ownerToken, body: { name: 'X', email: 'x@ornek.com', role: 'admin' } })).status, 400);

    const byEmail = await emailLogin('ali@ornek.com');
    assert.equal(byEmail.status, 200);
    assert.equal(byEmail.body.user.mustChangePassword, false); // kodla girene şifre sorulmaz
    assert.equal((await raw('/api/closures/toggle', { method: 'POST', token: byEmail.body.token, body: { lat: 41.031, lon: 28.9823 } })).status, 200);

    const byPassword = await raw('/api/auth/login', { method: 'POST', body: { phone: '05332223344', password: created.body.tempPassword } });
    assert.equal(byPassword.body.user.mustChangePassword, true); // geçici şifreyle girene şifre belirletilir
    assert.equal((await raw('/api/closures', { token: byPassword.body.token })).body.code, 'password');
    assert.equal((await raw('/api/auth/me', { token: byEmail.body.token })).status, 401); // tek cihaz
  });
});

test('roller: üye yol kapatamaz, yönetici üyeleri göremez ve süre veremez, sahip hepsini yapar', async () => {
  await withServer(async ({ raw, ownerToken, adminToken, users, emailLogin }) => {
    const { user: member } = users.create({ name: 'Üye', email: 'uye@ornek.com', phone: '05320000001' });
    users.extend(member.id, 1);
    const memberToken = (await emailLogin('uye@ornek.com')).body.token;

    assert.equal((await raw('/api/closures/toggle', { method: 'POST', token: memberToken, body: { lat: 41.031, lon: 28.9823 } })).status, 403);
    assert.equal((await raw('/api/zones', { method: 'POST', token: memberToken, body: { name: 'x' } })).status, 403);
    assert.equal((await raw('/api/route', { method: 'POST', token: memberToken, body: ROUTE_BODY })).status, 200);
    assert.equal((await raw('/api/closures', { token: memberToken })).status, 200);

    assert.equal((await raw('/api/users', { token: adminToken })).status, 403);
    assert.equal((await raw(`/api/users/${member.id}/extend`, { method: 'POST', token: adminToken, body: { days: 1 } })).status, 403);
    assert.equal((await raw(`/api/users/${member.id}/expire`, { method: 'POST', token: adminToken })).status, 403);
    assert.equal((await raw('/api/users', { method: 'POST', token: adminToken, body: { name: 'x', email: 'y@ornek.com' } })).status, 403);
    assert.equal((await raw('/api/closures/toggle', { method: 'POST', token: adminToken, body: { lat: 41.031, lon: 28.9823 } })).status, 200);

    const list = await raw('/api/users?role=member', { token: ownerToken });
    assert.deepEqual(list.body.users.map((u) => u.name), ['Üye']);
    assert.ok(list.body.users.every((u) => u.passwordHash === undefined && u.session === undefined && u.emailCode === undefined));
    const ownerUser = users.list('owner')[0];
    assert.equal((await raw(`/api/users/${ownerUser.id}`, { method: 'DELETE', token: ownerToken })).status, 400);
    assert.equal((await raw(`/api/users/${member.id}/reset-password`, { method: 'POST', token: ownerToken })).status, 400);
    assert.equal((await raw('/api/users', { method: 'POST', token: ownerToken, body: { name: 'Tekrar', email: 'UYE@ornek.com' } })).status, 409);
    assert.equal((await raw('/api/users', { method: 'POST', token: ownerToken, body: { name: 'Tekrar', email: 'z@ornek.com', phone: '0532 000 00 01' } })).status, 409);
    assert.equal((await raw(`/api/users/${member.id}`, { method: 'DELETE', token: ownerToken })).status, 200);
  });
});

test('süre: +1/+3/+7 gün üst üste eklenir, dolunca rota kesilir, "Süreyi bitir" hemen kapatır', async () => {
  await withServer(async ({ raw, ownerToken, users, clock, emailLogin }) => {
    const { user: member } = users.create({ name: 'Üye', email: 'uye@ornek.com' });
    const t = (await emailLogin('uye@ornek.com')).body.token;
    const route = async () => (await raw('/api/route', { method: 'POST', token: t, body: ROUTE_BODY })).status;
    const extend = (days) => raw(`/api/users/${member.id}/extend`, { method: 'POST', token: ownerToken, body: { days } });

    assert.equal(await route(), 402);
    assert.equal((await extend(2)).status, 400);
    const start = clock.t;
    assert.equal((await extend(1)).body.user.expiresAt, start + 86400000);
    assert.equal(await route(), 200);
    clock.t += 25 * 3600000; // süre doldu
    assert.equal(await route(), 402);
    assert.equal((await raw('/api/auth/me', { token: t })).body.user.active, false);
    // Süresi bitmiş üyeye eklenen gün şimdiden başlar; devam eden süreye ise üstüne eklenir.
    assert.equal((await extend(3)).body.user.expiresAt, clock.t + 3 * 86400000);
    assert.equal((await extend(7)).body.user.expiresAt, clock.t + 10 * 86400000);
    assert.equal(await route(), 200);
    await raw(`/api/users/${member.id}/expire`, { method: 'POST', token: ownerToken });
    assert.equal(await route(), 402);
  });
});

test('tek cihaz: yeni giriş eski oturumu kapatır; çıkış oturumu kapatır', async () => {
  await withServer(async ({ raw, users, clock, emailLogin }) => {
    users.create({ name: 'Üye', email: 'uye@ornek.com' });
    const first = await emailLogin('uye@ornek.com');
    clock.t += 61000;
    const second = await emailLogin('uye@ornek.com');
    assert.equal((await raw('/api/auth/me', { token: first.body.token })).status, 401);
    assert.equal((await raw('/api/auth/me', { token: second.body.token })).status, 200);
    await raw('/api/auth/logout', { method: 'POST', token: second.body.token });
    assert.equal((await raw('/api/auth/me', { token: second.body.token })).status, 401);
  });
});

test('şifre deneme sınırı: 5 hatalı denemeden sonra 15 dakika kilit', async () => {
  await withServer(async ({ raw, users, clock }) => {
    const { tempPassword } = users.create({ name: 'Yönetici', email: 'y@ornek.com', phone: '05320000004', role: 'admin' });
    const login = (password) => raw('/api/auth/login', { method: 'POST', body: { phone: '05320000004', password } });
    for (let i = 0; i < 5; i++) assert.equal((await login('yanlis')).status, 401);
    const locked = await login(tempPassword);
    assert.equal(locked.status, 429);
    clock.t += 16 * 60000;
    assert.equal((await login(tempPassword)).status, 200);
  });
});

// RevenueCat bildirimi: mağazada tamamlanan satın alım.
const rcEvent = (event) => ({ api_version: '1.0', event: { environment: 'PRODUCTION', store: 'PLAY_STORE', ...event } });
const rcPost = (raw, body, auth = 'Bearer rc-gizli') =>
  fetch(raw.base + '/api/webhooks/revenuecat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify(body) }).then(
    async (r) => ({ status: r.status, body: await r.json() }),
  );

test('mağaza satın alımı: paket günü kadar süre eklenir, aynı işlem iki kez sayılmaz, iade geri alır', async () => {
  await withServer(async ({ raw, users, clock, emailLogin, base }) => {
    raw.base = base;
    const { user } = users.create({ name: 'Üye', email: 'uye@ornek.com' });
    const t = (await emailLogin('uye@ornek.com')).body.token;
    const route = async () => (await raw('/api/route', { method: 'POST', token: t, body: ROUTE_BODY })).status;
    assert.equal(await route(), 402);
    assert.deepEqual((await raw('/api/products')).body.products, [
      { id: 'hermap_1gun', days: 1 },
      { id: 'hermap_3gun', days: 3 },
      { id: 'hermap_1hafta', days: 7 },
    ]);

    const buy = rcEvent({ type: 'NON_RENEWING_PURCHASE', app_user_id: user.id, product_id: 'hermap_3gun', transaction_id: 'GPA.1' });
    assert.equal((await rcPost(raw, buy, 'Bearer yanlis')).status, 401);
    assert.equal((await rcPost(raw, buy, '')).status, 401);
    assert.deepEqual((await rcPost(raw, buy)).body, { applied: true });
    assert.equal(users.get(user.id).expiresAt, clock.t + 3 * 86400000);
    assert.equal(await route(), 200);
    // RevenueCat aynı bildirimi tekrar gönderebilir: süre bir kez eklenir.
    assert.deepEqual((await rcPost(raw, buy)).body, { applied: false });
    assert.equal(users.get(user.id).expiresAt, clock.t + 3 * 86400000);
    // İkinci paket devam eden sürenin üstüne eklenir.
    await rcPost(raw, rcEvent({ type: 'NON_RENEWING_PURCHASE', app_user_id: user.id, product_id: 'hermap_1hafta', transaction_id: 'GPA.2' }));
    assert.equal(users.get(user.id).expiresAt, clock.t + 10 * 86400000);
    assert.equal((await raw('/api/auth/me', { token: t })).body.user.lastPurchase.productId, 'hermap_1hafta');
    // İade: o paketin günleri geri alınır.
    assert.deepEqual((await rcPost(raw, rcEvent({ type: 'CANCELLATION', app_user_id: user.id, transaction_id: 'GPA.2' }))).body, { refunded: true });
    assert.equal(users.get(user.id).expiresAt, clock.t + 3 * 86400000);
    assert.equal((await raw('/api/auth/me', { token: t })).body.user.lastPurchase.productId, 'hermap_3gun');

    // Bilinmeyen ürün / kullanıcı / deneme (sandbox) satın alımı süre eklemez.
    assert.deepEqual((await rcPost(raw, rcEvent({ type: 'NON_RENEWING_PURCHASE', app_user_id: user.id, product_id: 'baska', transaction_id: 'x1' }))).body, { ignored: 'unknown-product' });
    assert.deepEqual((await rcPost(raw, rcEvent({ type: 'NON_RENEWING_PURCHASE', app_user_id: 'yok', product_id: 'hermap_1gun', transaction_id: 'x2' }))).body, { ignored: 'unknown-user' });
    assert.deepEqual((await rcPost(raw, rcEvent({ environment: 'SANDBOX', type: 'NON_RENEWING_PURCHASE', app_user_id: user.id, product_id: 'hermap_1gun', transaction_id: 'x3' }))).body, { ignored: 'sandbox' });
    assert.equal(users.get(user.id).expiresAt, clock.t + 3 * 86400000);
  });
});

test('mağaza bildirimi: anahtar ayarlı değilse kapalı; sandbox izni verilirse deneme satın alımı da sayılır', async () => {
  await withServer(
    async ({ raw, base }) => {
      raw.base = base;
      assert.equal((await rcPost(raw, rcEvent({ type: 'TEST' }))).status, 503);
    },
    { revenuecat: { webhookAuth: null } },
  );
  await withServer(
    async ({ raw, users, base }) => {
      raw.base = base;
      const { user } = users.create({ name: 'Üye', email: 'uye@ornek.com' });
      const r = await rcPost(raw, rcEvent({ environment: 'SANDBOX', type: 'NON_RENEWING_PURCHASE', app_user_id: user.id, product_id: 'hermap_1gun', transaction_id: 's1' }));
      assert.deepEqual(r.body, { applied: true });
    },
    { revenuecat: { webhookAuth: 'rc-gizli', allowSandbox: true } },
  );
});

test('e-posta gönderilemezse anlaşılır hata döner', async () => {
  const broken = {
    configured: true,
    sendLoginCode: async () => {
      throw new Error('SMTP bağlantısı kurulamadı');
    },
  };
  await withServer(
    async ({ raw, users }) => {
      users.create({ name: 'Üye', email: 'uye@ornek.com' });
      const original = console.error;
      console.error = () => {};
      try {
        const r = await raw('/api/auth/email-code', { method: 'POST', body: { email: 'uye@ornek.com' } });
        assert.equal(r.status, 502);
        assert.match(r.body.error, /gönderilemedi/);
      } finally {
        console.error = original;
      }
    },
    { mailer: broken },
  );
});

test('şerit bilgisi: OSRM biçimli istekten manevralara eklenir; eşleşmezse ya da hata olursa şeritsiz', async () => {
  await withServer(async ({ req, valhalla }) => {
    const maneuvers = [
      { type: 1, instruction: 'Başla', length: 0.2, time: 20, begin_shape_index: 0, end_shape_index: 1 },
      { type: 10, instruction: 'Sağa dönün.', length: 0.2, time: 20, begin_shape_index: 1, end_shape_index: 2 },
      { type: 4, instruction: 'Hedefinize vardınız.', length: 0, time: 0, begin_shape_index: 2, end_shape_index: 2 },
    ];
    const lanes = [
      { indications: ['straight'], valid: false, active: false },
      { indications: ['straight'], valid: false, active: false },
      { indications: ['right'], valid: true, active: true, valid_indication: 'right' },
    ];
    let osrm = {
      routes: [{ legs: [{ steps: [{ intersections: [{}] }, { intersections: [{ lanes }] }, { intersections: [{}] }] }] }],
    };
    valhalla.route = async (body) => {
      valhalla.calls.push(body);
      if (body.format === 'osrm') {
        if (!osrm) throw new Error('kapalı');
        return osrm;
      }
      return { trip: { summary: { length: 0.4, time: 40 }, legs: [{ shape: SHAPE, maneuvers }] } };
    };
    const body = { from: { lat: 41.03, lon: 28.98 }, to: { lat: 41.04, lon: 28.99 } };
    const r = await req('/api/route', { method: 'POST', body });
    assert.equal(r.status, 200);
    const osrmCall = valhalla.calls.find((c) => c.format === 'osrm');
    assert.equal(osrmCall.locations.length, 2); // aynı istek
    assert.equal(r.body.maneuvers[0].lanes, undefined);
    assert.deepEqual(r.body.maneuvers[1].lanes, [
      { dirs: ['straight'], ok: false, best: false },
      { dirs: ['straight'], ok: false, best: false },
      { dirs: ['right'], ok: true, best: true, use: 'right' },
    ]);

    // Adım sayısı tutmazsa şerit yok.
    osrm = { routes: [{ legs: [{ steps: [{ intersections: [{ lanes }] }] }] }] };
    const r2 = await req('/api/route', { method: 'POST', body });
    assert.ok(r2.body.maneuvers.every((m) => !m.lanes));

    // OSRM isteği hata verirse rota yine gelir.
    osrm = null;
    const r3 = await req('/api/route', { method: 'POST', body });
    assert.equal(r3.status, 200);
    assert.ok(r3.body.maneuvers.every((m) => !m.lanes));
  });
});

test('adres arama: HERE anahtarı varsa HERE, hata olursa ya da anahtar yoksa OpenStreetMap', async () => {
  const { searchPlaces } = await import('../src/search.js');
  const bbox = { minLon: 27.95, minLat: 40.78, maxLon: 29.95, maxLat: 41.6 };
  const calls = [];
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const here = {
    items: [
      { title: 'G Plus Rezidans', address: { label: 'Bağlar Mah., Bağcılar/İstanbul' }, position: { lat: 41.04, lng: 28.85 }, access: [{ lat: 41.0401, lng: 28.8502 }] },
      { title: 'Konumsuz' },
    ],
  };
  const osm = [{ name: 'Bağlar', display_name: 'Bağlar, Bağcılar, İstanbul', lat: '41.03', lon: '28.84' }];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('hereapi.com')) return here === null ? { ok: false, status: 500 } : ok(here);
    return ok(osm);
  };
  const opts = { nominatimUrl: 'https://nominatim.example', bbox, fetchImpl, userAgent: 'test', log: { warn() {} } };

  const r1 = await searchPlaces('g plus', { ...opts, hereApiKey: 'anahtar' });
  assert.equal(r1.source, 'here');
  assert.deepEqual(r1.results, [{ name: 'G Plus Rezidans', address: 'Bağlar Mah., Bağcılar/İstanbul', lat: 41.0401, lon: 28.8502 }]);
  const u = new URL(calls[0]);
  assert.equal(u.searchParams.get('q'), 'g plus');
  assert.equal(u.searchParams.get('in'), 'bbox:27.95,40.78,29.95,41.6');
  assert.equal(u.searchParams.get('lang'), 'tr-TR');

  const r2 = await searchPlaces('bağlar', { ...opts, hereApiKey: null });
  assert.equal(r2.source, 'osm');
  assert.equal(r2.results[0].name, 'Bağlar');

  const failing = async (url) => (String(url).includes('hereapi.com') ? { ok: false, status: 401 } : ok(osm));
  const r3 = await searchPlaces('bağlar', { ...opts, hereApiKey: 'yanlis', fetchImpl: failing });
  assert.equal(r3.source, 'osm'); // HERE hata verince arama bozulmaz
});

test('yol kapat: kapalı yola tekrar dokununca, en yakın yol yan sokak çıksa bile o yol açılır', async () => {
  // polyline6 kodlayıcı (yalnızca test için)
  const enc = (coords) => {
    let out = '', pl = 0, pn = 0;
    const one = (v) => { let x = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (x >= 0x20) { s += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5; } return s + String.fromCharCode(x + 63); };
    for (const [la, lo] of coords) { const a = Math.round(la * 1e6), b = Math.round(lo * 1e6); out += one(a - pl) + one(b - pn); pl = a; pn = b; }
    return out;
  };
  const edge = (coords, distanceMeters, name) => ({ shapeEncoded: enc(coords), coordinates: coords, wayId: 1, names: [name], distanceMeters });
  // A: doğu-batı sokak; B: A'nın ucundaki kavşaktan kuzeye giden yan sokak; C: A'ya 15 m paralel karşı şerit
  const A = [[41.03, 28.98], [41.03, 28.982]];
  const B = [[41.03, 28.982], [41.032, 28.982]];
  const C = [[41.030135, 28.98], [41.030135, 28.982]];
  await withServer(async ({ req, valhalla }) => {
    const tap = async (lat, lon, located) => {
      valhalla.locateEdge = async () => located;
      return req('/api/closures/toggle', { method: 'POST', body: { lat, lon } });
    };
    const closed = await tap(41.03, 28.981, edge(A, 1, 'A Sokak'));
    assert.equal(closed.body.action, 'closed');

    // Kavşağa yakın, A çizgisinin 2 m yanına dokunuldu; Valhalla en yakın olarak yan sokak B'yi (1,5 m) buldu.
    const r = await tap(41.03002, 28.98199, edge(B, 1.5, 'B Sokak'));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.action, 'opened');
    assert.equal(r.body.closure.name, 'A Sokak');
    assert.equal((await req('/api/closures')).body.closures.length, 0);

    // Yan yana şerit: A kapalıyken karşı şeride (C) dokununca A açılmaz, C kapanır.
    await tap(41.03, 28.981, edge(A, 1, 'A Sokak'));
    const c = await tap(41.030135, 28.981, edge(C, 0.5, 'C Şerit'));
    assert.equal(c.body.action, 'closed');
    assert.equal(c.body.closure.name, 'C Şerit');
    assert.equal((await req('/api/closures')).body.closures.length, 2);

    // Yakında yol bulunamasa bile kapalı yolun üstüne dokunmak onu açar.
    const far = await tap(41.03, 28.9805, { ...edge(B, 300, 'Uzak') });
    assert.equal(far.body.action, 'opened');
    assert.equal(far.body.closure.name, 'A Sokak');
  });
});
