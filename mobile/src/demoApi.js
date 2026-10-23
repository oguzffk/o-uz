import AsyncStorage from '@react-native-async-storage/async-storage';
import { ISTANBUL_BBOX, distanceMeters } from './geo';

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
      if (data.error_code === 442) throw new Error('Rota bulunamadı (kapalı yollar nedeniyle hedefe ulaşılamıyor olabilir)');
      throw new Error(data.error || `Rota sunucusu hatası (${res.status})`);
    }
    return data;
  }

  return {
    isDemo: true,

    async closures() {
      const st = await load();
      return { version: st.version, closures: effective(st), zones: st.zones };
    },

    async route({ from, to, costing: requested, heading }) {
      const costing = requested === 'motorcycle' ? 'motorcycle' : 'auto';
      const st = await load();
      const { version } = st;
      const closures = effective(st);
      const origin = { lat: from.lat, lon: from.lon, type: 'break' };
      if (Number.isFinite(heading) && heading >= 0) {
        origin.heading = Math.round(heading) % 360;
        origin.heading_tolerance = 60;
      }
      const data = await valhalla('route', {
        locations: [origin, { lat: to.lat, lon: to.lon, type: 'break' }],
        costing,
        directions_options: { language: 'tr-TR', units: 'kilometers' },
        ...(closures.length ? { exclude_polygons: closures.map((c) => tinySquareRing(c.midpoint)) } : {}),
      });
      const leg = data.trip.legs[0];
      return {
        closuresVersion: version,
        costing,
        distanceKm: data.trip.summary.length,
        durationSec: Math.round(data.trip.summary.time),
        coordinates: decodePolyline(leg.shape),
        maneuvers: leg.maneuvers.map((m) => ({
          type: m.type,
          instruction: m.instruction,
          verbalPre: m.verbal_pre_transition_instruction ?? m.instruction,
          verbalAlert: m.verbal_transition_alert_instruction ?? null,
          streetNames: m.street_names ?? [],
          distanceKm: m.length,
          durationSec: Math.round(m.time),
          beginShapeIndex: m.begin_shape_index,
          endShapeIndex: m.end_shape_index,
        })),
      };
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
      const [result] = await valhalla('locate', { locations: [{ lat, lon }], costing: 'auto', verbose: true });
      const edge = result?.edges?.[0];
      if (!edge?.edge_info?.shape || (edge.distance ?? 0) > MAX_SNAP_METERS) {
        throw new Error('Dokunulan yere yakın bir araç yolu bulunamadı');
      }
      const shape = edge.edge_info.shape;
      const id = idForShape(shape);
      const current = await load();
      const zone = current.zones.find((z) => z.active && z.segments.some((seg) => seg.id === id));
      const existing = current.closures.find((c) => c.id === id);
      if (zone && !existing) throw new Error(`Bu yol "${zone.name}" grubuyla kapalı. Açmak için grubu trafiğe açın.`);
      if (existing) {
        await update((st) => ({ ...st, closures: st.closures.filter((c) => c.id !== id) }));
        return { action: 'opened', closure: existing, version: state.version };
      }
      const coordinates = decodePolyline(shape);
      const closure = {
        id,
        wayId: edge.edge_info.way_id,
        name: (edge.edge_info.names ?? []).join(' / ') || 'İsimsiz yol',
        coordinates,
        midpoint: midpointAlong(coordinates),
        lengthMeters: Math.round(lineLength(coordinates)),
        createdAt: new Date().toISOString(),
      };
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

    async deleteZone(id) {
      await update((st) => ({ ...st, zones: st.zones.filter((z) => z.id !== id) }));
      return { version: state.version };
    },
  };
}
