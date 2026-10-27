# HERMAPS — İstanbul navigasyon (prototip)

Telefon odaklı, İstanbul'a özel bir navigasyon uygulaması:

- **Gerçek sokak ağı:** OpenStreetMap'ten yalnızca İstanbul'un yol verisi çıkarılır, rotaları **Valhalla** hesaplar.
- **Yol kapatma:** Yönetici haritada herhangi bir sokağa dokunarak o segmenti kapatır / tekrar açar. Kapalı yollar **tüm kullanıcıların** rotalarından anında çıkarılır; seyirdeki telefonlar da birkaç saniye içinde yeni rotaya geçer.
- **Kayıtlı gruplar:** Kapatılan yollar bir isimle kaydedilir ("Maraton güzergâhı" gibi). Sonra menüden tek dokunuşla o grubun tamamı trafiğe kapatılır ya da açılır.
- **Mobil uygulama:** Expo (React Native) — arama, rota önizleme, sesli Türkçe yönlendirme, rotadan çıkınca yeniden hesaplama.
- **Hesaplar ve süreli kullanım:** Herkes **e-postasına gelen 6 haneli kodla** girer (şifre yok; sahip ve yöneticiler için telefon + şifre yedek giriş). **Sahip** üyeleri ekler, onlara 1 gün / 3 gün / 1 hafta süre verir ya da süreyi bitirir; **yönetici** yalnızca yol kapatır ve gruplara erişir; **üye** süresi bitene kadar navigasyonu kullanır.

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

- Giriş ekranında yazan **demo sahip hesabıyla** girin: e-posta `sahip@hermap.demo` (demo modunda e-posta gönderilmez, **kod ekranda görünür**) ya da yedek giriş `0500 000 00 00` / `hermap`. Demo modunda hesaplar da yalnızca o telefonda tutulur; sahip olarak **👥 Üyeler**'den üye ve yönetici ekleyip çıkış yaparak onların ekranlarını deneyebilirsiniz.
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

