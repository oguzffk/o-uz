// Gizlilik Politikası ve KVKK Aydınlatma Metni (uygulama içi). Asıl kaynak server/src/privacy.js;
// demo modunda sunucu olmadığı için burada da bir kopyası var. İkisinin aynı kaldığını
// sunucu testleri denetler. Köşeli parantezli yerler yayından önce doldurulmalı.
export const PRIVACY = {
  version: '1.0',
  updated: '25 Ekim 2026',
  title: 'Gizlilik Politikası ve KVKK Aydınlatma Metni',
  intro:
    'HERMAPS ("Uygulama") İstanbul için kapalı yolları dikkate alan bir navigasyon uygulamasıdır. Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") kapsamında hangi kişisel verilerinizi, hangi amaçla ve nasıl işlediğimizi ve haklarınızı açıklar.',
  sections: [
    {
      title: '1. Veri sorumlusu',
      body: [
        'Veri sorumlusu: [VERİ SORUMLUSU ADI / ŞİRKET UNVANI]',
        'Adres: [ADRES]',
        'E-posta: [İLETİŞİM E-POSTASI]',
      ],
    },
    {
      title: '2. İşlenen kişisel veriler',
      body: [
        'Hesap bilgileri: ad soyad, e-posta adresi, cep telefonu numarası ve şifreniz. Şifreniz okunamaz biçimde (tek yönlü şifrelenmiş özet olarak) saklanır; kimse göremez.',
        'Konum: Navigasyon sırasında telefonunuzun anlık konumu, rotanızı hesaplamak ve sizi yönlendirmek için kullanılır. Rota hesaplanırken başlangıç, ara durak ve varış noktaları sunucumuza gönderilir; konum geçmişiniz kaydedilmez.',
        'Aramalar: Adres arama kutusuna yazdıklarınız, sonuçları bulmak için adres arama hizmetine iletilir. Son aramalarınız yalnızca telefonunuzda saklanır.',
        'Satın alma kayıtları: Aldığınız paket, tarihi ve mağazanın işlem numarası. Ödeme App Store / Google Play üzerinden yapılır; kart bilgileriniz bize hiçbir zaman ulaşmaz.',
        'Teknik kayıtlar: Oturum bilgisi (tek cihazda açık kalması için), son giriş zamanı ve güvenlik amaçlı hatalı giriş denemeleri.',
      ],
    },
    {
      title: '3. İşleme amaçları',
      body: [
        'Hesabınızı açmak, e-posta adresinizi doğrulamak ve giriş yapmanızı sağlamak',
        'Rota hesaplamak, kapalı yolları rotanızda dikkate almak ve sesli yönlendirme yapmak',
        'Satın aldığınız kullanım süresini hesabınıza tanımlamak',
        'Şifre yenileme ve giriş kodlarını e-postanıza göndermek',
        'Hesap güvenliğini sağlamak ve kötüye kullanımı önlemek',
        'Yasal yükümlülüklerimizi yerine getirmek',
      ],
    },
    {
      title: '4. Hukuki sebepler',
      body: [
        'Kişisel verileriniz KVKK m.5/2 kapsamında; (c) üyelik sözleşmesinin kurulması ve ifası, (ç) hukuki yükümlülüklerimizin yerine getirilmesi ve (f) temel hak ve özgürlüklerinize zarar vermemek kaydıyla meşru menfaatimiz (hizmet güvenliği) hukuki sebeplerine dayanılarak işlenir.',
      ],
    },
    {
      title: '5. Aktarım',
      body: [
        'Verileriniz yalnızca hizmeti sunmak için gerekli olduğu ölçüde şu hizmet sağlayıcılarla paylaşılır: sunucu barındırma hizmeti; e-posta gönderim hizmeti (doğrulama ve giriş kodları için); ödeme altyapısı olarak Apple App Store, Google Play ve satın alma doğrulama hizmeti RevenueCat; harita görüntüsü için Google Haritalar (Android) / Apple Haritalar (iOS); adres arama için OpenStreetMap tabanlı arama hizmeti.',
        'Bu sağlayıcıların bir kısmının sunucuları yurt dışındadır; yurt dışına aktarım KVKK m.9\'daki şartlara uygun olarak yapılır.',
        'Verileriniz reklam amacıyla kullanılmaz ve satılmaz. Yetkili kamu kurumlarının kanuna dayalı talepleri halinde ilgili mevzuat çerçevesinde paylaşılabilir.',
      ],
    },
    {
      title: '6. Saklama süresi',
      body: [
        'Hesap bilgileriniz hesabınız açık olduğu sürece saklanır. Hesabınızı sildiğinizde hesap bilgileriniz ve satın alma kayıtlarınız sistemimizden hemen silinir; yalnızca kanunen saklamamız zorunlu olan kayıtlar, ilgili süre boyunca saklanır.',
        'Doğrulanmamış kayıt başvuruları ve e-posta kodları en fazla 10 dakika geçerlidir ve kullanıldıktan sonra silinir.',
      ],
    },
    {
      title: '7. Haklarınız (KVKK m.11)',
      body: [
        'Kişisel verilerinizin işlenip işlenmediğini öğrenme, işlenmişse bilgi talep etme',
        'İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme',
        'Yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme',
        'Eksik veya yanlış işlenmişse düzeltilmesini isteme',
        'Silinmesini veya yok edilmesini isteme',
        'Düzeltme ve silme işlemlerinin aktarıldığı üçüncü kişilere bildirilmesini isteme',
        'Otomatik sistemlerle analiz sonucu aleyhinize bir sonuç çıkmasına itiraz etme',
        'Kanuna aykırı işleme nedeniyle zarara uğramanız halinde zararın giderilmesini talep etme',
        'Taleplerinizi [İLETİŞİM E-POSTASI] adresine iletebilirsiniz; en geç 30 gün içinde ücretsiz olarak yanıtlanır.',
      ],
    },
    {
      title: '8. Hesabınızı silme',
      body: [
        'Hesabınızı istediğiniz zaman uygulama içinden silebilirsiniz: Ayarlar → Hesabımı sil.',
        'Uygulamaya erişemiyorsanız, kayıtlı e-posta adresinizden [İLETİŞİM E-POSTASI] adresine "Hesabımı silin" konulu bir e-posta göndermeniz yeterlidir.',
        'Hesap silindiğinde kalan kullanım süreniz de silinir ve geri getirilemez. Mağaza satın alımlarının iadesi Apple / Google iade kurallarına tabidir.',
      ],
    },
    {
      title: '9. Güvenlik',
      body: [
        'Uygulama ile sunucu arasındaki bağlantı şifrelidir. Şifreler ve oturum anahtarları okunamaz özet olarak saklanır; giriş ve kod denemeleri sınırlıdır; bir hesap aynı anda tek telefonda açık kalır.',
      ],
    },
    {
      title: '10. Çocuklar',
      body: ['Uygulama 18 yaşından büyük kullanıcılar içindir; 18 yaşından küçüklerden bilerek kişisel veri toplamayız.'],
    },
    {
      title: '11. Değişiklikler',
      body: [
        'Bu metni güncelleyebiliriz. Önemli değişiklikleri uygulama içinde duyururuz. Metnin güncel hali her zaman uygulamada ve web sitemizde yer alır.',
      ],
    },
  ],
};
