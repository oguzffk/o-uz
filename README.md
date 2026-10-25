# İstanbul Navigasyon — prototip

Telefon odaklı, İstanbul'a özel bir navigasyon uygulaması:

- **Gerçek sokak ağı:** OpenStreetMap'ten yalnızca İstanbul'un yol verisi çıkarılır, rotaları **Valhalla** hesaplar.
- **Yol kapatma:** Yönetici haritada herhangi bir sokağa dokunarak o segmenti kapatır / tekrar açar. Kapalı yollar **tüm kullanıcıların** rotalarından anında çıkarılır; seyirdeki telefonlar da birkaç saniye içinde yeni rotaya geçer.
- **Kayıtlı gruplar:** Kapatılan yollar bir isimle kaydedilir ("Maraton güzergâhı" gibi). Sonra menüden tek dokunuşla o grubun tamamı trafiğe kapatılır ya da açılır.
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

## En hızlı deneme: demo modu (Docker gerekmez)

Sadece Node.js ve telefonda **Expo Go** yeterli:

```bash
cd mobile
npm install
npx expo start
```

Telefonda Expo Go ile QR kodu okutun. Uygulama varsayılan olarak **demo modunda** açılır: rotaları OpenStreetMap topluluğunun herkese açık Valhalla sunucusundan (`valhalla1.openstreetmap.de`) alır; gerçek İstanbul sokakları, Türkçe sesli yönlendirme ve yol kapatma çalışır. Farkları:

- Kapattığınız yollar **yalnızca o telefonda** geçerlidir, diğer kullanıcılara yansımaz.
- Herkese açık sunucu adil kullanım içindir; yalnızca deneme amaçlı kullanın.

Tam sürüm (kapatmalar herkese yansır) için aşağıdaki kurulumu yapıp uygulamada ⚙︎ **Ayarlar → Rota sunucusu → Kendi sunucum** seçin.

## Android APK (Play Store olmadan kurulum)

Expo'nun ücretsiz bulut derleme servisi (EAS Build) ile kurulabilir bir APK üretilir:

1. https://expo.dev adresinde ücretsiz hesap açın.
2. Google Cloud Console'da **Maps SDK for Android**'i etkinleştirip bir API anahtarı oluşturun (Expo Go dışında haritanın görünmesi için gerekli). Anahtarı yalnızca "Maps SDK for Android" ile sınırlayın.
3. `mobile` klasöründe:
   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest init
   npx eas-cli@latest env:create --name GOOGLE_MAPS_API_KEY --value <ANAHTAR> --environment preview --visibility sensitive
   npx eas-cli@latest build --platform android --profile apk
   ```
4. Derleme bitince verilen linkten APK'yı telefona indirip kurun ("bilinmeyen kaynaklar" iznini bir kez verin).

Anahtar dosyalara yazılmaz; `app.config.js` onu derleme sırasında ortam değişkeninden okur. APK demo modunda çalışır; "Kendi sunucum" için sunucunun internetten **https** ile erişilebilir olması gerekir.

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

- **Kayıtlı gruplar:** Yolları kapattıktan sonra bir isim yazıp **Kaydet**'e basın. Grup listede görünür; **Trafiğe aç / Trafiğe kapat** ile tüm yollar tek seferde açılıp kapanır. Trafiğe açık grupların yolları haritada kesik kırmızı çizgiyle gösterilir.

Panel değişiklikleri canlı izler; başka bir yöneticinin kapattığı yol da anında görünür.

### 4) Mobil uygulama

```bash
cd mobile
npm install
npx expo start
```

Telefonda Expo Go ile QR kodu okutun, ⚙︎ **Ayarlar → Rota sunucusu → Kendi sunucum** seçin. Uygulama API adresini otomatik olarak Expo'yu çalıştıran bilgisayarın IP'si üzerinden bulur (`http://<bilgisayar-ip>:3000`). Gerekirse ⚙︎ **Ayarlar**'dan değiştirin ya da `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 npx expo start` kullanın.

