/**
 * Adres ve yer arama: yalnızca HERE (HERE_API_KEY). OpenStreetMap araması kullanılmaz; HERE
 * çalışmazsa sebebi hata olarak döner. Sonuçlar İstanbul kutusuyla sınırlıdır. Aynı mantık
 * mobile/src/search.js'te de var (demo modu).
 */

const HERE_DISCOVER_URL = 'https://discover.search.hereapi.com/v1/discover';
const MAX_RESULTS = 8;

const inBox = ({ lat, lon }, b) => lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;

/**
 * Sonucun alt satırı: "Veysel Karani Caddesi 136 Bağcılar İstanbul". Yerin adı, posta kodu ve
 * "Türkiye" yazılmaz. HERE'in Türkiye adres satırı "Ad, Cadde No, 34791, Mahalle, İlçe/İl, Türkiye"
 * biçimindedir. (mobile/src/search.js'teki ile aynı.)
 */
export function shortAddress(name, label, fields = {}) {
  if (!label) return '';
  const parts = String(label)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length && name && parts[0] === String(name).trim()) parts.shift();
  const rest = parts.filter((x) => !/^\d{5}$/.test(x) && !/^(Türkiye|Turkey)$/i.test(x));
  const regionPart = rest.find((x) => x.includes('/'));
  const region = regionPart ? regionPart.split('/').map((x) => x.trim()).join(' ') : '';
  const street = fields.street
    ? [fields.street, fields.houseNumber].filter(Boolean).join(' ')
    : (rest.find((x) => x !== regionPart) ?? '');
  const out = [street, region].filter(Boolean).join(' ');
  return out || rest.join(' ');
}

/**
 * HERE Discover → [{ name, address, lat, lon }]. Konum (near) varsa HERE'e gönderilir, İstanbul
 * dışındakiler atılır ve sonuçlar yakından uzağa sıralanır ("at" ile kutu birlikte gönderilemediği
 * için ülke filtresi kullanılır).
 */
export async function hereSearch(q, { apiKey, bbox, near = null, fetchImpl = fetch }) {
  const url = new URL(HERE_DISCOVER_URL);
  url.search = new URLSearchParams({
    q,
    ...(near
      ? { at: `${near.lat},${near.lon}`, in: 'countryCode:TUR', limit: '20' }
      : { in: `bbox:${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`, limit: String(MAX_RESULTS) }),
    lang: 'tr-TR',
    apiKey,
  }).toString();
  const r = await fetchImpl(url).catch(() => null);
  if (!r) throw new Error('HERE arama servisine ulaşılamadı');
  if (r.status === 401 || r.status === 403) throw new Error(`HERE anahtarı geçersiz ya da arama izni yok (${r.status})`);
  if (r.status === 429) throw new Error('HERE arama kotası doldu (429)');
  if (!r.ok) throw new Error(`HERE arama hatası (${r.status})`);
  const data = await r.json();
  const results = (data.items ?? [])
    .map((i) => {
      // Rota için binanın kapısı (yola bağlandığı nokta) varsa o, yoksa yerin kendisi.
      const p = i.access?.[0] ?? i.position;
      if (!p) return null;
      return {
        name: i.title,
        address: shortAddress(i.title, i.address?.label ?? '', i.address),
        lat: Number(p.lat),
        lon: Number(p.lng),
        distance: Number.isFinite(i.distance) ? i.distance : null,
      };
    })
    .filter((x) => x && inBox(x, bbox));
  if (near) results.sort((x, y) => (x.distance ?? Infinity) - (y.distance ?? Infinity));
  return results.slice(0, MAX_RESULTS).map(({ name, address, lat, lon }) => ({ name, address, lat, lon }));
}

/** Yalnızca HERE; anahtar yoksa hata. near: { lat, lon } (isteğe bağlı). */
export async function searchPlaces(q, { hereApiKey, bbox, near = null, fetchImpl = fetch }) {
  if (!hereApiKey) throw new Error('Adres arama için HERE anahtarı (HERE_API_KEY) tanımlı değil');
  return { results: await hereSearch(q, { apiKey: hereApiKey, bbox, near, fetchImpl }), source: 'here' };
}
