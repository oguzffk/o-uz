/**
 * Adres ve yer arama: yalnızca HERE (HERE_API_KEY). OpenStreetMap araması kullanılmaz; HERE
 * çalışmazsa sebebi hata olarak döner. Sonuçlar İstanbul kutusuyla sınırlıdır. Aynı mantık
 * mobile/src/search.js'te de var (demo modu).
 */

const HERE_DISCOVER_URL = 'https://discover.search.hereapi.com/v1/discover';

/** HERE Discover: { title, address.label, position, access[] } → { name, address, lat, lon }. */
export async function hereSearch(q, { apiKey, bbox, fetchImpl = fetch, limit = 8 }) {
  const url = new URL(HERE_DISCOVER_URL);
  url.search = new URLSearchParams({
    q,
    in: `bbox:${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
    lang: 'tr-TR',
    limit: String(limit),
    apiKey,
  }).toString();
  const r = await fetchImpl(url).catch(() => null);
  if (!r) throw new Error('HERE arama servisine ulaşılamadı');
  if (r.status === 401 || r.status === 403) throw new Error(`HERE anahtarı geçersiz ya da arama izni yok (${r.status})`);
  if (r.status === 429) throw new Error('HERE arama kotası doldu (429)');
  if (!r.ok) throw new Error(`HERE arama hatası (${r.status})`);
  const data = await r.json();
  return (data.items ?? [])
    .map((i) => {
      // Rota için binanın kapısı (yola bağlandığı nokta) varsa o, yoksa yerin kendisi.
      const p = i.access?.[0] ?? i.position;
      if (!p) return null;
      return { name: i.title, address: i.address?.label ?? i.title, lat: Number(p.lat), lon: Number(p.lng) };
    })
    .filter(Boolean);
}

/** Yalnızca HERE; anahtar yoksa hata. */
export async function searchPlaces(q, { hereApiKey, bbox, fetchImpl = fetch }) {
  if (!hereApiKey) throw new Error('Adres arama için HERE anahtarı (HERE_API_KEY) tanımlı değil');
  return { results: await hereSearch(q, { apiKey: hereApiKey, bbox, fetchImpl }), source: 'here' };
}
