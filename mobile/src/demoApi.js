import AsyncStorage from '@react-native-async-storage/async-storage';
import { ISTANBUL_BBOX, distanceMeters } from './geo';
import { adjustedTime, trafficPeriod } from './traffic';
import { fixStreetSuffixes } from './turkish';

/**
 * Demo modu: kendi sunucumuz yerine OpenStreetMap topluluğunun herkese açık
 * Valhalla sunucusuna doğrudan bağlanır. Docker veya veri indirmesi gerekmez.
 * Kapatmalar yalnızca bu telefonda (AsyncStorage) tutulur, başkasına yansımaz.
 * Herkese açık sunucu adil kullanım içindir; sadece deneme amaçlı kullanın.
 */
export const PUBLIC_VALHALLA_URL = 'https://valhalla1.openstreetmap.de';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const STORAGE_KEY = 'demo-closures-v1';
const MAX_SNAP_METERS = 40;
// Valhalla "rota yok" hataları: 442 yol bulunamadı, 170 bağlantısız bölgeler, 171 yakında uygun yol yok.
const NO_ROUTE_CODES = new Set([442, 170, 171]);

// server/src/geo.js ile aynı yardımcılar (sunucu olmadan çalışabilmek için kopya).
function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  const coords = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lon += delta;
    }
    coords.push([lat / factor, lon / factor]);
  }
  return coords;
}

function lineLength(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += distanceMeters(coords[i - 1], coords[i]);
  return total;
}

function midpointAlong(coords) {
  const half = lineLength(coords) / 2;
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = distanceMeters(coords[i - 1], coords[i]);
    if (walked + seg >= half) {
      const t = seg === 0 ? 0 : (half - walked) / seg;
      return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t];
    }
    walked += seg;
  }
  return coords[coords.length - 1];
}

function tinySquareRing([lat, lon], d = 5e-6) {
  return [
    [lon - d, lat - d],
    [lon + d, lat - d],
    [lon + d, lat + d],
    [lon - d, lat + d],
    [lon - d, lat - d],
  ];
}