| İşlem | Nasıl |
| --- | --- |
| Nereden / Nereye | Üstteki iki kutu. **Nereden** varsayılan olarak **Konumum**; başka bir yer de aranabilir (listenin başında "Konumum" seçeneği). **⇅** ikisini yer değiştirir. Haritada **basılı tutmak** varışı seçer |
| Ara durak | Rota çizilince kartın altındaki **＋ Ara durak ekle** (en fazla 3). Durak aranır ya da haritada basılı tutularak seçilir; **✕** kaldırır, sağdaki **≡** tutamağından sürükleyerek sırası değiştirilir (rota yeni sırayla yeniden hesaplanır), **⇅** durakların sırasını da ters çevirir. Duraklı rotada alternatif rota verilmez. Seyirde durağa yaklaşınca "1. ara durağa varmak üzeresiniz" denir; geçilen duraklar yeniden rota hesaplanırken atlanır |
| Son aramalar | Bir kutuya dokununca (yazmadan) son seçilen yerler listelenir; cihazda saklanır, **Temizle** ile silinir |
| Rota seçenekleri | En fazla 3 rota; gri alternatife ya da alttaki karta dokunarak seçin. Her kartta süre, mesafe ve **varış saati** |
| Seyre başla | **Başla** (yalnızca Nereden = Konumum iken; başka başlangıçta rota önizlemesi). Harita yön okunu arkadan takip eder, talimatlar Türkçe okunur, rotadan çıkınca yeni rota hesaplanır |
| Hız sınırı | Seyirde yön bandının altında: kırmızı çerçeveli tabela yolun hız sınırı (OpenStreetMap'te `maxspeed` etiketi olan yollarda; etiketsiz yolda gösterilmez), yanındaki kutu anlık hız — sınır aşılınca kırmızı olur |
| Ortala | Harita konumda değilken (rota gösterilince ya da kaydırınca) sol altta çıkar; basınca konuma döner |
| Sesli yönlendirme | Sağ paneldeki **Ses** düğmesi; seçim saklanır |
| Gece modu | Sağ paneldeki **Gece** düğmesi (☀️/🌙): harita koyu stile geçer (Android'de Google gece stili, iOS'ta Apple koyu görünüm), arama kartı, alt panel ve sağ panel koyu olur; seçim saklanır |
| Ulaşım türü | Ayarlar → Araç / Motor |
| Ücretli yollardan kaçın | Rota panelindeki anahtar ya da Ayarlar. Yasaklamaz, mümkünse kaçınır; ücretsiz yol yoksa rota ücretli yolu kullanır ve bunu belirtir (Boğaz geçişlerinin çoğu ücretli) |
| Küçük pencere (resim içinde resim) | Yalnızca Android APK'da (Expo Go'da yok). Seyir sırasında ana ekran tuşuna basınca (Android 12+) ya da sağ paneldeki **Küçült** ile uygulama köşede küçük pencerede yönlendirmeye devam eder |
| Yol kapatma | Sağ paneldeki **Yol kapat** (sunucu modunda önce Ayarlar'dan yönetici anahtarı) → sokağa **dokunun** = kapat/aç. Kapalı yollar haritada kırmızı-beyaz şerit ve ortasında **girilmez** levhasıyla görünür; yönetici modunda levhaya dokunmak da yolu açar. Trafiğe açık kayıtlı gruplar yöneticiye gri kesik çizgiyle gösterilir |
| Grup kaydet / aç / kapat / düzenle | Sağ panelde **Yol kapat** → **Gruplar**; **Düzenle** ile haritada yol ekleyip çıkarın, adını değiştirin; **Tüm yolları trafiğe aç** hepsini birden açar |

Telefon İstanbul dışındaysa (ör. emülatör) ilk basılı tutma **başlangıç**, ikincisi **varış** noktasını seçer; böylece rota önizlemesini her yerden deneyebilirsiniz.

## API

| Uç nokta | Açıklama |
| --- | --- |
| `POST /api/route` `{from:{lat,lon}, to:{lat,lon}, via?:[{lat,lon}], costing?, heading?, alternatives?, avoidTolls?}` | Kapalı yolları dışlayan rota; `alternatives: true` ile en fazla 2 alternatif (hepsi kapalı yollardan kaçar; `via` varken alternatif yok). `via`: en fazla 3 ara durak, sırayla uğranır; cevapta `stops[].shapeIndex` durakların çizgideki yeri. `speedLimits: [{from, to, kph}]` çizgi indeks aralıklarına göre hız sınırları (Valhalla `trace_attributes`, OSM `maxspeed`). Süreler İstanbul saatine göre yoğun saat tahminiyle uzatılır (`traffic`, `freeFlowDurationSec`); rotalar bu süreye göre sıralanır |
| `GET /api/closures` | `{version, closures[], zones[]}` — `closures` şu an trafiğe kapalı tüm parçalar (gruptakiler `zoneName` taşır); her değişiklikte `version` artar |
| `GET /api/closures/stream` | Değişiklikler için Server-Sent Events |
| `POST /api/closures/toggle` `{lat,lon}` 🔒 | Dokunulan noktadaki segmenti kapatır, kapalıysa açar |
| `DELETE /api/closures/:id` 🔒 | Kaydedilmemiş bir kapatmayı kaldırır |
| `POST /api/zones` `{name}` 🔒 | Kaydedilmemiş kapatmaları isimli bir grup olarak kaydeder (grup trafiğe kapalı başlar) |
| `PATCH /api/zones/:id` `{active}` 🔒 | `true`: grubu trafiğe kapatır, `false`: açar |
| `POST /api/zones/:id/toggle-segment` `{lat,lon}` 🔒 | Grup düzenleme: dokunulan yol gruptaysa çıkarır, değilse ekler |
| `DELETE /api/zones/:id` 🔒 | Grubu siler |
| `POST /api/closures/open-all` 🔒 | Tüm yolları trafiğe açar: kaydedilmemiş kapatmalar silinir, gruplar silinmez ama açılır |
| `GET /api/search?q=` | İstanbul ile sınırlı adres arama (Nominatim) |

🔒 = `x-admin-token` başlığı gerekir.

## Testler

```bash
cd server && npm test
```

## Prototipin sınırları ve sonraki adımlar

- **Kapatma birimi** iki kavşak arası segmenttir. Uzun bir caddeyi kapatmak için birkaç segmente dokunmak gerekir. Sonraki adım: "tüm caddeyi kapat" (aynı OSM `way_id`'ye sahip segmentler) ve süreli / zamanlanmış kapatmalar (ör. grubu her pazar 08:00–14:00 kapat).
- **Kapatma sayısı:** Valhalla'nın varsayılan `max_exclude_polygons_length` (10 km) sınırıyla yaklaşık 2.500 eşzamanlı kapalı segment desteklenir; daha fazlası için Valhalla yapılandırmasında bu sınır artırılmalı.
- **Kapatmalar** `server/data/closures.json` dosyasında tutulur; çok sunuculu kurulumda PostgreSQL/Redis'e taşınmalı.
- **Yönetici kimlik doğrulaması** tek bir paylaşılan anahtardır; gerçek kullanımda kullanıcı hesapları + rol yönetimi gerekir.
- **Harita karoları ve arama** OpenStreetMap'in ücretsiz sunucularından gelir (`tile.openstreetmap.org`, Nominatim). Bunlar yoğun kullanım için değildir; yayına çıkmadan önce kendi karo sunucunuzu / ticari bir sağlayıcıyı ve kendi geocoder'ınızı kullanın.
- **Canlı trafik verisi yok:** Süreler, İstanbul'un saate ve güne göre tipik yoğunluğuyla tahmin edilir (`server/src/traffic.js`: hafta içi 07–10 ve 17–20:30 yoğun saat; hızlı yollar en çok yavaşlar). Gerçek trafik için HERE/TomTom gibi bir kaynak eklenebilir.
- Expo Go yerine kalıcı bir uygulama için `npx expo run:android|ios` veya EAS Build ile development build alın. Üretimde API HTTPS arkasında olmalı (iOS/Android düz HTTP'yi engeller).
- OSM verisini güncellemek için betiği tekrar çalıştırın, ardından `force_rebuild=True` ile Valhalla'yı bir kez yeniden başlatın.

Harita verisi © OpenStreetMap katkıcıları, ODbL lisansı.
