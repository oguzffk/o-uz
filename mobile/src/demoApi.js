import AsyncStorage from '@react-native-async-storage/async-storage';
import { distanceMeters, snapToRoute } from './geo';
import { adjustedTime, trafficPeriod } from './traffic';
import { fixStreetSuffixes } from './turkish';
import { ApiError } from './api';
import { PRIVACY, TERMS } from './legal';
import { searchPlaces } from './search';

/**
 * Demo modu: kendi sunucumuz yerine OpenStreetMap topluluğunun herkese açık
 * Valhalla sunucusuna doğrudan bağlanır. Docker veya veri indirmesi gerekmez.
 * Kapatmalar yalnızca bu telefonda (AsyncStorage) tutulur, başkasına yansımaz.
 * Herkese açık sunucu adil kullanım içindir; sadece deneme amaçlı kullanın.
 */
export const PUBLIC_VALHALLA_URL = 'https://valhalla1.openstreetmap.de';
const STORAGE_KEY = 'demo-closures-v1';
const MAX_SNAP_METERS = 40;
// Sunucudaki gibi: dokunulan nokta kapalı bir yola bu kadar yakınsa (metre) o yol açılır; bulunan
// en yakın yoldan en fazla BIAS kadar uzak olmalı (yan yana şeritlerde diğerini kapatabilmek için).
const REOPEN_TAP_METERS = 25;
const REOPEN_BIAS_METERS = 8;
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

// { indications, valid, active } → { dirs, ok, best }; tüm şeritler uygunsa göstermeye gerek yok.
function simplifyLanes(lanes) {
  if (!Array.isArray(lanes) || lanes.length < 2) return null;
  const out = lanes.map((l) => ({
    dirs: (l.indications ?? []).filter((d) => d !== 'none'),
    ok: Boolean(l.valid),
    best: Boolean(l.active),
    ...(l.valid_indication ? { use: l.valid_indication } : {}),
  }));
  return out.every((l) => l.ok) || !out.some((l) => l.ok) ? null : out;
}

// server/src/app.js'teki buildRoute ile aynı biçim: ara duraklı rotanın bacakları tek çizgide birleşir.
function buildRoute(trip, periodKey, legSpeedLimits = [], legLanes = []) {
  const coordinates = [];
  const maneuvers = [];
  const stops = [];
  const speedLimits = [];
  trip.legs.forEach((leg, li) => {
    const offset = coordinates.length;
    const coords = decodePolyline(leg.shape);
    coordinates.push(...coords);
    const lastLeg = li === trip.legs.length - 1;
    leg.maneuvers.forEach((m, mi) => {
      const isStop = !lastLeg && ARRIVAL_TYPES.has(m.type);
      const lanes = isStop ? null : legLanes[li]?.[mi];
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
        ...(lanes ? { lanes } : {}),
      });
    });
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

// --- Demo hesapları ---
// Demo modunda sunucu olmadığı için hesaplar da bu telefonda tutulur (yalnızca deneme içindir;
// gerçek kullanımda hesaplar sunucuda, şifreler scrypt ile saklanır). İlk açılışta bir sahip
// hesabı hazır gelir; giriş ekranında yazar.
const USERS_KEY = 'demo-users-v1';
const DAY_MS = 24 * 60 * 60 * 1000;
export const DEMO_OWNER = { phone: '05000000000', password: 'hermap', email: 'sahip@hermap.demo' };
const CODE_TTL_MS = 10 * 60 * 1000;
const DEMO_PRODUCTS = { hermap_1gun: 1, hermap_3gun: 3, hermap_1hafta: 7 };
let usersState = null; // { users } — tüm demo API örnekleri aynı listeyi kullanır

const demoHash = (salt, password) => idForShape(`${salt}:${password}`) + idForShape(`${password}:${salt}`);
const randomToken = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('');
const tempPassword = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');

export function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ApiError('Geçerli bir e-posta adresi girin', 400);
  return email;
}

export function normalizePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('90') && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 10) digits = `0${digits}`;
  if (!/^0\d{10}$/.test(digits)) throw new ApiError('Geçerli bir telefon numarası girin (ör. 0532 123 45 67)', 400);
  return digits;
}

