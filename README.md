# İstanbul Navigasyon — prototip

Telefon odaklı, İstanbul'a özel bir navigasyon uygulaması:

- **Gerçek sokak ağı:** OpenStreetMap'ten yalnızca İstanbul'un yol verisi çıkarılır, rotaları **Valhalla** hesaplar.
- **Yol kapatma:** Yönetici haritada herhangi bir sokağa dokunarak o segmenti kapatır / tekrar açar. Kapalı yollar **tüm kullanıcıların** rotalarından anında çıkarılır; seyirdeki telefonlar da birkaç saniye içinde yeni rotaya geçer.
- **Mobil uygulama:** Expo (React Native) — arama, rota önizleme, sesli Türkçe yönlendirme, rotadan çıkınca yeniden hesaplama.

```
 ┌─────────────┐   /api/route, /api/closures   ┌──────────────┐  route + exclude_polygons  ┌──────────────┐
 │ Expo uygul. │ ─────────────────────────────▶│  API (Node)  │ ──────────────────────────▶│   Valhalla   │
 │ (telefon)   │◀───── 5 sn'de bir kapalı yol ─│  :3000       │ ◀── locate (dokunulan yol) │   :8002      │
 └─────────────┘        sürümü kontrolü        │  closures.json│                            │ İstanbul OSM │
 ┌─────────────┐   /api/closures/toggle        │  /admin paneli│                            └──────────────┘
 │ Yönetici    │ ─────────────────────────────▶│              │
 └─────────────┘                               └──────────────┘
```

## Neden Valhalla (OSRM değil)?

OSRM hızlıdır ama yol ağını önceden "contract" eder; bir yolu kapatmak için grafiği yeniden işlemek gerekir (İstanbul için dakikalar). Valhalla ise her rota isteğinde `exclude_polygons` parametresi alır. API, her kapalı segmentin ortasına ~1 m'lik bir poligon koyup bunu isteğe ekler; böylece **kapatma/açma anında geçerli olur, hiçbir şey yeniden derlenmez.** Bu, otoyol gibi Valhalla'nın "shortcut" kenarlarında da çalışır (test edildi).

## Gereksinimler

- Docker Desktop (veya Docker Engine + Compose)
- Node.js 20+
- Telefonda **Expo Go** uygulaması (bilgisayarla aynı Wi-Fi ağında)
- Windows'ta `scripts/download-istanbul.sh` için WSL ya da Git Bash

## Kurulum

### 1) İstanbul yol verisini indir

```bash
./scripts/download-istanbul.sh
```

Geofabrik'ten Türkiye özütünü (~600 MB) indirir, İstanbul il sınırını kapsayan kutuyu (`27.95,40.78 – 29.95,41.60`) keser, yalnızca `highway=*` yollarını, feribot hatlarını ve dönüş yasaklarını bırakır. Sonuç: `valhalla/custom_files/istanbul.osm.pbf`. Bilgisayarınızda `osmium` yoksa betik onu Docker içinde çalıştırır.

### 2) Rota motorunu ve API'yi başlat

```bash
ADMIN_TOKEN=gizli-bir-anahtar docker compose up -d
docker compose logs -f valhalla   # ilk açılışta grafik kurulur (birkaç dakika)
```

Hazır olduğunu kontrol edin:

```bash
curl http://localhost:3000/api/health
```

`ADMIN_TOKEN` vermezseniz geliştirme anahtarı `istanbul-admin` kullanılır.

> API'yi Docker yerine doğrudan çalıştırmak isterseniz: `cd server && npm install && ADMIN_TOKEN=... npm run dev` (Valhalla'yı yine `docker compose up -d valhalla` ile açın).

### 3) Yönetici paneli (masaüstü)

Tarayıcıda **http://localhost:3000/admin/** açın, yönetici anahtarını girin:

- **Yol kapat / aç:** Bir sokağa tıklayın → iki kavşak arasındaki o segment kırmızı olur ve kapanır. Kırmızı çizgiye tekrar tıklamak (veya listedeki **Aç**) yolu açar.
- **Rota dene:** İki nokta seçip rotanın kapalı yolların etrafından dolaştığını görün.

