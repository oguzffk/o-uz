// Rota takibi için geometri yardımcıları. Koordinatlar [lat, lon] dizileridir.

const R = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;

export const ISTANBUL_BBOX = { minLon: 27.95, minLat: 40.78, maxLon: 29.95, maxLat: 41.6 };
export const ISTANBUL_REGION = { latitude: 41.0082, longitude: 28.9784, latitudeDelta: 0.12, longitudeDelta: 0.12 };

export function inIstanbul({ lat, lon }) {
  const b = ISTANBUL_BBOX;
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
}

export function distanceMeters([lat1, lon1], [lat2, lon2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Noktanın [a, b] doğru parçasına izdüşümü. Kısa mesafelerde düzlem yaklaşımı
 * (eş-dikdörtgen projeksiyon) yeterince doğru.
 */
function projectOnSegment(p, a, b) {
  const k = Math.cos(toRad(p[0]));
  const ax = a[1] * k, ay = a[0];
  const bx = b[1] * k, by = b[0];
  const px = p[1] * k, py = p[0];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { point, t, distance: distanceMeters(p, point) };
}

/**
 * Konumu rota çizgisine oturtur. `fromIndex` verilirse aramayı oradan başlatır
 * (seyir sırasında geriye atlamayı önler).
 */
export function snapToRoute(p, coords, fromIndex = 0) {
  let best = { index: fromIndex, point: coords[fromIndex] ?? p, distance: Infinity, t: 0 };
  for (let i = Math.max(0, fromIndex); i < coords.length - 1; i++) {
    const r = projectOnSegment(p, coords[i], coords[i + 1]);
    if (r.distance < best.distance) best = { index: i, ...r };
  }
  return best;
}

/** Oturtulmuş konumdan rota üzerindeki `targetIndex` noktasına kalan mesafe. */
export function distanceAlong(coords, snap, targetIndex) {
  if (targetIndex <= snap.index) return 0;
  let total = distanceMeters(snap.point, coords[snap.index + 1]);
  for (let i = snap.index + 1; i < targetIndex; i++) total += distanceMeters(coords[i], coords[i + 1]);
  return total;
}

export function formatDistance(meters) {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

export function formatDuration(sec) {
  const min = Math.round(sec / 60);
  if (min < 60) return `${Math.max(1, min)} dk`;
  return `${Math.floor(min / 60)} sa ${min % 60} dk`;
}

export const toLatLng = ([latitude, longitude]) => ({ latitude, longitude });

/** a'dan b'ye pusula yönü (derece, 0 = kuzey, saat yönünde). */
export function bearingDegrees([lat1, lon1], [lat2, lon2]) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Noktadan verilen yönde `meters` kadar ilerideki nokta (kısa mesafeler için düzlem yaklaşımı). */
export function offsetPoint([lat, lon], bearingDeg, meters) {
  const b = toRad(bearingDeg);
  const dLat = (meters * Math.cos(b)) / R;
  const dLon = (meters * Math.sin(b)) / (R * Math.cos(toRad(lat)));
  return [lat + (dLat * 180) / Math.PI, lon + (dLon * 180) / Math.PI];
}

/** Oturtulmuş konumdan rota boyunca `meters` ilerideki nokta (yön hesabı için). */
export function pointAhead(coords, snap, meters) {
  let remaining = meters;
  let from = snap.point;
  for (let i = snap.index + 1; i < coords.length; i++) {
    const seg = distanceMeters(from, coords[i]);
    if (seg >= remaining) {
      const t = seg === 0 ? 0 : remaining / seg;
      return [from[0] + (coords[i][0] - from[0]) * t, from[1] + (coords[i][1] - from[1]) * t];
    }
    remaining -= seg;
    from = coords[i];
  }
  return coords[coords.length - 1];
}

/** Şimdiden `sec` saniye sonrasının saati, "18:45" biçiminde (cihazın yerel saatiyle). */
export function formatArrival(sec, now = Date.now()) {
  const t = new Date(now + sec * 1000);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

/** Rotanın `index` numaralı parçasındaki hız sınırı (km/sa); bilinmiyorsa null. */
export function speedLimitAt(route, index) {
  const run = route?.speedLimits?.find((r) => r.from <= index && index < r.to);
  return run ? run.kph : null;
}

/**
 * Rotayı ara duraklara göre bacaklara böler: [{ index, endIndex, meters, durationSec }].
 * Son bacak hedefe gider; durak yoksa tek bacak rotanın tamamıdır.
 */
export function routeLegs(route) {
  const coords = route.coordinates;
  const ends = [...(route.stops ?? []).map((s) => s.shapeIndex), coords.length - 1];
  const legs = ends.map((endIndex, index) => ({ index, endIndex, meters: 0, durationSec: 0 }));
  let leg = 0;
  for (const m of route.maneuvers) {
    legs[leg].durationSec += m.durationSec;
    if (m.stop && leg < legs.length - 1) leg += 1; // durağa varış manevrası bacağı bitirir
  }
  let start = 0;
  for (const l of legs) {
    for (let i = start; i < l.endIndex; i++) l.meters += distanceMeters(coords[i], coords[i + 1]);
    start = l.endIndex;
  }
  return legs;
}

/** Rota başından her köşe noktasına kadar biriken mesafeler (metre). */
export function cumulativeDistances(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distanceMeters(coords[i - 1], coords[i]));
  return cum;
}

/** Oturtulmuş konumun rota başından itibaren mesafesi. */
export function snapDistance(coords, cum, snap) {
  return cum[snap.index] + distanceMeters(coords[snap.index], snap.point);
}

/** Rota başından `d` metre ilerideki nokta ve içinde bulunduğu parçanın başlangıç indeksi. */
export function pointAtDistance(coords, cum, d) {
  const last = coords.length - 1;
  if (d <= 0) return { point: coords[0], index: 0 };
  if (d >= cum[last]) return { point: coords[last], index: Math.max(0, last - 1) };
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const seg = cum[lo + 1] - cum[lo];
  const t = seg === 0 ? 0 : (d - cum[lo]) / seg;
  const a = coords[lo];
  const b = coords[lo + 1];
  return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], index: lo };
}