// Kenar geometrisinden kısa ve kararlı bir kimlik (sunucudaki sha1 yerine FNV-1a).
function idForShape(shape) {
  let h = 0x811c9dc5;
  for (let i = 0; i < shape.length; i++) {
    h ^= shape.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + shape.length.toString(16);
}

// Valhalla'nın varış manevraları (düz, sağda, solda). Ara durakların sonundakiler "Ara durak" olarak yazılır.
const ARRIVAL_TYPES = new Set([4, 5, 6]);
export const MAX_STOPS = 3;

// server/src/app.js'teki buildRoute ile aynı biçim: ara duraklı rotanın bacakları tek çizgide birleşir.
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

export function createDemoApi(valhallaUrl = PUBLIC_VALHALLA_URL) {
  let state = null; // { version, closures (kaydedilmemiş), zones } — sunucudaki ClosureStore'un küçük kopyası

  async function load() {
    if (state) return state;
    try {
      state = JSON.parse(await AsyncStorage.getItem(STORAGE_KEY)) || null;
    } catch {
      state = null;
    }
    state ??= { version: 0, closures: [] };
    state.zones ??= [];
    return state;
  }

  // Trafiğe kapalı tüm segmentler: kaydedilmemişler + aktif grupların segmentleri.
  function effective(st) {
    const byId = new Map();
    for (const z of st.zones) {
      if (!z.active) continue;
      for (const seg of z.segments) if (!byId.has(seg.id)) byId.set(seg.id, { ...seg, zoneId: z.id, zoneName: z.name });
    }
    for (const c of st.closures) if (!byId.has(c.id)) byId.set(c.id, { ...c, zoneId: null, zoneName: null });
    return [...byId.values()];
  }

  async function update(fn) {
    const current = await load();
    const next = fn(current);
    await save({ ...next, version: current.version + 1 });
    return state;
  }

  async function save(next) {
    state = next;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }

  async function valhalla(action, body) {
    let res;
    try {
      res = await fetch(`${valhallaUrl}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Herkese açık rota sunucusuna ulaşılamadı. İnternet bağlantınızı kontrol edin.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error('Herkese açık rota sunucusu yoğun, birkaç saniye sonra tekrar deneyin.');
    if (!res.ok) {
      const err = new Error(data.error || `Rota sunucusu hatası (${res.status})`);
      err.code = data.error_code;
      throw err;
    }
    return data;
  }

  // Sunucudaki routeWithFallback ile aynı: arama sonucu büyük bir alanın (havalimanı, AVM)
  // ortasına düşüp dışarıdan girilemeyen bir iç yola bağlanırsa, noktaları önce en yakın
  // halka açık yola, olmazsa en yakın ana yola bağlayarak tekrar dener.
  async function routeWithFallback(hasClosures, body) {
    const attempts = [null, 'residential', 'tertiary'];
    for (const [i, minRoadClass] of attempts.entries()) {
      const locations = minRoadClass
        ? body.locations.map((l) => ({ ...l, search_filter: { min_road_class: minRoadClass } }))
        : body.locations;
      try {
        return { data: await valhalla('route', { ...body, locations }), snappedToRoad: Boolean(minRoadClass) };
      } catch (err) {
        if (!NO_ROUTE_CODES.has(err.code)) throw err;
        if (i === attempts.length - 1) {
          throw new Error(
            hasClosures
              ? 'Rota bulunamadı. Kapalı yollar hedefe giden yolu kesiyor olabilir.'
              : 'Bu noktaya araçla gidilebilen bir yol bulunamadı. Hedefe yakın başka bir nokta seçin.',
          );
        }
      }
    }
  }

  // Sunucudaki legSpeedLimits ile aynı: rota bacağının hız sınırları (OSM maxspeed), hata olursa boş.
  async function legSpeedLimits(leg, costing) {
    try {
      const data = await valhalla('trace_attributes', {
        encoded_polyline: leg.shape,
        costing,
        shape_match: 'edge_walk',
        filters: {
          attributes: ['edge.speed_limit', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape'],
          action: 'include',
        },
      });
      if (!data.shape || decodePolyline(data.shape).length !== decodePolyline(leg.shape).length) return [];
      const runs = [];
      for (const e of data.edges ?? []) {
        const kph = e.speed_limit;
        if (!(kph > 0 && kph < 200)) continue;
        const prev = runs[runs.length - 1];
        if (prev && prev.kph === kph && prev.to === e.begin_shape_index) prev.to = e.end_shape_index;
        else runs.push({ from: e.begin_shape_index, to: e.end_shape_index, kph });
      }
      return runs;
    } catch {
      return [];
    }
  }

  // Dokunulan noktadaki yol parçasını (iki kavşak arası) bulur.
  async function locateSegment(lat, lon) {
    const [result] = await valhalla('locate', { locations: [{ lat, lon }], costing: 'auto', verbose: true });
    const edge = result?.edges?.[0];
    if (!edge?.edge_info?.shape || (edge.distance ?? 0) > MAX_SNAP_METERS) {
      throw new Error('Dokunulan yere yakın bir araç yolu bulunamadı');
    }
    const shape = edge.edge_info.shape;
    const coordinates = decodePolyline(shape);
    return {
      id: idForShape(shape),
      wayId: edge.edge_info.way_id,
      name: (edge.edge_info.names ?? []).join(' / ') || 'İsimsiz yol',
      coordinates,
      midpoint: midpointAlong(coordinates),
      lengthMeters: Math.round(lineLength(coordinates)),
      createdAt: new Date().toISOString(),
    };
  }

  return {
    isDemo: true,

    async closures() {
      const st = await load();
      return { version: st.version, closures: effective(st), zones: st.zones };
    },

    async route({ from, to, via = [], costing: requested, heading, alternatives = false, avoidTolls = false }) {
      if (via.length > MAX_STOPS) throw new Error(`En fazla ${MAX_STOPS} ara durak eklenebilir`);
      const costing = requested === 'motorcycle' ? 'motorcycle' : 'auto';
      const st = await load();
      const { version } = st;
      const closures = effective(st);
      const origin = { lat: from.lat, lon: from.lon, type: 'break' };
      if (Number.isFinite(heading) && heading >= 0) {
        origin.heading = Math.round(heading) % 360;
        origin.heading_tolerance = 60;
      }
      const { data, snappedToRoad } = await routeWithFallback(closures.length > 0, {
        locations: [
          origin,
          ...via.map((p) => ({ lat: p.lat, lon: p.lon, type: 'break' })),
          { lat: to.lat, lon: to.lon, type: 'break' },
        ],
        costing,
        directions_options: { language: 'tr-TR', units: 'kilometers' },
        // Alternatifler de exclude_polygons'a uyar: hiçbiri kapalı yoldan geçmez.
        // Valhalla alternatif rotayı yalnızca iki noktalı rotalarda verir.
        ...(alternatives && !via.length ? { alternates: 2 } : {}),
        ...(avoidTolls ? { costing_options: { [costing]: { use_tolls: 0 } } } : {}),
        ...(closures.length ? { exclude_polygons: closures.map((c) => tinySquareRing(c.midpoint)) } : {}),
      });
      const traffic = trafficPeriod();
      const trips = [data.trip, ...(data.alternates ?? []).map((a) => a.trip)];
      // Herkese açık sunucuyu yormamak için hız sınırları sırayla istenir.
      const limits = [];
      for (const trip of trips) {
        const legs = [];
        for (const leg of trip.legs) legs.push(await legSpeedLimits(leg, costing));
        limits.push(legs);
      }
      // Sunucudaki gibi: yoğun saat tahminine göre en hızlıdan yavaşa.
      const routes = trips
        .map((trip, i) => buildRoute(trip, traffic.key, limits[i]))
        .sort((a, b) => a.durationSec - b.durationSec);
      return { closuresVersion: version, costing, avoidTolls, snappedToRoad, traffic, ...routes[0], routes };
    },

    async search(q) {
      const b = ISTANBUL_BBOX;
      const params = new URLSearchParams({
        q,
        format: 'jsonv2',
        limit: '8',
        bounded: '1',
        viewbox: `${b.minLon},${b.maxLat},${b.maxLon},${b.minLat}`,
        'accept-language': 'tr',
      });
      const r = await fetch(`${NOMINATIM_URL}/search?${params}`, {
        headers: { 'user-agent': 'istanbul-nav-prototype/0.1 (demo)' },
      }).catch(() => null);
      if (!r?.ok) throw new Error('Adres arama servisine ulaşılamadı.');
      const items = await r.json();
      return {
        results: items.map((i) => ({
          name: i.name || i.display_name.split(',')[0],
          address: i.display_name,
          lat: Number(i.lat),
          lon: Number(i.lon),
        })),
      };
    },

    // Demo modunda anahtar gerekmez; kapatmalar zaten yalnızca bu cihazdadır.
    checkAdmin: async () => ({ ok: true }),

    async toggleClosure({ lat, lon }) {
      const closure = await locateSegment(lat, lon);
      const { id } = closure;
      const current = await load();
      const zone = current.zones.find((z) => z.active && z.segments.some((seg) => seg.id === id));
      const existing = current.closures.find((c) => c.id === id);
      if (zone && !existing) throw new Error(`Bu yol "${zone.name}" grubuyla kapalı. Açmak için grubu trafiğe açın.`);
      if (existing) {
        await update((st) => ({ ...st, closures: st.closures.filter((c) => c.id !== id) }));
        return { action: 'opened', closure: existing, version: state.version };
      }
      await update((st) => ({ ...st, closures: [...st.closures, closure] }));
      return { action: 'closed', closure, version: state.version };
    },

    async saveZone(name) {
      const current = await load();
      if (!name?.trim()) throw new Error('Grup için bir isim girin');
      if (!current.closures.length) throw new Error('Kaydedilecek kapalı yol yok. Önce haritada yolları kapatın.');
      const now = new Date().toISOString();
      const zone = { id: Date.now().toString(36), name: name.trim().slice(0, 80), active: true, segments: current.closures, createdAt: now, updatedAt: now };
      await update((st) => ({ ...st, closures: [], zones: [...st.zones, zone] }));
      return { zone, version: state.version };
    },

    async setZoneActive(id, active) {
      await update((st) => ({
        ...st,
        zones: st.zones.map((z) => (z.id === id ? { ...z, active, updatedAt: new Date().toISOString() } : z)),
      }));
      return { zone: state.zones.find((z) => z.id === id), version: state.version };
    },

    // Tüm yolları aç: kaydedilmemiş kapatmalar silinir, gruplar kalır ama pasif olur.
    async openAll() {
      const current = await load();
      const removed = current.closures.length;
      const zonesOpened = current.zones.filter((z) => z.active).length;
      if (removed || zonesOpened) {
        await update((st) => ({ ...st, closures: [], zones: st.zones.map((z) => ({ ...z, active: false })) }));
      }
      return { removed, zonesOpened, version: state.version };
    },

    // Grup düzenleme: dokunulan yol gruptaysa çıkarılır, değilse eklenir.
    async toggleZoneSegment(zoneId, { lat, lon }) {
      const segment = await locateSegment(lat, lon);
      const current = await load();
      const zone = current.zones.find((z) => z.id === zoneId);
      if (!zone) throw new Error('Grup bulunamadı');
      const inZone = zone.segments.some((seg) => seg.id === segment.id);
      await update((st) => ({
        ...st,
        closures: st.closures.filter((c) => c.id !== segment.id),
        zones: st.zones.map((z) =>
          z.id !== zoneId
            ? z
            : {
                ...z,
                segments: inZone ? z.segments.filter((seg) => seg.id !== segment.id) : [...z.segments, segment],
                updatedAt: new Date().toISOString(),
              },
        ),
      }));
      return { action: inZone ? 'removed' : 'added', segment, zone: state.zones.find((z) => z.id === zoneId), version: state.version };
    },

    async renameZone(id, name) {
      if (!name?.trim()) throw new Error('Grup için bir isim girin');
      await update((st) => ({
        ...st,
        zones: st.zones.map((z) => (z.id === id ? { ...z, name: name.trim().slice(0, 80) } : z)),
      }));
      return { zone: state.zones.find((z) => z.id === id), version: state.version };
    },

    async deleteZone(id) {
      await update((st) => ({ ...st, zones: st.zones.filter((z) => z.id !== id) }));
      return { version: state.version };
    },
  };
}
