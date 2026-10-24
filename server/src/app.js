import express from 'express';
import { fileURLToPath } from 'node:url';
import { ValhallaError } from './valhalla.js';
import { decodePolyline } from './geo.js';
import { adjustedTime, trafficPeriod } from './traffic.js';
import { fixStreetSuffixes } from './turkish.js';
import { ClosureStore } from './closures.js';

// İstanbul il sınırını kabaca kapsayan kutu (indirme betiğiyle aynı).
export const ISTANBUL_BBOX = { minLon: 27.95, minLat: 40.78, maxLon: 29.95, maxLat: 41.6 };
const COSTINGS = new Set(['auto', 'motorcycle']);
// Dokunulan nokta en yakın yoldan bundan uzaksa "yol bulunamadı" denir.
const MAX_SNAP_METERS = 40;

function parsePoint(p, label) {
  const lat = Number(p?.lat);
  const lon = Number(p?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new HttpError(400, `${label} için geçerli lat/lon gerekli`);
  }
  const b = ISTANBUL_BBOX;
  if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) {
    throw new HttpError(400, `${label} İstanbul sınırları dışında`);
  }
  return { lat, lon };
}

// Valhalla'nın varış manevraları (düz, sağda, solda). Ara durakların sonundakiler "Ara durak" olarak yazılır.
const ARRIVAL_TYPES = new Set([4, 5, 6]);
export const MAX_STOPS = 3;

/**
 * Valhalla trip'ini uygulamanın rota biçimine çevirir; süreler yoğun saate göre ayarlanır.
 * Ara durak varsa her durak ayrı bir "leg" olarak gelir; bacaklar tek çizgide birleştirilir,
 * manevra ve hız sınırı indeksleri birleşik çizgiye göre kaydırılır.
 */
function buildRoute(trip, periodKey, legSpeedLimits = []) {
  const coordinates = [];
  const maneuvers = [];
  const stops = [];
  const speedLimits = [];
  trip.legs.forEach((leg, li) => {
    const offset = coordinates.length;
    const coords = decodePolyline(leg.shape);
    coordinates.push(...coords);
    const lastLeg = li === trip.legs.length - 1;
    for (const m of leg.maneuvers) {
      const isStop = !lastLeg && ARRIVAL_TYPES.has(m.type);
      maneuvers.push({
        type: m.type,
        instruction: isStop ? `${li + 1}. ara durağa varış` : fixStreetSuffixes(m.instruction),
        verbalPre: isStop
          ? `${li + 1}. ara durağa varmak üzeresiniz.`
          : fixStreetSuffixes(m.verbal_pre_transition_instruction ?? m.instruction),
        verbalAlert: isStop ? null : fixStreetSuffixes(m.verbal_transition_alert_instruction ?? null),
        streetNames: m.street_names ?? [],
        distanceKm: m.length,
        durationSec: Math.round(adjustedTime(m.length, m.time, periodKey)),
        beginShapeIndex: m.begin_shape_index + offset,
        endShapeIndex: m.end_shape_index + offset,
        ...(isStop ? { stop: li + 1 } : {}),
      });
    }
    if (!lastLeg) stops.push({ shapeIndex: coordinates.length - 1 });
    for (const r of legSpeedLimits[li] ?? []) speedLimits.push({ from: r.from + offset, to: r.to + offset, kph: r.kph });
  });
  return {
    distanceKm: trip.summary.length,
    hasToll: Boolean(trip.summary.has_toll),
    durationSec: maneuvers.reduce((sum, m) => sum + m.durationSec, 0),
    freeFlowDurationSec: Math.round(trip.summary.time),
    coordinates,
    maneuvers,
    stops,
    speedLimits,
  };
}

/**
 * Bir rota bacağının hız sınırları (OSM maxspeed etiketi): [{ from, to, kph }] — from/to bacak
 * çizgisindeki nokta indeksleri. Valhalla rotada hız sınırı vermiyor; aynı çizgi trace_attributes'a
 * "edge_walk" ile verilip her yol parçasının sınırı alınır. Sınırı bilinmeyen yerler listede yoktur.
 * Hız sınırı yardımcı bilgi olduğundan hata olursa rota yine döner (boş liste).
 */
