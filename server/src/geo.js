// Küçük coğrafi yardımcılar. Koordinatlar her yerde [lat, lon] sırasındadır.

const EARTH_RADIUS_M = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;

/** Valhalla'nın encoded polyline formatını çözer (varsayılan hassasiyet 1e6). */
export function decodePolyline(str, precision = 6) {
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

export function haversineMeters([lat1, lon1], [lat2, lon2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Noktanın çizgiye en kısa uzaklığı (metre). Kısa mesafelerde düzlem yaklaşımı yeterli. */
export function distanceToLineMeters([lat, lon], coords) {
  const k = Math.cos(toRad(lat));
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [aLat, aLon] = coords[i];
    const [bLat, bLon] = coords[i + 1];
    const ax = aLon * k, ay = aLat, bx = bLon * k, by = bLat, px = lon * k, py = lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    best = Math.min(best, haversineMeters([lat, lon], [aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t]));
  }
  if (coords.length === 1) best = haversineMeters([lat, lon], coords[0]);
  return best;
}

export function lineLengthMeters(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineMeters(coords[i - 1], coords[i]);
  return total;
}

/** Çizginin uzunluğunun tam ortasındaki nokta. */
export function midpointAlong(coords) {
  if (coords.length === 1) return coords[0];
  const half = lineLengthMeters(coords) / 2;
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineMeters(coords[i - 1], coords[i]);
    if (walked + seg >= half) {
      const t = seg === 0 ? 0 : (half - walked) / seg;
      const [aLat, aLon] = coords[i - 1];
      const [bLat, bLon] = coords[i];
      return [aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t];
    }
    walked += seg;
  }
  return coords[coords.length - 1];
}

/**
 * Bir noktanın etrafında çok küçük kapalı bir kare (Valhalla exclude_polygons
 * formatında: [lon, lat] halkası). Kenarı ~1 m; yalnızca o noktadan geçen
 * kenara değecek kadar küçük tutuluyor ki komşu sokaklar etkilenmesin.
 */
export function tinySquareRing([lat, lon], halfSizeDeg = 5e-6) {
  const d = halfSizeDeg;
  return [
    [lon - d, lat - d],
    [lon + d, lat - d],
    [lon + d, lat + d],
    [lon - d, lat + d],
    [lon - d, lat - d],
  ];
}
