// Valhalla'nın Türkçe talimatları sokak adının arkasına her zaman "caddesine",
// "caddesinde" ya da "caddesi" ekliyor. İstanbul'daki adlar çoğunlukla zaten yol
// türüyle bittiği için ("Atatürk Caddesi", "Lale Sokak") ortaya "Atatürk Caddesi
// caddesine doğru sola dönün" gibi cümleler çıkıyor. Ad bilinen bir yol türüyle
// bitiyorsa tekrarı kaldırıp doğru eki kesme işaretiyle ekliyoruz:
// "Atatürk Caddesi'ne", "Lale Sokak'ta".
//
// Not: mobile/src/turkish.js bu dosyanın demo modu için kopyasıdır; ikisini birlikte güncelleyin.

// yol türü → [yönelme eki (-e), bulunma eki (-de)]
const ROAD_TYPES = {
  caddesi: ["'ne", "'nde"],
  sokak: ["'a", "'ta"],
  sokağı: ["'na", "'nda"],
  bulvarı: ["'na", "'nda"],
  yolu: ["'na", "'nda"],
  otoyolu: ["'na", "'nda"],
  köprüsü: ["'ne", "'nde"],
  meydanı: ["'na", "'nda"],
  tüneli: ["'ne", "'nde"],
  çıkmazı: ["'na", "'nda"],
  geçidi: ["'ne", "'nde"],
  yokuşu: ["'na", "'nda"],
  mahallesi: ["'ne", "'nde"],
  çevreyolu: ["'na", "'nda"],
};

// OSM'de sık görülen kısaltmalar: önce açılır, sonra ek getirilir.
const ABBREVIATIONS = { 'cd.': 'Caddesi', 'cad.': 'Caddesi', 'sk.': 'Sokak', 'sok.': 'Sokak', 'blv.': 'Bulvarı', 'bul.': 'Bulvarı' };

const lowerTr = (s) => s.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();

const PATTERN = /([0-9A-Za-zÇĞİÖŞÜçğıöşü.]+) cadde(sine|sinde|si)(?=[\s.,!?]|$)/g;

export function fixStreetSuffixes(text) {
  if (!text) return text;
  return text.replace(PATTERN, (match, word, suffix) => {
    const expanded = ABBREVIATIONS[lowerTr(word)] ?? word;
    const forms = ROAD_TYPES[lowerTr(expanded)];
    if (!forms) return match; // ad yol türüyle bitmiyor ("Bağdat caddesine"): olduğu gibi kalsın
    if (suffix === 'sine') return expanded + forms[0];
    if (suffix === 'sinde') return expanded + forms[1];
    return expanded; // "caddesi": tekrarı at
  });
}
