// Adres ve yer arama (demo modu). Sunucudaki server/src/search.js ile aynı mantık: yalnızca HERE
// (anahtar: EXPO_PUBLIC_HERE_API_KEY, EAS ortam değişkeni). OpenStreetMap araması kullanılmaz;
// HERE çalışmazsa sebebi ekranda yazar. Sonuçlar İstanbul kutusuyla sınırlıdır. Konum biliniyorsa
// HERE'e gönderilir ve sonuçlar yakından uzağa sıralanır.
import { ISTANBUL_BBOX, inIstanbul } from './geo';

const HERE_API_KEY = process.env.EXPO_PUBLIC_HERE_API_KEY || null;
const HERE_DISCOVER_URL = 'https://discover.search.hereapi.com/v1/discover';
const b = ISTANBUL_BBOX;
const MAX_RESULTS = 8;

/**
 * Sonucun alt satırı: "Veysel Karani Caddesi 136 Bağcılar İstanbul". Yerin adı, posta kodu ve
 * "Türkiye" yazılmaz. HERE'in Türkiye adres satırı "Ad, Cadde No, 34791, Mahalle, İlçe/İl, Türkiye"
 * biçimindedir; eski son aramalardaki uzun adresler de aynı şekilde kısaltılır.
 */
export function shortAddress(name, label, fields = {}) {
  if (!label) return '';
  const parts = String(label)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length && name && parts[0] === String(name).trim()) parts.shift();
  const rest = parts
    .map((x) => x.replace(/^\d{5}\s+/, '')) // "34200 Bağcılar/İstanbul" gibi bitişik posta kodu
    .filter((x) => !/^\d{5}$/.test(x) && !/^(Türkiye|Turkey)$/i.test(x));
  const regionPart = rest.find((x) => x.includes('/'));
  const region = regionPart ? regionPart.split('/').map((x) => x.trim()).join(' ') : '';
  const street = fields.street
    ? [fields.street, fields.houseNumber].filter(Boolean).join(' ')
    : (rest.find((x) => x !== regionPart) ?? '');
  const out = [street, region].filter(Boolean).join(' ');
  return out || rest.join(' ');
}

async function hereSearch(q, near) {
  // Konum varsa: HERE yakındakileri öne alır (at), biz de İstanbul dışındakileri atıp uzaklığa göre
  // sıralarız. "at" ile kutu (bbox) birlikte gönderilemediği için ülke filtresi kullanılır.
  const params = new URLSearchParams({
    q,
    ...(near
      ? { at: `${near.lat},${near.lon}`, in: 'countryCode:TUR', limit: '20' }
      : { in: `bbox:${b.minLon},${b.minLat},${b.maxLon},${b.maxLat}`, limit: String(MAX_RESULTS) }),
    lang: 'tr-TR',
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
    .filter((x) => x && inIstanbul(x));
  if (near) results.sort((x, y) => (x.distance ?? Infinity) - (y.distance ?? Infinity));
  return results.slice(0, MAX_RESULTS).map(({ name, address, lat, lon }) => ({ name, address, lat, lon }));
}

/** Yalnızca HERE. Anahtar APK'ya girmemişse bunu açıkça söyler. near: { lat, lon } (isteğe bağlı). */
export async function searchPlaces(q, near = null) {
  if (!HERE_API_KEY) {
    throw new Error("Adres arama için HERE anahtarı bu uygulamada yok. expo.dev'de EXPO_PUBLIC_HERE_API_KEY (preview) ekleyip APK'yı yeniden yapın.");
  }
  return hereSearch(q, near);
}
