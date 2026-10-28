// Adres ve yer arama (demo modu). Sunucudaki server/src/search.js ile aynı mantık: yalnızca HERE
// (anahtar: EXPO_PUBLIC_HERE_API_KEY, EAS ortam değişkeni). OpenStreetMap araması kullanılmaz;
// HERE çalışmazsa sebebi ekranda yazar. Sonuçlar İstanbul kutusuyla sınırlıdır.
import { ISTANBUL_BBOX } from './geo';

const HERE_API_KEY = process.env.EXPO_PUBLIC_HERE_API_KEY || null;
const HERE_DISCOVER_URL = 'https://discover.search.hereapi.com/v1/discover';
const b = ISTANBUL_BBOX;

async function hereSearch(q) {
  const params = new URLSearchParams({
    q,
    in: `bbox:${b.minLon},${b.minLat},${b.maxLon},${b.maxLat}`,
    lang: 'tr-TR',
    limit: '8',
    apiKey: HERE_API_KEY,
  });
  const r = await fetch(`${HERE_DISCOVER_URL}?${params}`).catch(() => null);
  if (!r) throw new Error('HERE arama servisine ulaşılamadı. İnternet bağlantınızı kontrol edin.');
  if (r.status === 401 || r.status === 403) {
    throw new Error(`HERE anahtarı geçersiz ya da arama izni yok (${r.status}). Anahtarı kontrol edin.`);
  }
  if (r.status === 429) throw new Error('HERE arama kotası doldu (429). Biraz sonra tekrar deneyin.');
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

/** Yalnızca HERE. Anahtar APK'ya girmemişse bunu açıkça söyler. */
export async function searchPlaces(q) {
  if (!HERE_API_KEY) {
    throw new Error("Adres arama için HERE anahtarı bu uygulamada yok. expo.dev'de EXPO_PUBLIC_HERE_API_KEY (preview) ekleyip APK'yı yeniden yapın.");
  }
  return hereSearch(q);
}