export async function legSpeedLimits(valhalla, leg, costing) {
  try {
    const data = await valhalla.traceAttributes({
      encoded_polyline: leg.shape,
      costing,
      shape_match: 'edge_walk',
      filters: {
        attributes: ['edge.speed_limit', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape'],
        action: 'include',
      },
    });
    // İndeksler Valhalla'nın döndürdüğü çizgiye göre; rotanınkiyle aynı değilse eşleme güvenilmez.
    if (!data.shape || decodePolyline(data.shape).length !== decodePolyline(leg.shape).length) return [];
    const runs = [];
    for (const e of data.edges ?? []) {
      const kph = e.speed_limit;
      if (!(kph > 0 && kph < 200)) continue; // bilinmiyor ya da "sınırsız"
      const prev = runs[runs.length - 1];
      if (prev && prev.kph === kph && prev.to === e.begin_shape_index) prev.to = e.end_shape_index;
      else runs.push({ from: e.begin_shape_index, to: e.end_shape_index, kph });
    }
    return runs;
  } catch {
    return [];
  }
}

// Valhalla "rota yok" hataları: 442 yol bulunamadı, 170 bağlantısız bölgeler, 171 yakında uygun yol yok.
const NO_ROUTE_CODES = new Set([442, 170, 171]);

/**
 * Arama sonuçları büyük alanların (havalimanı, AVM, park) ortasına düşebilir; Valhalla o noktayı
 * dışarıdan girilemeyen bir iç yola bağlayınca rota çıkmaz. Böyle olursa noktaları önce en yakın
 * halka açık yola (servis yolları hariç), olmazsa en yakın ana yola bağlayarak tekrar dener.
 */
async function routeWithFallback(valhalla, body) {
  const attempts = [null, 'residential', 'tertiary'];
  for (const [i, minRoadClass] of attempts.entries()) {
    const locations = minRoadClass
      ? body.locations.map((l) => ({ ...l, search_filter: { min_road_class: minRoadClass } }))
      : body.locations;
    try {
      return { data: await valhalla.route({ ...body, locations }), snappedToRoad: Boolean(minRoadClass) };
    } catch (err) {
      const retryable = err instanceof ValhallaError && NO_ROUTE_CODES.has(err.details?.error_code);
      if (!retryable || i === attempts.length - 1) throw err;
    }
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createApp({ valhalla, store, adminToken, nominatimUrl = 'https://nominatim.openstreetmap.org' }) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  // Mobil uygulama ve yönetici sayfası farklı adreslerden erişebilsin.
  app.use((req, res, next) => {
    res.set('access-control-allow-origin', '*');
    res.set('access-control-allow-headers', 'content-type, x-admin-token');
    res.set('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const requireAdmin = (req, res, next) => {
    if (req.get('x-admin-token') !== adminToken) {
      return res.status(401).json({ error: 'Yönetici anahtarı geçersiz' });
    }
    next();
  };

  app.get('/api/health', async (req, res) => {
    let valhallaStatus = null;
    try {
      valhallaStatus = await valhalla.status();
    } catch {
      // Valhalla henüz ayakta değilse API yine de cevap versin.
    }
    res.json({ ok: true, valhalla: valhallaStatus, closuresVersion: store.version });
  });

  // closures: şu an trafiğe kapalı tüm segmentler (tekil + aktif gruplar).
  // zones: kayıtlı gruplar, kapalı olsun olmasın segmentleriyle birlikte.
  app.get('/api/closures', (req, res) => {
    res.json({ version: store.version, closures: store.effectiveClosures(), zones: store.listZones() });
  });

  // Yönetici sayfası için canlı değişiklik akışı (Server-Sent Events).
  app.get('/api/closures/stream', (req, res) => {
    res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.flushHeaders();
    const send = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);
    send({ type: 'hello', version: store.version });
    store.on('change', send);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      store.off('change', send);
    });
  });

  app.post('/api/admin/check', requireAdmin, (req, res) => res.json({ ok: true }));

  // Haritada dokunulan noktadaki sokak segmentini kapatır; zaten kapalıysa açar.
  app.post('/api/closures/toggle', requireAdmin, async (req, res, next) => {
    try {
      const point = parsePoint(req.body, 'Nokta');
      const edge = await valhalla.locateEdge(point);
      if (!edge || edge.distanceMeters > MAX_SNAP_METERS) {
        throw new HttpError(404, 'Dokunulan yere yakın bir araç yolu bulunamadı');
      }
      const id = ClosureStore.idForShape(edge.shapeEncoded);
      const zone = store.activeZoneOf(id);
      if (zone && !store.get(id)) {
        throw new HttpError(409, `Bu yol "${zone.name}" grubuyla kapalı. Açmak için grubu trafiğe açın.`);
      }
      if (store.get(id)) {
        res.json({ action: 'opened', closure: store.remove(id), version: store.version });
      } else {
        const closure = store.add(edge, { reason: String(req.body.reason ?? '').slice(0, 200) });
        res.json({ action: 'closed', closure, version: store.version });
      }
    } catch (err) {
      next(err);
    }
  });

  // Tüm yolları tek seferde trafiğe açar (gruplar silinmez, yalnızca açılır).
  app.post('/api/closures/open-all', requireAdmin, (req, res) => {
    res.json({ ...store.openAll(), version: store.version });
  });

  app.delete('/api/closures/:id', requireAdmin, (req, res) => {
    const closure = store.remove(req.params.id);
    if (!closure) return res.status(404).json({ error: 'Kapatma bulunamadı' });
    res.json({ action: 'opened', closure, version: store.version });
  });

  // --- Kayıtlı kapatma grupları ---
  const parseZoneName = (value) => {
    const name = String(value ?? '').trim().slice(0, 80);
    if (!name) throw new HttpError(400, 'Grup için bir isim girin');
    return name;
  };

  // Şu anki tekil kapatmaları (ya da closureIds ile seçilenleri) isimli bir grup olarak kaydeder.
  app.post('/api/zones', requireAdmin, (req, res, next) => {
    try {
      const name = parseZoneName(req.body.name);
      const ids = Array.isArray(req.body.closureIds) ? req.body.closureIds.map(String) : undefined;
      const zone = store.createZone(name, ids);
      if (!zone) throw new HttpError(400, 'Kaydedilecek kapalı yol yok. Önce haritada yolları kapatın.');
      res.status(201).json({ zone, version: store.version });
    } catch (err) {
      next(err);
    }
  });

  // { active: true } grubu trafiğe kapatır, { active: false } açar; { name } yeniden adlandırır.
  app.patch('/api/zones/:id', requireAdmin, (req, res, next) => {
    try {
      const patch = {};
      if (req.body.active !== undefined) patch.active = Boolean(req.body.active);
      if (req.body.name !== undefined) patch.name = parseZoneName(req.body.name);
      const zone = store.updateZone(req.params.id, patch);
      if (!zone) throw new HttpError(404, 'Grup bulunamadı');
      res.json({ zone, version: store.version });
    } catch (err) {
      next(err);
    }
  });

  // Grup düzenleme: dokunulan yol gruptaysa çıkarılır, değilse eklenir.
  app.post('/api/zones/:id/toggle-segment', requireAdmin, async (req, res, next) => {
    try {
      if (!store.getZone(req.params.id)) throw new HttpError(404, 'Grup bulunamadı');
      const point = parsePoint(req.body, 'Nokta');
      const edge = await valhalla.locateEdge(point);
      if (!edge || edge.distanceMeters > MAX_SNAP_METERS) {
        throw new HttpError(404, 'Dokunulan yere yakın bir araç yolu bulunamadı');
      }
      res.json({ ...store.toggleZoneSegment(req.params.id, edge), version: store.version });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/zones/:id', requireAdmin, (req, res) => {
    const zone = store.deleteZone(req.params.id);
    if (!zone) return res.status(404).json({ error: 'Grup bulunamadı' });
    res.json({ zone, version: store.version });
  });

  // Rota: kapalı segmentler her istekte exclude_polygons olarak Valhalla'ya gider.
  app.post('/api/route', async (req, res, next) => {
    try {
      const from = parsePoint(req.body.from, 'Başlangıç');
      const to = parsePoint(req.body.to, 'Varış');
      const via = Array.isArray(req.body.via) ? req.body.via : [];
      if (via.length > MAX_STOPS) throw new HttpError(400, `En fazla ${MAX_STOPS} ara durak eklenebilir`);
      const stops = via.map((p, i) => parsePoint(p, `${i + 1}. ara durak`));
      const costing = COSTINGS.has(req.body.costing) ? req.body.costing : 'auto';
      const heading = Number(req.body.heading);
      const origin = { ...from, type: 'break' };
      // Seyir sırasında yeniden rota alınırken gidiş yönünü bilmek U dönüşlerini önler.
      if (Number.isFinite(heading) && heading >= 0) {
        origin.heading = Math.round(heading) % 360;
        origin.heading_tolerance = 60;
      }

      const exclude = store.excludePolygons();
      // Valhalla alternatif rotayı yalnızca iki noktalı rotalarda verir.
      const wantAlternatives = Boolean(req.body.alternatives) && stops.length === 0;
      // Ücretli yollardan kaçın: yasaklamaz, mümkünse kaçınır (Boğaz geçişlerinin çoğu ücretli).
      const avoidTolls = Boolean(req.body.avoidTolls);
      const { data, snappedToRoad } = await routeWithFallback(valhalla, {
        // Ara duraklar "break": orada durulur, rota durak başına ayrı bacaklara bölünür.
        locations: [origin, ...stops.map((p) => ({ ...p, type: 'break' })), { ...to, type: 'break' }],
        costing,
        directions_options: { language: 'tr-TR', units: 'kilometers' },
        // Alternatifler de exclude_polygons'a uyar: hiçbiri kapalı yoldan geçmez.
        ...(wantAlternatives ? { alternates: 2 } : {}),
        ...(avoidTolls ? { costing_options: { [costing]: { use_tolls: 0 } } } : {}),
        ...(exclude.length ? { exclude_polygons: exclude } : {}),
      });

      const departAt = req.body.departAt ? new Date(req.body.departAt) : new Date();
      const traffic = trafficPeriod(Number.isNaN(departAt.getTime()) ? new Date() : departAt);
      const trips = [data.trip, ...(data.alternates ?? []).map((a) => a.trip)];
      const limits = await Promise.all(
        trips.map((trip) => Promise.all(trip.legs.map((leg) => legSpeedLimits(valhalla, leg, costing)))),
      );
      // Yoğun saat tahminine göre en hızlıdan yavaşa sırala.
      const routes = trips
        .map((trip, i) => buildRoute(trip, traffic.key, limits[i]))
        .sort((a, b) => a.durationSec - b.durationSec);
      res.json({ closuresVersion: store.version, costing, avoidTolls, snappedToRoad, traffic, ...routes[0], routes });
    } catch (err) {
      next(err);
    }
  });

  // Adres arama: Nominatim, İstanbul kutusuyla sınırlı. (Prototip; yoğun kullanımda
  // kendi geocoder'ınızı kurun — Nominatim kullanım politikası saniyede 1 istek.)
  app.get('/api/search', async (req, res, next) => {
    try {
      const q = String(req.query.q ?? '').trim();
      if (q.length < 2) return res.json({ results: [] });
      const b = ISTANBUL_BBOX;
      const url = new URL('/search', nominatimUrl);
      url.search = new URLSearchParams({
        q,
        format: 'jsonv2',
        limit: '8',
        bounded: '1',
        viewbox: `${b.minLon},${b.maxLat},${b.maxLon},${b.minLat}`,
        'accept-language': 'tr',
      }).toString();
      const r = await fetch(url, { headers: { 'user-agent': 'istanbul-nav-prototype/0.1' } });
      if (!r.ok) throw new HttpError(502, `Arama servisi hatası (${r.status})`);
      const items = await r.json();
      res.json({
        results: items.map((i) => ({
          name: i.name || i.display_name.split(',')[0],
          address: i.display_name,
          lat: Number(i.lat),
          lon: Number(i.lon),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  app.use('/admin/vendor/leaflet', express.static(fileURLToPath(new URL('../node_modules/leaflet/dist', import.meta.url))));
  app.use('/admin', express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.get('/', (req, res) => res.redirect('/admin/'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status ?? (err instanceof ValhallaError ? 502 : 500);
    if (status >= 500) console.error(err);
    let message = err.message;
    if (err instanceof ValhallaError && NO_ROUTE_CODES.has(err.details?.error_code)) {
      message = store.effectiveClosures().length
        ? 'Rota bulunamadı. Kapalı yollar hedefe giden yolu kesiyor olabilir.'
        : 'Bu noktaya araçla gidilebilen bir yol bulunamadı. Hedefe yakın başka bir nokta seçin.';
    }
    res.status(status).json({ error: message });
  });

  return app;
}
