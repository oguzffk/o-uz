# HERMAPS — Ekstralar (bekleyen güncellemeler)

**Sürüm 1** (APK'sı yapılan, dondurulmuş sürüm) şu kayıttadır:
`3d26bb032faa9e41ca0224620d62eb8a4d5ac9ae` —
[ZIP](https://github.com/oguzffk/o-uz/archive/3d26bb032faa9e41ca0224620d62eb8a4d5ac9ae.zip).
Sürüm 1'de olanlar: akıcı giden yön oku, geride kalan rota çizgisinin silinmesi, dönüş ve
şerit okları, "Ardından" kutusu, rotadan çıkınca "10 m / 1 dk" hatasının düzeltmesi.

**Sürüm 1.1** = sürüm 1 + **kayıtlı grup arama** (aşağıda 5. madde):
`cba88c00175980ad92a791782c0c2171286db634` —
[ZIP](https://github.com/oguzffk/o-uz/archive/cba88c00175980ad92a791782c0c2171286db634.zip).

**Sürüm 1.2** = sürüm 1.1 + **küçük pencere (PiP) düzeltmesi** (küçük pencerede yalnızca harita, ok
ve yön bandı görünür; "Seyri bitir" paneli görünmez):
`a0152dd1c216303831e4a2b5d0a7658fc2439302` —
[ZIP](https://github.com/oguzffk/o-uz/archive/a0152dd1c216303831e4a2b5d0a7658fc2439302.zip).

**Sürüm 1.3** = sürüm 1.2 + **küçük alt panel** (Google Haritalar tarzı):
`2491cc0986a93fd7d1a2229acb4d545a419a4062` —
[ZIP](https://github.com/oguzffk/o-uz/archive/2491cc0986a93fd7d1a2229acb4d545a419a4062.zip).

**Sürüm 1.4** = sürüm 1.3 + **adres aramada HERE** (siteler, rezidanslar, işletmeler bulunur):
`8d20e4dade5c10697e49f5c9eaff25c2cdea24bb` —
[ZIP](https://github.com/oguzffk/o-uz/archive/8d20e4dade5c10697e49f5c9eaff25c2cdea24bb.zip).

Aşağıdakiler sürüm 1'den **sonra** eklendi; 5. madde sürüm 1.1'e, 6. madde sürüm 1.2'ye, 7. madde sürüm 1.3'e, 8. madde sürüm 1.4'e girdi, 1–4 henüz APK'ya girmedi. İstendiğinde güncel
dalın ZIP'inden ([claude/istanbul-navigation-app-wkh2ta](https://github.com/oguzffk/o-uz/archive/refs/heads/claude/istanbul-navigation-app-wkh2ta.zip))
yeni APK yapılır; hepsi birlikte gelir.

| # | Ekstra | Nerede |
|---|---|---|
| 1 | **Kayıt ol / Giriş yap** | Giriş ekranı |
| 2 | **Gizlilik Politikası ve KVKK Aydınlatma Metni** | Kayıt ekranı, giriş ekranının altı, Ayarlar |
| 3 | **Hesabımı sil** | Ayarlar |
| 4 | **Kullanım Koşulları ve Sorumluluk Reddi** + ayrı onay kutusu | Kayıt ekranı, Ayarlar |
| 5 | **Kayıtlı grup arama** (sürüm 1.1'de) | Yol kapat → Gruplar |
| 6 | **Küçük pencere düzeltmesi** (sürüm 1.2'de) | Seyirde ana ekran tuşu / Küçült |
| 7 | **Küçük alt panel** (sürüm 1.3'te) | Seyirde ekranın altı |
| 8 | **Adres aramada HERE** (sürüm 1.4'te) | Nereye / Nereden arama kutusu |

## 1. Kayıt ol / Giriş yap

- Giriş ekranında iki sekme: **Giriş yap** ve **Kayıt ol**.
- Kayıt: ad soyad, e-posta, cep telefonu, şifre (en az 6 karakter, iki kez). **Kayıt ol** →
  e-postaya 6 haneli doğrulama kodu gider → kod girilince hesap açılır.
- Yeni üyenin süresi yoktur; "Hoş geldiniz" ekranında paket seçer.
- Aynı e-posta ya da telefonla ikinci hesap açılmaz. Kayıt olanlar sahibin **Üyeler** listesinde görünür.
- Giriş: **e-posta ya da telefon + şifre**.
- **Şifremi unuttum:** e-postaya kod gider; kod ve yeni şifre girilir.
- **E-posta koduyla giriş:** şifresi olmayan eski üyeler ve yöneticiler için.
- E-posta konusu amaca göre: kayıt doğrulama, giriş, şifre yenileme.
- Gerçek e-posta için sunucu ve Brevo kurulmalı (README → "E-posta gönderimini kurma").
  Demo modunda kod ekranda görünür.

## 2. Gizlilik Politikası ve KVKK Aydınlatma Metni

- Tam metin uygulamanın içinde; sunucuda da `/gizlilik` web sayfası (mağaza başvurusu için).
- Kayıtta onay kutusu zorunlu; kabul edilen metin sürümü ve tarihi hesapta saklanır.

## 3. Hesabımı sil

- **Ayarlar**'da hesap kartının altında, sağda kırmızı **Hesabımı sil**.
- Onay penceresinde neyin silineceği ve kalan süre yazar; şifreyle onaylanır.
- Hesap kalıcı silinir, giriş ekranında "Hesabınız silindi." yazar.
- Sahip hesabında bu seçenek yoktur.

## 4. Kullanım Koşulları ve Sorumluluk Reddi

- Gizlilik metninin altında yer alır. İçinde:
  - üyelik ve paketler (cayma hakkı istisnası, iadeler);
  - trafik kuralları ve sürüş güvenliği;
  - sorumluluk reddi (rota, kapalı yol, hız sınırı bilgileri bilgilendirme amaçlıdır);
  - yasak kullanımlar;
  - uygulanacak hukuk.
- Kayıtta KVKK kutusunun altında **ayrı ikinci onay kutusu**. İkisi de işaretlenmeden kayıt
  olunmaz; her kutunun bağlantısı kendi metnini açar.
- Satın alma ekranının altına cayma hakkı notu eklendi.

## 5. Kayıtlı grup arama

- **Yol kapat → Gruplar** listesinin üstünde **Kayıtlı grup ara** kutusu.
- Grubun adının bir kısmı yazılınca yalnızca eşleşen gruplar kalır. Büyük/küçük harf ve
  Türkçe karakter farkı gözetilmez ("isk" → "İSKİ Kazısı", "sisli" → "Şişli").
- **✕** aramayı temizler. Bulunamazsa "… adında kayıtlı grup yok." yazar.
- Aramada çıkan grubun **Trafiğe aç / kapat, Düzenle, Sil** düğmeleri aynen çalışır.

## 6. Küçük pencere (PiP) düzeltmesi

- Seyir sırasında ana ekran tuşuna ya da **Küçült**'e basınca uygulama köşede küçük pencerede
  devam eder.
- Önceden küçük pencerede büyük ekran düzeni ("Seyri bitir" paneli, yan düğmeler) sığmaya
  çalışıyordu; harita görünmüyordu. Artık yalnızca **harita, ok, mavi çizgi ve yön bandı**
  (dönüş oku, mesafe, talimat) görünür.
- Ok küçük pencerede de akıcı ilerler; harita biraz uzaklaşır ki önündeki yol daha çok görünsün.
- Pencereye dokunup büyütünce bütün düğmeler geri gelir.

## 7. Küçük alt panel (Google Haritalar tarzı)

- Seyir sırasında alt panel küçüldü; harita daha çok görünüyor.
- Ortada büyük yeşil **kalan süre**, altında **"mesafe · saat varış"** (ör. "27 km · 18:43 varış").
  Ara durak varsa üstte "1. DURAĞA · …" yazar.
- Solda **✕** seyri bitirir. Yanlışlıkla basılmasın diye önce **"Seyir bitsin mi?"** diye sorar
  (Vazgeç / Bitir). 5 saniye içinde cevap verilmezse soru kapanır.
- Trafik tahmini ve ücretli yol notları seyirde gösterilmez, rota önizlemesinde durur.
  ₺ işareti yok.
- Gece modunda koyu renkli.

## 8. Adres aramada HERE

- Arama kutusu artık HERE'in yer veritabanını kullanır: siteler, rezidanslar, işletmeler
  (ör. "G Plus Rezidans") OpenStreetMap'e göre çok daha çok çıkar.
- Yerin yola bağlandığı nokta (kapısı) biliniyorsa rota oraya çizilir.
- HERE anahtarı girilmemişse ya da HERE cevap vermezse arama eskisi gibi OpenStreetMap'ten
  yapılır; arama hiç bozulmaz.
- Anahtar: demo APK için expo.dev'de `EXPO_PUBLIC_HERE_API_KEY` (preview, Sensitive);
  sunucuda `HERE_API_KEY`. Anahtar kimseyle paylaşılmaz, sohbete yazılmaz.

## Yayından önce

- Yasal metinlerdeki köşeli parantezli yerler doldurulmalı: şirket/kişi adı, adres, iletişim
  e-postası. Ödeme yöntemi kesinleşince ilgili maddeler güncellenmeli.
- Tam liste: README → "Yayın öncesi kontrol listesi".
