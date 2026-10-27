// Adres ve yer arama (demo modu). Sunucudaki server/src/search.js ile aynı mantık: HERE anahtarı
// (EXPO_PUBLIC_HERE_API_KEY, EAS ortam değişkeni) varsa HERE'in yer veritabanı kullanılır —
// site, rezidans ve işletmelerde OpenStreetMap'ten çok daha eksiksiz. Anahtar yoksa ya da HERE
// cevap vermezse OpenStreetMap araması (Nominatim). Sonuçlar İstanbul kutusuyla sınırlıdır.
import { ISTANBUL_BBOX } from './geo';

const HERE_API_KEY = process.env.EXPO_PUBLIC_HERE_API_KEY || null;
const HERE_DISCOVER_URL = 'https://discover.search.hereapi.com/v1/discover';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const b = ISTANBUL_BBOX;

async function hereSearch(q) {
  const params = new URLSearchParams({
    q,
    in: `bbox:${b.minLon},${b.minLat},${b.maxLon},${b.maxLat}`,
    lang: 'tr-TR',
    limit: '8',
    apiKey: HERE_API_KEY,
  });
  const r = await fetch(`${HERE_DISCOVER_URL}?${params}`);
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

async function nominatimSearch(q) {
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
  return items.map((i) => ({
    name: i.name || i.display_name.split(',')[0],
    address: i.display_name,
    lat: Number(i.lat),
    lon: Number(i.lon),
  }));
}

/** HERE varsa önce HERE; hata olursa ya da anahtar yoksa OpenStreetMap. */
export async function searchPlaces(q) {
  if (HERE_API_KEY) {
    try {
      return await hereSearch(q);
    } catch {
      // HERE'e ulaşılamazsa arama bozulmasın
    }
  }
  return nominatimSearch(q);
}