async function loadUsers() {
  if (usersState) return usersState;
  try {
    usersState = JSON.parse(await AsyncStorage.getItem(USERS_KEY)) || null;
  } catch {
    usersState = null;
  }
  // Önceki sürümde demo sahibinin e-postası yoktu.
  const demoOwner = usersState?.users.find((u) => u.id === 'owner');
  if (demoOwner && !demoOwner.email) demoOwner.email = DEMO_OWNER.email;
  if (!usersState) {
    const salt = randomToken();
    usersState = {
      users: [
        {
          id: 'owner',
          name: 'Sahip (demo)',
          phone: DEMO_OWNER.phone,
          email: DEMO_OWNER.email,
          role: 'owner',
          salt,
          passwordHash: demoHash(salt, DEMO_OWNER.password),
          mustChangePassword: false,
          expiresAt: null,
          session: null,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    await saveUsers();
  }
  return usersState;
}

async function saveUsers() {
  await AsyncStorage.setItem(USERS_KEY, JSON.stringify(usersState)).catch(() => {});
}

// Doğrulanmayı bekleyen kayıtlar (e-posta → bilgiler + kod); sunucudaki gibi yalnızca bellekte.
const pendingRegistrations = new Map();

function findByLogin(st, login) {
  const value = String(login ?? '').trim();
  try {
    return value.includes('@')
      ? st.users.find((u) => u.email === normalizeEmail(value))
      : st.users.find((u) => u.phone === normalizePhone(value));
  } catch {
    return null;
  }
}

// Sunucudaki #checkCode ile aynı: 10 dakika, 5 deneme, tek kullanımlık. `holder.code` kod kaydıdır.
function checkCode(holder, code, drop) {
  const entry = holder?.code;
  if (!entry) throw new ApiError('Kod hatalı ya da süresi dolmuş. Yeni kod isteyin.', 401);
  if (entry.expiresAt <= Date.now()) {
    drop();
    saveUsers();
    throw new ApiError('Kodun süresi doldu. Yeni kod isteyin.', 401);
  }
  entry.attempts += 1;
  if (String(code ?? '').trim() !== entry.code) {
    if (entry.attempts >= 5) drop();
    saveUsers();
    throw new ApiError(entry.attempts >= 5 ? 'Çok fazla hatalı deneme. Yeni kod isteyin.' : 'Kod hatalı', 401);
  }
}

const isActive = (u) => u.role !== 'member' || (u.expiresAt != null && u.expiresAt > Date.now());
const viewUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email ?? null,
  phone: u.phone ?? null,
  role: u.role,
  expiresAt: u.expiresAt ?? null,
  mustChangePassword: Boolean(u.mustChangePassword && u.sessionVia === 'password'),
  hasPassword: Boolean(u.passwordHash),
  active: isActive(u),
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt ?? null,
  lastPurchase: u.purchases?.at(-1) ?? null,
});

export function createDemoApi(valhallaUrl = PUBLIC_VALHALLA_URL, token = null) {
  // Sunucudaki yetki kontrollerinin aynısı.
  async function currentUser() {
    const st = await loadUsers();
    return (token && st.users.find((u) => u.session === token)) || null;
  }
  async function requireActive() {
    const u = await currentUser();
    if (!u) throw new ApiError('Oturum açın', 401, 'auth');
    if (viewUser(u).mustChangePassword) throw new ApiError('Önce kendi şifrenizi belirleyin', 403, 'password');
    if (!isActive(u)) throw new ApiError('Kullanım süreniz doldu', 402, 'expired');
    return u;
  }
  async function requireRole(...roles) {
    const u = await requireActive();
    if (!roles.includes(u.role)) throw new ApiError('Bu işlem için yetkiniz yok', 403, 'forbidden');
    return u;
  }
  const requireStaff = () => requireRole('owner', 'admin');
  // Tek cihaz: yeni giriş eski oturumu kapatır.
  async function startSession(u, via) {
    u.session = randomToken();
    u.sessionVia = via;
    u.lastLoginAt = new Date().toISOString();
    await saveUsers();
    return { token: u.session, user: viewUser(u) };
  }
  async function userById(id) {
    await requireRole('owner');
    const u = usersState.users.find((x) => x.id === id);
    if (!u) throw new ApiError('Kullanıcı bulunamadı', 404);
    return u;
  }

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
        const used = { ...body, locations };
        return { data: await valhalla('route', used), snappedToRoad: Boolean(minRoadClass), body: used };
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

  // Sunucudaki routeLanes ile aynı: şerit bilgisi yalnızca OSRM biçimli çıktıda geliyor.
  async function routeLanes(body, trips) {
    try {
      const data = await valhalla('route', { ...body, format: 'osrm' });
      return trips.map((trip, ti) =>
        trip.legs.map((leg, li) => {
          const steps = data.routes?.[ti]?.legs?.[li]?.steps ?? [];
          if (steps.length !== leg.maneuvers.length) return [];
          return steps.map((st) => simplifyLanes(st.intersections?.[0]?.lanes));
        }),
      );
    } catch {
      return [];
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
  // Dokunulan noktaya en yakın yol parçası ve noktanın ona uzaklığı (metre); yol yoksa null.
  async function locateNearest(lat, lon) {
    const [result] = await valhalla('locate', { locations: [{ lat, lon }], costing: 'auto', verbose: true });
    const edge = result?.edges?.[0];
    if (!edge?.edge_info?.shape || (edge.distance ?? 0) > MAX_SNAP_METERS) return null;
    return { segment: segmentFromEdge(edge), distance: edge.distance ?? 0 };
  }

  async function locateSegment(lat, lon) {
    const found = await locateNearest(lat, lon);
    if (!found) throw new Error('Dokunulan yere yakın bir araç yolu bulunamadı');
    return found.segment;
  }

  function segmentFromEdge(edge) {
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
      await requireActive();
      const st = await load();
      return { version: st.version, closures: effective(st), zones: st.zones };
    },

    async route({ from, to, via = [], costing: requested, heading, alternatives = false, avoidTolls = false }) {
      await requireActive();
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
      const { data, snappedToRoad, body: usedBody } = await routeWithFallback(closures.length > 0, {
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
      const lanes = await routeLanes(usedBody, trips);
      // Sunucudaki gibi: yoğun saat tahminine göre en hızlıdan yavaşa.
      const routes = trips
        .map((trip, i) => buildRoute(trip, traffic.key, limits[i], lanes[i]))
        .sort((a, b) => a.durationSec - b.durationSec);
      return { closuresVersion: version, costing, avoidTolls, snappedToRoad, traffic, ...routes[0], routes };
    },

    async search(q) {
      await requireActive();
      return { results: await searchPlaces(q) };
    },

    async toggleClosure({ lat, lon }) {
      await requireStaff();
      const current = await load();
      const located = await locateNearest(lat, lon);
      // Kapalı yola tekrar dokununca kesin açılsın (sunucudaki gibi): en yakın yol kavşakta ya da
      // çizginin biraz yanına dokununca yandaki sokak çıkabiliyor, açmak yerine onu kapatıyordu.
      const all = effective(current);
      const edgeClosed = located && all.some((c) => c.id === located.segment.id);
      let near = null;
      for (const c of all) {
        const distance = snapToRoute([lat, lon], c.coordinates).distance;
        if (distance <= REOPEN_TAP_METERS && (!near || distance < near.distance)) near = { closure: c, distance };
      }
      if (near && !edgeClosed && (!located || near.distance <= located.distance + REOPEN_BIAS_METERS)) {
        const target = near.closure;
        if (target.zoneId && !current.closures.some((c) => c.id === target.id)) {
          throw new Error(`Bu yol "${target.zoneName}" grubuyla kapalı. Açmak için grubu trafiğe açın.`);
        }
        const opened = current.closures.find((c) => c.id === target.id);
        await update((st) => ({ ...st, closures: st.closures.filter((c) => c.id !== target.id) }));
        return { action: 'opened', closure: opened, version: state.version };
      }
      if (!located) throw new Error('Dokunulan yere yakın bir araç yolu bulunamadı');
      const closure = located.segment;
      const { id } = closure;
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
      await requireStaff();
      const current = await load();
      if (!name?.trim()) throw new Error('Grup için bir isim girin');
      if (!current.closures.length) throw new Error('Kaydedilecek kapalı yol yok. Önce haritada yolları kapatın.');
      const now = new Date().toISOString();
      const zone = { id: Date.now().toString(36), name: name.trim().slice(0, 80), active: true, segments: current.closures, createdAt: now, updatedAt: now };
      await update((st) => ({ ...st, closures: [], zones: [...st.zones, zone] }));
      return { zone, version: state.version };
    },

    async setZoneActive(id, active) {
      await requireStaff();
      await update((st) => ({
        ...st,
        zones: st.zones.map((z) => (z.id === id ? { ...z, active, updatedAt: new Date().toISOString() } : z)),
      }));
      return { zone: state.zones.find((z) => z.id === id), version: state.version };
    },

    // Tüm yolları aç: kaydedilmemiş kapatmalar silinir, gruplar kalır ama pasif olur.
    async openAll() {
      await requireStaff();
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
      await requireStaff();
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
      await requireStaff();
      if (!name?.trim()) throw new Error('Grup için bir isim girin');
      await update((st) => ({
        ...st,
        zones: st.zones.map((z) => (z.id === id ? { ...z, name: name.trim().slice(0, 80) } : z)),
      }));
      return { zone: state.zones.find((z) => z.id === id), version: state.version };
    },

    async deleteZone(id) {
      await requireStaff();
      await update((st) => ({ ...st, zones: st.zones.filter((z) => z.id !== id) }));
      return { version: state.version };
    },

    // --- Oturum ---
    // Sunucudaki gibi: e-posta ya da telefon + şifre.
    async login(login, password) {
      const st = await loadUsers();
      const u = findByLogin(st, login);
      if (u && !u.passwordHash) {
        throw new ApiError('Bu hesabın şifresi yok. "E-posta koduyla giriş" ile girin ya da "Şifremi unuttum" ile şifre belirleyin.', 400);
      }
      if (!u || u.passwordHash !== demoHash(u.salt, String(password ?? ''))) {
        throw new ApiError('E-posta / telefon ya da şifre hatalı', 401);
      }
      return startSession(u, 'password');
    },
    // Kayıt ol: demo modunda e-posta gönderilmez; kod cevapta döner ve ekranda gösterilir.
    async register({ name, email, phone, password, acceptPrivacy, acceptTerms }) {
      const st = await loadUsers();
      if (acceptPrivacy !== true) throw new ApiError("Kayıt için Gizlilik Politikası ve KVKK Aydınlatma Metni'ni onaylayın", 400);
      if (acceptTerms !== true) throw new ApiError("Kayıt için Kullanım Koşulları ve Sorumluluk Reddi'ni kabul edin", 400);
      const cleanName = String(name ?? '').trim().slice(0, 80);
      if (!cleanName) throw new ApiError('Ad soyad girin', 400);
      const cleanEmail = normalizeEmail(email);
      const cleanPhone = normalizePhone(phone);
      if (String(password ?? '').length < 6) throw new ApiError('Şifre en az 6 karakter olmalı', 400);
      if (st.users.some((u) => u.email === cleanEmail)) throw new ApiError('Bu e-posta ile kayıtlı bir hesap var. Giriş yapın.', 409);
      if (st.users.some((u) => u.phone === cleanPhone)) throw new ApiError('Bu telefon numarasıyla kayıtlı bir hesap var. Giriş yapın.', 409);
      const prev = pendingRegistrations.get(cleanEmail);
      if (prev?.sentAt > Date.now() - 60000) throw new ApiError('Yeni kod için 1 dakika bekleyin.', 429);
      const salt = randomToken();
      const code = tempPassword();
      pendingRegistrations.set(cleanEmail, {
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        salt,
        passwordHash: demoHash(salt, String(password)),
        privacyAccepted: { version: PRIVACY.version, terms: TERMS.version, acceptedAt: new Date().toISOString() },
        code: { code, expiresAt: Date.now() + CODE_TTL_MS, attempts: 0 },
        sentAt: Date.now(),
      });
      return { ok: true, email: cleanEmail, demoCode: code };
    },
    async verifyRegistration(email, code) {
      const st = await loadUsers();
      let clean = '';
      try {
        clean = normalizeEmail(email);
      } catch {
        clean = '';
      }
      const reg = pendingRegistrations.get(clean);
      checkCode(reg, code, () => pendingRegistrations.delete(clean));
      pendingRegistrations.delete(clean);
      if (st.users.some((u) => u.email === reg.email || u.phone === reg.phone)) {
        throw new ApiError('Bu bilgilerle kayıtlı bir hesap var. Giriş yapın.', 409);
      }
      const { code: _code, sentAt: _sentAt, ...fields } = reg;
      const u = { id: randomToken(), ...fields, role: 'member', mustChangePassword: false, expiresAt: null, session: null, createdAt: new Date().toISOString() };
      st.users.push(u);
      return startSession(u, 'register');
    },
    async resetPasswordWithCode(email, code, newPassword) {
      const st = await loadUsers();
      if (String(newPassword ?? '').length < 6) throw new ApiError('Şifre en az 6 karakter olmalı', 400);
      let clean = '';
      try {
        clean = normalizeEmail(email);
      } catch {
        clean = '';
      }
      const u = st.users.find((x) => x.email === clean);
      checkCode(u && { code: u.emailCode }, code, () => (u.emailCode = null));
      u.emailCode = null;
      u.salt ??= randomToken();
      u.passwordHash = demoHash(u.salt, String(newPassword));
      u.mustChangePassword = false;
      return startSession(u, 'password');
    },
    // Demo modunda e-posta gönderilmez: kod cevapta döner ve giriş ekranında gösterilir.
    async requestEmailCode(email) {
      const st = await loadUsers();
      const clean = normalizeEmail(email);
      const u = st.users.find((x) => x.email === clean);
      if (!u) return { ok: true };
      if (u.lastCodeAt > Date.now() - 60000) throw new ApiError('Yeni kod için 1 dakika bekleyin.', 429);
      const code = tempPassword();
      u.lastCodeAt = Date.now();
      u.emailCode = { code, expiresAt: Date.now() + CODE_TTL_MS, attempts: 0 };
      await saveUsers();
      return { ok: true, demoCode: code };
    },
    async emailLogin(email, code) {
      const st = await loadUsers();
      let clean = '';
      try {
        clean = normalizeEmail(email);
      } catch {
        clean = '';
      }
      const u = st.users.find((x) => x.email === clean);
      checkCode(u && { code: u.emailCode }, code, () => (u.emailCode = null));
      u.emailCode = null;
      return startSession(u, 'email');
    },
    async me() {
      const u = await currentUser();
      if (!u) throw new ApiError('Oturum açın', 401, 'auth');
      return { user: viewUser(u) };
    },
    // Sunucudaki gibi: kendi hesabını siler (şifresi varsa şifreyle); sahip silinemez.
    async deleteAccount(password) {
      const u = await currentUser();
      if (!u) throw new ApiError('Oturum açın', 401, 'auth');
      if (u.role === 'owner') throw new ApiError('Sahip hesabı silinemez', 400);
      if (u.passwordHash && u.passwordHash !== demoHash(u.salt, String(password ?? ''))) throw new ApiError('Şifre hatalı', 401);
      usersState.users = usersState.users.filter((x) => x.id !== u.id);
      await saveUsers();
      return { ok: true };
    },
    async logout() {
      const u = await currentUser();
      if (u) {
        u.session = null;
        await saveUsers();
      }
      return { ok: true };
    },
    async changePassword(newPassword) {
      const u = await currentUser();
      if (!u) throw new ApiError('Oturum açın', 401, 'auth');
      const pw = String(newPassword ?? '');
      if (pw.length < 6) throw new ApiError('Şifre en az 6 karakter olmalı', 400);
      u.salt ??= randomToken();
      if (u.mustChangePassword && u.passwordHash === demoHash(u.salt, pw)) throw new ApiError('Yeni şifre eskisiyle aynı olamaz', 400);
      u.passwordHash = demoHash(u.salt, pw);
      u.mustChangePassword = false;
      await saveUsers();
      return { user: viewUser(u) };
    },

    // --- Üyeler, yöneticiler, ödeme bilgisi (yalnızca sahip) ---
    async users(role) {
      await requireRole('owner');
      return {
        users: usersState.users
          .filter((u) => u.role === role)
          .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
          .map(viewUser),
      };
    },
    // Sunucudaki gibi: üye = ad + e-posta (telefon isteğe bağlı), yönetici = ad + e-posta + telefon (+ geçici şifre).
    async createUser({ name, email, phone, role }) {
      await requireRole('owner');
      const admin = role === 'admin';
      const cleanName = String(name ?? '').trim().slice(0, 80);
      if (!cleanName) throw new ApiError('Ad soyad girin', 400);
      const cleanEmail = normalizeEmail(email);
      const cleanPhone = !admin && !String(phone ?? '').trim() ? null : normalizePhone(phone);
      if (usersState.users.some((u) => u.email === cleanEmail)) throw new ApiError('Bu e-posta adresiyle kayıtlı biri var', 409);
      if (cleanPhone && usersState.users.some((u) => u.phone === cleanPhone)) throw new ApiError('Bu telefon numarasıyla kayıtlı biri var', 409);
      const password = admin ? tempPassword() : null;
      const salt = randomToken();
      const u = {
        id: randomToken().slice(0, 12),
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        role: admin ? 'admin' : 'member',
        salt,
        passwordHash: password ? demoHash(salt, password) : null,
        mustChangePassword: Boolean(password),
        expiresAt: null,
        session: null,
        createdAt: new Date().toISOString(),
      };
      usersState.users.push(u);
      await saveUsers();
      return { user: viewUser(u), tempPassword: password };
    },
    async extendUser(id, days) {
      const u = await userById(id);
      if (u.role !== 'member') throw new ApiError('Süre yalnızca üyelere tanımlanır', 400);
      if (![1, 3, 7].includes(days)) throw new ApiError('Süre 1, 3 ya da 7 gün olabilir', 400);
      u.expiresAt = Math.max(Date.now(), u.expiresAt ?? 0) + days * DAY_MS;
      await saveUsers();
      return { user: viewUser(u) };
    },
    async expireUser(id) {
      const u = await userById(id);
      u.expiresAt = Date.now();
      await saveUsers();
      return { user: viewUser(u) };
    },
    async resetPassword(id) {
      const u = await userById(id);
      if (u.role === 'member') throw new ApiError('Üyeler şifre kullanmaz; e-postalarına gelen kodla girerler', 400);
      const password = tempPassword();
      u.passwordHash = demoHash(u.salt, password);
      u.mustChangePassword = true;
      u.session = null;
      await saveUsers();
      return { user: viewUser(u), tempPassword: password };
    },
    async deleteUser(id) {
      const u = await userById(id);
      if (u.role === 'owner') throw new ApiError('Sahip hesabı silinemez', 400);
      usersState.users = usersState.users.filter((x) => x.id !== id);
      await saveUsers();
      return { user: viewUser(u) };
    },
    // Demo satın alma: gerçek ödeme yok; paket günü kadar süre bu telefonda eklenir (sunucudaki
    // mağaza bildiriminin yaptığının aynısı).
    async purchase(productId) {
      const u = await currentUser();
      if (!u) throw new ApiError('Oturum açın', 401, 'auth');
      const days = DEMO_PRODUCTS[productId];
      if (!days) throw new ApiError('Bilinmeyen paket', 400);
      u.expiresAt = Math.max(Date.now(), u.expiresAt ?? 0) + days * DAY_MS;
      u.purchases = [...(u.purchases ?? []), { transactionId: randomToken(), productId, days, store: 'DEMO', at: new Date().toISOString() }];
      await saveUsers();
      return { user: viewUser(u) };
    },
  };
}
