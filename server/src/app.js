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

/** Valhalla trip'ini uygulamanın rota biçimine çevirir; süreler yoğun saate göre ayarlanır. */
function buildRoute(trip, periodKey) {
  const leg = trip.legs[0];
  const maneuvers = leg.maneuvers.map((m) => ({
    type: m.type,
    instruction: fixStreetSuffixes(m.instruction),
    verbalPre: fixStreetSuffixes(m.verbal_pre_transition_instruction ?? m.instruction),
    verbalAlert: fixStreetSuffixes(m.verbal_transition_alert_instruction ?? null),
    streetNames: m.street_names ?? [],
    distanceKm: m.length,
    durationSec: Math.round(adjustedTime(m.length, m.time, periodKey)),
    beginShapeIndex: m.begin_shape_index,
    endShapeIndex: m.end_shape_index,
  }));
  return {
    distanceKm: trip.summary.length,
    hasToll: Boolean(trip.summary.has_toll),
    durationSec: maneuvers.reduce((sum, m) => sum + m.durationSec, 0),
    freeFlowDurationSec: Math.round(trip.summary.time),
    coordinates: decodePolyline(leg.shape),
    maneuvers,
  };
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
      const costing = COSTINGS.has(req.body.costing) ? req.body.costing : 'auto';
      const heading = Number(req.body.heading);
      const origin = { ...from, type: 'break' };
      // Seyir sırasında yeniden rota alınırken gidiş yönünü bilmek U dönüşlerini önler.
      if (Number.isFinite(heading) && heading >= 0) {
        origin.heading = Math.round(heading) % 360;
        origin.heading_tolerance = 60;
      }

      const exclude = store.excludePolygons();
      const wantAlternatives = Boolean(req.body.alternatives);
      // Ücretli yollardan kaçın: yasaklamaz, mümkünse kaçınır (Boğaz geçişlerinin çoğu ücretli).
      const avoidTolls = Boolean(req.body.avoidTolls);
      const data = await valhalla.route({
        locations: [origin, { ...to, type: 'break' }],
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
      // Yoğun saat tahminine göre en hızlıdan yavaşa sırala.
      const routes = trips.map((trip) => buildRoute(trip, traffic.key)).sort((a, b) => a.durationSec - b.durationSec);
      res.json({ closuresVersion: store.version, costing, avoidTolls, traffic, ...routes[0], routes });
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
    // Valhalla 442: "No path could be found for input" — çoğunlukla kapalı yollar yüzünden.
    if (err instanceof ValhallaError && err.details?.error_code === 442) {
      message = 'Rota bulunamadı (kapalı yollar nedeniyle hedefe ulaşılamıyor olabilir)';
    }
    res.status(status).json({ error: message });
  });

  return app;
}
