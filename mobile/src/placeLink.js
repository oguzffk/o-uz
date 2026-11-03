// WhatsApp'tan ya da başka bir uygulamadan gelen konumu okur: Android'in "geo:" linkleri
// (geo:41.03,28.98?q=41.03,28.98(Ad)), Google Haritalar linkleri (maps.google.com/?q=…,
// google.com/maps/place/…/@…, kısa maps.app.goo.gl/… linkleri) ve "Paylaş" ile gelen metnin
// içindeki bu linkler ya da düz koordinatlar.

const GOOGLE_MAPS_LINK = /^https?:\/\/(?:(?:www\.|maps\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i;
const SHORT_LINK = /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i;

const valid = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

function safeDecode(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** Metnin içindeki koordinat: en kesin olandan (yerin kendisi) en kabasına (haritanın ortası). */
export function coordsIn(text) {
  const s = safeDecode(String(text));
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // google.com/maps/place/…/data=…!3d41.0!4d28.9
    /[?&](?:q|query|ll|daddr|destination|sll|center)=(?:loc:)?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /^geo:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/, // haritanın ortası
    /(?:^|[^\d.])(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/, // düz metin: "41.0312, 28.8543"
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && valid(Number(m[1]), Number(m[2]))) return { lat: Number(m[1]), lon: Number(m[2]) };
  }
  return null;
}

/** Yerin adı: geo linkinde "(Ad)", Google linkinde /maps/place/Ad/. */
function nameIn(text) {
  const s = safeDecode(String(text));
  const label = s.match(/[?&]q=[^&]*\(([^)]+)\)/);
  if (label) return label[1].trim();
  const place = s.match(/\/maps\/place\/([^/@?]+)/);
  if (place && !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(place[1].trim())) return place[1].trim();
  return null;
}

/** Konum yerine yazılı adres gelen geo linki: geo:0,0?q=Taksim Meydanı. */
function queryIn(text) {
  const m = String(text).match(/^geo:[^?]*\?(?:.*&)?q=([^&]+)/i);
  if (!m) return null;
  const q = safeDecode(m[1]).trim();
  return q && !coordsIn(`geo:${q}`) ? q : null;
}

/** Metindeki ilk konum linki (geo: ya da Google Haritalar); yoksa null. */
export function locationLinkIn(text) {
  const s = String(text ?? '').trim();
  if (/^geo:/i.test(s)) return s;
  const urls = s.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return urls.find((u) => GOOGLE_MAPS_LINK.test(u)) ?? null;
}

/** Bu metin bir konum mu taşıyor (link ya da düz koordinat)? Konum olmayan linkleri ayırmak için. */
export function looksLikeLocation(text) {
  return Boolean(locationLinkIn(text) || coordsIn(text));
}

// Kısa linkler (maps.app.goo.gl) açılınca uzun Google Haritalar adresine yönlenir; koordinat
// o adreste ya da sayfanın içinde yazar.
async function expandShortLink(url, fetchImpl) {
  const r = await fetchImpl(url);
  let finalUrl = r.url || url;
  const consent = finalUrl.match(/[?&]continue=([^&]+)/); // Google'ın çerez onayı sayfası
  if (/consent\.google\./.test(finalUrl) && consent) finalUrl = safeDecode(consent[1]);
  if (coordsIn(finalUrl)) return { url: finalUrl };
  const body = await r.text().catch(() => '');
  const inBody = body.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || body.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  return { url: finalUrl, coords: inBody && valid(Number(inBody[1]), Number(inBody[2])) ? { lat: Number(inBody[1]), lon: Number(inBody[2]) } : null };
}

/**
 * Gelen metinden yer: { lat, lon, name } ya da yazılı adres için { query }; konum yoksa null.
 */
export async function placeFromText(text, { fetchImpl = fetch } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  let link = locationLinkIn(raw) ?? raw;
  let coords = null;
  if (SHORT_LINK.test(link)) {
    const expanded = await expandShortLink(link, fetchImpl).catch(() => null);
    if (!expanded) throw new Error('Konum linki açılamadı. İnternet bağlantınızı kontrol edin.');
    link = expanded.url;
    coords = expanded.coords;
  }
  coords = coordsIn(link) ?? coords ?? coordsIn(raw);
  if (coords) return { ...coords, name: nameIn(link) };
  const query = queryIn(link);
  return query ? { query } : null;
}