Panel değişiklikleri canlı izler; başka bir yöneticinin kapattığı yol da anında görünür.

### 4) Mobil uygulama

```bash
cd mobile
npm install
npx expo start
```

Telefonda Expo Go ile QR kodu okutun. Uygulama API adresini otomatik olarak Expo'yu çalıştıran bilgisayarın IP'si üzerinden bulur (`http://<bilgisayar-ip>:3000`). Gerekirse ⚙︎ **Ayarlar**'dan değiştirin ya da `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 npx expo start` kullanın.

| İşlem | Nasıl |
| --- | --- |
| Hedef seç | Arama kutusuna yazın veya haritada **basılı tutun** |
| Seyre başla | **Başla** — kamera sizi takip eder, talimatlar Türkçe okunur |
| Ulaşım türü | Ayarlar → Araç / Motor / Bisiklet / Yaya |
| Yönetici modu | Ayarlar → anahtarı girin, **Yönetici modu**nu açın → sokağa **dokunun** = kapat/aç |

Telefon İstanbul dışındaysa (ör. emülatör) ilk basılı tutma **başlangıç**, ikincisi **varış** noktasını seçer; böylece rota önizlemesini her yerden deneyebilirsiniz.

## API

| Uç nokta | Açıklama |
| --- | --- |
| `POST /api/route` `{from:{lat,lon}, to:{lat,lon}, costing?, heading?}` | Kapalı yolları dışlayan rota; Türkçe manevralar, `closuresVersion` |
| `GET /api/closures` | `{version, closures[]}` — her değişiklikte `version` artar |
| `GET /api/closures/stream` | Değişiklikler için Server-Sent Events |
| `POST /api/closures/toggle` `{lat,lon}` 🔒 | Dokunulan noktadaki segmenti kapatır, kapalıysa açar |
| `DELETE /api/closures/:id` 🔒 | Kapatmayı kaldırır |
| `GET /api/search?q=` | İstanbul ile sınırlı adres arama (Nominatim) |

🔒 = `x-admin-token` başlığı gerekir.

## Testler

```bash
cd server && npm test
```

## Prototipin sınırları ve sonraki adımlar

- **Kapatma birimi** iki kavşak arası segmenttir. Uzun bir caddeyi kapatmak için birkaç segmente dokunmak gerekir. Sonraki adım: "tüm caddeyi kapat" (aynı OSM `way_id`'ye sahip segmentler) ve süreli kapatmalar.
- **Kapatma sayısı:** Valhalla'nın varsayılan `max_exclude_polygons_length` (10 km) sınırıyla yaklaşık 2.500 eşzamanlı kapalı segment desteklenir; daha fazlası için Valhalla yapılandırmasında bu sınır artırılmalı.
- **Kapatmalar** `server/data/closures.json` dosyasında tutulur; çok sunuculu kurulumda PostgreSQL/Redis'e taşınmalı.
- **Yönetici kimlik doğrulaması** tek bir paylaşılan anahtardır; gerçek kullanımda kullanıcı hesapları + rol yönetimi gerekir.
- **Harita karoları ve arama** OpenStreetMap'in ücretsiz sunucularından gelir (`tile.openstreetmap.org`, Nominatim). Bunlar yoğun kullanım için değildir; yayına çıkmadan önce kendi karo sunucunuzu / ticari bir sağlayıcıyı ve kendi geocoder'ınızı kullanın.
- **Trafik verisi yok:** Süreler yol tipine göre tahmin edilir.
- Expo Go yerine kalıcı bir uygulama için `npx expo run:android|ios` veya EAS Build ile development build alın. Üretimde API HTTPS arkasında olmalı (iOS/Android düz HTTP'yi engeller).
- OSM verisini güncellemek için betiği tekrar çalıştırın, ardından `force_rebuild=True` ile Valhalla'yı bir kez yeniden başlatın.

Harita verisi © OpenStreetMap katkıcıları, ODbL lisansı.