Proje klasöründe bir `.env` dosyası oluşturup **sahip hesabını** yazın (bu dosya GitHub'a gönderilmez):

```bash
OWNER_PHONE=05321234567
OWNER_PASSWORD=en-az-6-karakterli-bir-sifre
OWNER_NAME=Adınız
OWNER_EMAIL=siz@ornek.com

# Kod e-postaları: kayıt doğrulama, giriş ve şifre yenileme (ör. Brevo'nun ücretsiz planı: günde 300 e-posta)
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=brevo-giris-adresiniz
SMTP_PASS=brevo-smtp-anahtariniz
MAIL_FROM="HERMAPS <kod@alanadiniz.com>"

# Adres arama: HERE anahtarı (site, rezidans ve işletmeler için; yoksa OpenStreetMap araması)
HERE_API_KEY=here-anahtariniz
```

SMTP ayarlı değilse e-posta gönderilmez; giriş kodları sunucu kayıtlarına (`docker compose logs api`) yazılır — yalnızca yerel deneme içindir. E-postaların spama düşmemesi için gönderen adres kendi alan adınızda olmalı ve Brevo'nun verdiği SPF/DKIM kayıtları alan adına eklenmeli.

**E-posta gönderimini kurma (Brevo, ücretsiz plan):**

1. [brevo.com](https://www.brevo.com)'da ücretsiz hesap açın (günde 300 e-posta; kayıt + giriş kodları için yeterli).
2. **Senders, Domains & Dedicated IPs → Domains → Add a domain**: alan adınızı (ör. `hermaps.com.tr`) ekleyin. Brevo'nun verdiği DNS kayıtlarını (Brevo kodu, DKIM, DMARC) alan adını aldığınız firmanın DNS panelinde ekleyip **Verify / Authenticate** deyin. Bu adım yapılmazsa kodlar spama düşer ya da hiç gitmez.
3. **Senders → Add a sender**: gönderen adresi `kod@alanadiniz.com.tr`, ad `HERMAPS`.
4. **SMTP & API → SMTP** sekmesi: **Login** değeri `SMTP_USER`'dır; **Generate a new SMTP key** ile üretilen anahtar `SMTP_PASS`'tır. Anahtarı kimseyle paylaşmayın, depoya eklemeyin; yalnızca sunucudaki `.env` dosyasına yazın.
5. `.env`'e `SMTP_*` ve `MAIL_FROM` değerlerini yazıp API'yi yeniden başlatın: `docker compose up -d api`. Sunucu açılırken "SMTP ayarlı değil" uyarısı çıkmıyorsa ayar okunmuştur.
6. Uygulamada **Kayıt ol** ile kendi e-postanızı deneyin; kod birkaç saniye içinde gelmelidir.

```bash
docker compose up -d
docker compose logs -f valhalla   # ilk açılışta grafik kurulur (birkaç dakika)
```

Hazır olduğunu kontrol edin:

```bash
curl http://localhost:3000/api/health
```

Sahip hesabı ilk açılışta bir kez oluşturulur; sonra şifre ve üyeler panelden yönetilir. `OWNER_PASSWORD` vermezseniz rastgele bir şifre üretilip **yalnızca o açılışta** loglara yazılır ve ilk girişte değiştirmeniz istenir. Sabit bir varsayılan şifre yoktur; `OWNER_PHONE` olmadan sunucu açılmaz. Hesaplar `server/data/users.json` dosyasında, şifreler scrypt ile tuzlanmış olarak tutulur.

Rota motoru (Valhalla, 8002) yalnızca bu bilgisayardan erişilebilir; dışarıdan herkes API'yi (3000) kullanır, böylece giriş ve kapalı yol kuralları atlanamaz.

> API'yi Docker yerine doğrudan çalıştırmak isterseniz: `cd server && npm install && OWNER_PHONE=05321234567 OWNER_PASSWORD=... npm run dev` (Valhalla'yı yine `docker compose up -d valhalla` ile açın).

### 3) Yönetici paneli (masaüstü)

Tarayıcıda **http://localhost:3000/admin/** açın, e-posta adresinize gelen kodla girin (yedek: telefon + şifre; üyeler bu panele giremez):

- **Sahip:** Üstte **Yollar · Üyeler · Yöneticiler** sekmeleri.
  - **Üyeler:** **＋ Üye ekle** (ad + **e-posta**, telefon isteğe bağlı). Üyenin şifresi yoktur: uygulamada e-postasını yazıp gelen kodla girer; **WhatsApp'a gönder** (telefon varsa) ya da **Mesajı kopyala** ile haber verilir. Listede kalan süre ve mağazadan **son satın alma** görünür. Her üyede elle **+1 gün / +3 gün / +1 hafta** (hediye, telafi vb.; süre devam ediyorsa üstüne eklenir), **Süreyi bitir**, **Sil**.
  - **Yöneticiler:** Ekle (ad + e-posta + telefon; yedek giriş için 6 haneli geçici şifre verilir, ilk şifreli girişte değiştirilir) / şifre sıfırla / sil. Yöneticiler üye listesini göremez, süre veremez.
- **Yönetici:** Yalnızca yollar ve gruplar:

- **Yol kapat / aç:** Bir sokağa tıklayın → iki kavşak arasındaki o segment kırmızı-beyaz şerit ve girilmez levhasıyla kapanır. Şeride ya da levhaya tekrar tıklamak (veya listedeki **Aç**) yolu açar.
- **Rota dene:** İki nokta seçip rotanın kapalı yolların etrafından dolaştığını görün.

- **Kayıtlı gruplar:** Yolları kapattıktan sonra bir isim yazıp **Kaydet**'e basın. Grup listede görünür; **Trafiğe aç / Trafiğe kapat** ile tüm yollar tek seferde açılıp kapanır. Trafiğe açık grupların yolları haritada gri kesik çizgiyle gösterilir.

Panel değişiklikleri canlı izler; başka bir yöneticinin kapattığı yol da anında görünür.

### 4) Mobil uygulama

```bash
cd mobile
npm install
npx expo start
```

Telefonda Expo Go ile QR kodu okutun. Giriş ekranının altındaki **Sunucu: … · değiştir**'den **Kendi sunucum**'u seçin. Uygulama API adresini otomatik olarak Expo'yu çalıştıran bilgisayarın IP'si üzerinden bulur (`http://<bilgisayar-ip>:3000`). Gerekirse oradan değiştirin ya da `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 npx expo start` kullanın.

| İşlem | Nasıl |
| --- | --- |
| Kayıt ol | Giriş ekranında **Kayıt ol** sekmesi: ad soyad, e-posta, cep telefonu, şifre (en az 6 karakter, iki kez) ve iki onay kutusu: **Gizlilik Politikası ve KVKK Aydınlatma Metni** ile altında **Kullanım Koşulları ve Sorumluluk Reddi** (ikisi de işaretlenmeden kayıt olunmaz; altı çizili yazıya dokununca ilgili metin açılır; kabul edilen sürümler hesapta saklanır). **Kayıt ol** → e-postaya 6 haneli **doğrulama kodu** gider → kod girilince hesap açılır. Yeni üyenin süresi yoktur; "Hoş geldiniz" ekranında paket seçer. Aynı e-posta ya da telefonla ikinci hesap açılmaz |
| Giriş | **Giriş yap** sekmesi: **e-posta ya da telefon + şifre** (aynı hesaba 5, aynı IP'den 20 hatalı denemede 15 dakika kilit). **Şifremi unuttum:** e-postaya kod gider, kod + yeni şifreyle girilir. **E-posta koduyla giriş:** şifresi olmayanlar (sahibin eklediği eski üyeler) ve yöneticiler için; kod 10 dakika geçerli, 5 deneme; yeni kod için 1 dakika beklenir, saatte en fazla 5 kod. Kayıtlı olmayan adrese kod gitmez ama ekran aynıdır. Yöneticiye verilen geçici şifreyle girene önce kendi şifresini belirletir. Oturum telefonun güvenli kasasında saklanır; **bir hesap aynı anda tek telefonda açıktır** (başka telefonda giriş yapılınca eskisinin oturumu kapanır). Çıkış: ⚙︎ **Ayarlar → Çıkış yap** |
| Gizlilik / Koşullar / Hesabımı sil | ⚙︎ **Ayarlar**'da hesap kartının altında **Gizlilik ve Kullanım Koşulları** (Gizlilik Politikası / KVKK metni ve altında Kullanım Koşulları / Sorumluluk Reddi) ve **Hesabımı sil** (sahipte yok). Silme onayında neyin silineceği ve kalan süre yazar; şifresi olan hesap şifresini girer. Silinince giriş ekranına dönülür. Metin `server/src/privacy.js`'tedir (uygulamadaki kopyası `mobile/src/legal.js`; testler ikisinin aynı olduğunu denetler); köşeli parantezli yerler (veri sorumlusu, adres, iletişim e-postası) yayından önce doldurulmalı |
| Roller | **Üye:** yalnızca navigasyon (girişte şifre sorulmaz); arama kutusunun altında **kalan süre** (son 24 saatte turuncu). Süre bitince rota alınamaz ve **Kullanım süreniz doldu** ekranında paket seçilip **App Store / Google Play ile satın al**ınır (devam eden seyir yarıda kesilmez). Süre bitmeden de kalan süre rozetine ya da ⚙︎ **Ayarlar → Süre satın al**'a dokunarak paket alınır; yeni süre kalanın üstüne eklenir. **Yönetici:** + Yol kapat ve Gruplar. **Sahip:** + **👥 Üyeler** (üyeler ve yöneticiler; web panelindekiyle aynı işlemler) |
| Süre paketleri | **1 gün 119,99 TL · 3 gün 299,99 TL · 1 hafta 559,99 TL**. Ödeme App Store / Google Play'den alınır (otomatik yenilenmez); fiyatlar mağazadan gelir. Satın alma yalnızca uygulamanın mağaza / APK sürümünde çalışır, Expo Go'da çalışmaz. **Demo modunda** "Satın al (demo)" ile gerçek ödeme olmadan süre eklenir |
| Nereden / Nereye | Üstteki iki kutu. **Nereden** varsayılan olarak **Konumum**; başka bir yer de aranabilir (listenin başında "Konumum" seçeneği). **⇅** ikisini yer değiştirir. Haritada **basılı tutmak** varışı seçer |
| Ara durak | Rota çizilince kartın altındaki **＋ Ara durak ekle** (en fazla 3). Durak aranır ya da haritada basılı tutularak seçilir; **✕** kaldırır, sağdaki **≡** tutamağından sürükleyerek sırası değiştirilir (rota yeni sırayla yeniden hesaplanır), **⇅** durakların sırasını da ters çevirir. Duraklı rotada alternatif rota verilmez. Alt paneldeki süre, mesafe ve varış saati sıradaki durağa göredir ("1. DURAĞA · Market"); durak geçilince bir sonrakine, duraklar bitince hedefe geçer. Seyirde durağa yaklaşınca "1. ara durağa varmak üzeresiniz" denir; geçilen duraklar yeniden rota hesaplanırken atlanır |
| Adres arama | Arama HERE'in yer veritabanından yapılır (siteler, rezidanslar, işletmeler). Sunucuda `HERE_API_KEY`; demo modunda EAS ortam değişkeni `EXPO_PUBLIC_HERE_API_KEY` (expo.dev → proje → Environment variables, ortam **preview**, görünürlük **Sensitive**). Anahtar yoksa ya da HERE cevap vermezse OpenStreetMap araması kullanılır. HERE anahtarı: platform.here.com → hesap aç → Access Manager → Apps → **Create app** → **API Keys → Create API key** |
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
| Yol kapatma | Sahip ve yöneticide sağ paneldeki **Yol kapat** → sokağa **dokunun** = kapat/aç. Kapalı yollar haritada kırmızı-beyaz şerit ve ortasında **girilmez** levhasıyla görünür; yönetici modunda levhaya dokunmak da yolu açar. Trafiğe açık kayıtlı gruplar yöneticiye gri kesik çizgiyle gösterilir |
| Grup kaydet / aç / kapat / düzenle | Sağ panelde **Yol kapat** → **Gruplar**; listenin üstündeki **Kayıtlı grup ara** kutusuna adının bir kısmı yazılınca yalnızca eşleşen gruplar kalır (büyük/küçük harf ve Türkçe karakter farkı gözetilmez; ✕ temizler); **Düzenle** ile haritada yol ekleyip çıkarın, adını değiştirin; **Tüm yolları trafiğe aç** hepsini birden açar |

Telefon İstanbul dışındaysa (ör. emülatör) ilk basılı tutma **başlangıç**, ikincisi **varış** noktasını seçer; böylece rota önizlemesini her yerden deneyebilirsiniz.

## Mağaza ödemeleri (App Store / Google Play)

Ödeme mağazalarda alınır; **RevenueCat** (aylık 2.500 $ gelire kadar ücretsiz) satın alımı doğrular ve sunucuya bildirir, sunucu üyenin süresini uzatır. Kurulum (bir kez):

1. **Ürünler** (kimlikler üç yerde de aynı olmalı):
   - **App Store Connect → Uygulama içi satın alımlar:** tür **Non-Renewing Subscription**; `hermap_1gun` (119,99 TL), `hermap_3gun` (299,99 TL), `hermap_1hafta` (559,99 TL).
   - **Google Play Console → Ürünler → Uygulama içi ürünler:** aynı kimlik ve fiyatlarla tek seferlik (tüketilebilir) ürün.
   - Apple'da **Small Business Program**'a başvurun (komisyon %30 yerine %15).
2. **RevenueCat:** proje açın, iOS ve Android uygulamasını bağlayın, üç ürünü içe aktarın. **Integrations → Webhooks:** adres `https://alanadiniz/api/webhooks/revenuecat`, **Authorization header** olarak uzun rastgele bir değer girin.
3. **Sunucu `.env`:** `REVENUECAT_WEBHOOK_AUTH=<o değer>` (mağaza test hesaplarıyla denerken geçici olarak `REVENUECAT_ALLOW_SANDBOX=1`).
4. **Uygulama (EAS ortam değişkeni):** RevenueCat'in **herkese açık** uygulama anahtarları `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` ve `EXPO_PUBLIC_REVENUECAT_IOS_KEY`.

Uygulama RevenueCat'e kullanıcıyı sunucudaki kullanıcı kimliğiyle tanıtır; böylece satın alınan süre o hesaba yazılır ve aynı hesapla girilen her telefonda geçerlidir.

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
| `POST /api/reports` `{type, lat, lon}` | Kullanıcı bildirimi (`roadwork` yol çalışması, `accident` kaza, `closed` yol kapalı, `breakdown` araç arızası, `other` diğer). Yol **kapanmaz**; en yakın yolun adı eklenip yöneticilere iletilir. Aynı kullanıcı 30 sn'de bir gönderebilir (`429`) |
| `GET /api/reports` 🔒 · `DELETE /api/reports/:id` 🔒 | Son 24 saatin bildirimleri (en yenisi başta) · bildirimi kaldırır. Gerekirse yolu yönetici `POST /api/closures/toggle` ile kendisi kapatır |
| `GET /api/search?q=` | İstanbul ile sınırlı adres ve yer arama. `HERE_API_KEY` varsa HERE (Discover; site, rezidans ve işletmelerde çok daha eksiksiz, binanın yola bağlandığı nokta döner), yoksa ya da HERE hata verirse OpenStreetMap (Nominatim) |
| `POST /api/auth/register` `{name, email, phone, password}` | Kayıt, 1. adım: bilgiler denetlenir (e-posta/telefon kayıtlıysa `409`), e-postaya 6 haneli doğrulama kodu gider. Hesap henüz açılmaz. Kod sınırları giriş koduyla aynı |
| `POST /api/auth/register/verify` `{email, code}` | Kayıt, 2. adım: kod doğruysa süresiz üye hesabı açılır, `{token, user}` döner |
| `POST /api/auth/email-code` `{email, purpose?: "login"\|"reset"}` | Kayıtlı adrese 6 haneli kod gönderir (giriş ya da şifre yenileme; adres kayıtlı olmasa da cevap aynı). Aynı adrese dakikada 1, saatte 5; aynı IP'den saatte 30 istek |
| `POST /api/auth/reset-password` `{email, code, newPassword}` | Şifremi unuttum: kod doğruysa yeni şifre kaydedilir ve oturum açılır |
| `DELETE /api/auth/account` `{password}` | Hesabımı sil: oturumdaki kullanıcı kendi hesabını kalıcı olarak siler (şifresi varsa şifreyle doğrular; sahip hesabı silinemez) |
| `GET /gizlilik` | Gizlilik Politikası / KVKK Aydınlatma Metni ve altında Kullanım Koşulları / Sorumluluk Reddi (web sayfası; `/kosullar` da açar, koşullar `#kullanim-kosullari`). Mağaza başvurularında gizlilik adresi olarak `https://alanadiniz/gizlilik`, hesap silme adresi olarak `https://alanadiniz/gizlilik#hesap-silme` verilir |
| `POST /api/auth/email-login` `{email, code}` | Kod doğruysa oturum açar: `{token, user}`. Kod 10 dakika ve 5 deneme geçerli, tek kullanımlık. Aynı hesabın önceki oturumu kapanır |
| `POST /api/auth/login` `{login, password}` | E-posta ya da telefon + şifre (eski istemciler `phone` gönderir). Şifresi olmayan hesaba `400`. Aynı hesaba 5, aynı IP'den 20 hatalı denemede 15 dakika kilit |
| `GET /api/auth/me` · `POST /api/auth/logout` · `POST /api/auth/password` `{newPassword}` | Oturum bilgisi (kalan süre dahil), çıkış, şifre değiştirme (en az 6 karakter) |
| `GET /api/users?role=member\|admin` 👑 | Üyeler ya da yöneticiler (şifre özeti ve oturum dönmez) |
| `POST /api/users` `{name, email, phone, role}` 👑 | Üye (`member`: e-posta zorunlu, telefon isteğe bağlı, şifre yok) ya da yönetici (`admin`: e-posta + telefon, 6 haneli yedek geçici şifre döner) ekler |
| `POST /api/users/:id/extend` `{days: 1\|3\|7}` 👑 · `POST /api/users/:id/expire` 👑 | Üyeye süre ekler (devam eden sürenin üstüne) · süreyi hemen bitirir |
| `POST /api/users/:id/reset-password` 👑 · `DELETE /api/users/:id` 👑 | Yöneticiye yeni geçici şifre (açık oturum kapanır) · siler (sahip silinemez) |
| `GET /api/products` | Süre paketleri: `hermap_1gun` (1), `hermap_3gun` (3), `hermap_1hafta` (7 gün) |
| `POST /api/webhooks/revenuecat` | RevenueCat bildirimi (`Authorization: Bearer <REVENUECAT_WEBHOOK_AUTH>`). `NON_RENEWING_PURCHASE` üyenin süresine paketin günlerini ekler (aynı işlem bir kez sayılır), `CANCELLATION` (iade) geri alır. Mağazanın deneme (sandbox) satın alımları yalnızca `REVENUECAT_ALLOW_SANDBOX=1` iken sayılır |

Oturum `Authorization: Bearer <token>` başlığıyla gönderilir. Rota, arama ve kapalı yol listesi için giriş yapmış, şifresini belirlemiş ve (üyeyse) süresi devam eden bir hesap gerekir; süresi biten üyeye `402 {code: "expired"}` döner. 🔒 = sahip ya da yönetici, 👑 = yalnızca sahip.

## Testler

```bash
cd server && npm test
```

## Yayın öncesi kontrol listesi

Yayına çıkmadan önce aşağıdakiler gözden geçirilmeli:

- [ ] **Ödeme yöntemi kesinleşince yasal metinleri ve satın alma ekranını güncelle.** Metinler şu an ödemenin **App Store / Google Play** üzerinden alındığını varsayıyor. Ödeme başka bir yolla (ör. iyzico, PayTR, havale) alınacaksa şuralar değişmeli:
  - `server/src/privacy.js` **ve** `mobile/src/legal.js` (ikisi aynı kalmalı; testler denetler): Gizlilik metninde 2. madde "Satın alma kayıtları" ve 5. madde "Aktarım" (ödeme altyapısı); Kullanım Koşulları'nda 4. madde "Paketler ve ödeme" (iade kuralları) ve 8. madde "Hesabınızı silme"deki iade cümlesi.
  - `mobile/src/PurchaseScreen.js` ve `mobile/src/purchases.js` (satın alma akışı ve alttaki not), sunucudaki RevenueCat bildirimi (`/api/webhooks/revenuecat`).
  - Not: Uygulama içinde satılan dijital hizmetler (kullanım süresi) için Google Play ve App Store kendi ödeme sistemlerini şart koşar; başka bir ödeme yolu mağaza kurallarına uygun olmalı.
- [ ] Yasal metinlerdeki köşeli parantezli yerleri doldur: veri sorumlusu / şirket unvanı, adres, iletişim e-postası. Metin değişince `version` ve `updated` alanlarını artır.
- [ ] Yasal metinleri bir avukata kontrol ettir (özellikle Kullanım Koşulları 6. madde, sorumluluk reddi).
- [ ] Uygulamayı demo modundan çıkarıp gerçek sunucuya bağla; sunucuda HTTPS, Brevo (SMTP) ve alan adı hazır olsun.
- [ ] Google Haritalar anahtarını paket adı (`com.hermaps.app`) ve Play imza SHA-1'i ile kısıtla.
- [ ] Mağaza sayfalarına gizlilik adresi (`https://alanadiniz/gizlilik`) ve hesap silme adresi (`https://alanadiniz/gizlilik#hesap-silme`) yaz.

## Prototipin sınırları ve sonraki adımlar

- **Kapatma birimi** iki kavşak arası segmenttir. Uzun bir caddeyi kapatmak için birkaç segmente dokunmak gerekir. Sonraki adım: "tüm caddeyi kapat" (aynı OSM `way_id`'ye sahip segmentler) ve süreli / zamanlanmış kapatmalar (ör. grubu her pazar 08:00–14:00 kapat).
- **Kapatma sayısı:** Valhalla'nın varsayılan `max_exclude_polygons_length` (10 km) sınırıyla yaklaşık 2.500 eşzamanlı kapalı segment desteklenir; daha fazlası için Valhalla yapılandırmasında bu sınır artırılmalı.
- **Kapatmalar** `server/data/closures.json` dosyasında tutulur; çok sunuculu kurulumda PostgreSQL/Redis'e taşınmalı.
- **Hesaplar** `server/data/users.json` dosyasında tutulur; yedeklenmesi gerekir (kapatmalar dosyasıyla birlikte). Satın alma geçmişi de bu dosyadadır (`purchases`).
- **Harita karoları ve arama** OpenStreetMap'in ücretsiz sunucularından gelir (`tile.openstreetmap.org`, Nominatim). Bunlar yoğun kullanım için değildir; yayına çıkmadan önce kendi karo sunucunuzu / ticari bir sağlayıcıyı ve kendi geocoder'ınızı kullanın.
- **Canlı trafik verisi yok:** Süreler, İstanbul'un saate ve güne göre tipik yoğunluğuyla tahmin edilir (`server/src/traffic.js`: hafta içi 07–10 ve 17–20:30 yoğun saat; hızlı yollar en çok yavaşlar). Gerçek trafik için HERE/TomTom gibi bir kaynak eklenebilir.
- Expo Go yerine kalıcı bir uygulama için `npx expo run:android|ios` veya EAS Build ile development build alın. Üretimde API HTTPS arkasında olmalı (iOS/Android düz HTTP'yi engeller).
- OSM verisini güncellemek için betiği tekrar çalıştırın, ardından `force_rebuild=True` ile Valhalla'yı bir kez yeniden başlatın.

Harita verisi © OpenStreetMap katkıcıları, ODbL lisansı.
