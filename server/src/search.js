/**
 * Adres ve yer arama. HERE anahtarı (HERE_API_KEY) varsa HERE'in yer veritabanı kullanılır:
 * site, rezidans ve işletmelerde OpenStreetMap'ten çok daha eksiksiz. Anahtar yoksa ya da HERE
 * cevap vermezse OpenStreetMap'in arama servisi (Nominatim) kullanılır. Sonuçlar İstanbul
 * kutusuyla sınırlıdır. Aynı mantık mobile/src/search.js'te de var (demo modu).
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
  const r = await fetchImpl(url);
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

export async function nominatimSearch(q, { baseUrl, bbox, fetchImpl = fetch, limit = 8, userAgent }) {
  const url = new URL('/search', baseUrl);
  url.search = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: String(limit),
    bounded: '1',
    viewbox: `${bbox.minLon},${bbox.maxLat},${bbox.maxLon},${bbox.minLat}`,
    'accept-language': 'tr',
  }).toString();
  const r = await fetchImpl(url, { headers: { 'user-agent': userAgent } });
  if (!r.ok) throw new Error(`Arama servisi hatası (${r.status})`);
  const items = await r.json();
  return items.map((i) => ({
    name: i.name || i.display_name.split(',')[0],
    address: i.display_name,
    lat: Number(i.lat),
    lon: Number(i.lon),
  }));
}

/** HERE varsa önce HERE; hata olursa ya da anahtar yoksa Nominatim. */
export async function searchPlaces(q, { hereApiKey, nominatimUrl, bbox, fetchImpl = fetch, userAgent, log = console }) {
  if (hereApiKey) {
    try {
      return { results: await hereSearch(q, { apiKey: hereApiKey, bbox, fetchImpl }), source: 'here' };
    } catch (err) {
      log.warn?.(`HERE arama başarısız, OpenStreetMap'e geçiliyor: ${err.message}`);
    }
  }
  return { results: await nominatimSearch(q, { baseUrl: nominatimUrl, bbox, fetchImpl, userAgent }), source: 'osm' };
}
