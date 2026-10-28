// Gizlilik Politikası / KVKK Aydınlatma Metni ve Kullanım Koşulları / Sorumluluk Reddi
// (uygulama içi). Asıl kaynak server/src/privacy.js; demo modunda sunucu olmadığı için burada
// da bir kopyası var. İkisinin aynı kaldığını sunucu testleri denetler. Köşeli parantezli
// yerler yayından önce doldurulmalı.
// ÖDEME: Metinler ödemenin App Store / Google Play'den alındığını varsayıyor. Ödeme yöntemi
// değişirse ilgili maddeleri güncelle (README → Yayın öncesi kontrol listesi).
export const PRIVACY = {
  id: 'gizlilik',
  version: '1.1',
  updated: '28 Ekim 2026',
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
        'Verileriniz yalnızca hizmeti sunmak için gerekli olduğu ölçüde şu hizmet sağlayıcılarla paylaşılır: sunucu barındırma hizmeti; e-posta gönderim hizmeti (doğrulama ve giriş kodları için); ödeme altyapısı olarak Apple App Store, Google Play ve satın alma doğrulama hizmeti RevenueCat; harita görüntüsü için Google Haritalar (Android) / Apple Haritalar (iOS); adres arama için HERE Technologies.',
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

export const TERMS = {
  id: 'kullanim-kosullari',
  version: '1.1',
  updated: '27 Ekim 2026',
  title: 'Kullanım Koşulları ve Sorumluluk Reddi',
  intro:
    'Bu koşullar, HERMAPS uygulamasını ("Uygulama") kullanımınıza ilişkin kuralları belirler. Uygulamaya kayıt olarak veya uygulamayı kullanarak bu koşulları kabul etmiş olursunuz. Lütfen özellikle 5. ve 6. maddeleri dikkatle okuyun.',
  sections: [
    {
      title: '1. Taraflar',
      body: [
        'Hizmet sağlayıcı: [VERİ SORUMLUSU ADI / ŞİRKET UNVANI], [ADRES], [İLETİŞİM E-POSTASI] ("HERMAPS", "biz").',
        'Kullanıcı: Uygulamaya kayıt olan ve uygulamayı kullanan kişi ("siz").',
      ],
    },
    {
      title: '2. Hizmetin tanımı',
      body: [
        'Uygulama, İstanbul için rota hesaplayan, sesli yönlendirme yapan ve yetkili yöneticilerin girdiği kapalı yol bilgilerini rotada dikkate almaya çalışan bir navigasyon hizmetidir.',
        'Hizmet, satın alınan kullanım süresi boyunca sunulur. Hizmetin kapsamını, özelliklerini ve görünümünü önceden bildirmeksizin geliştirebilir veya değiştirebiliriz.',
      ],
    },
    {
      title: '3. Üyelik ve hesap güvenliği',
      body: [
        'Uygulamayı kullanmak için 18 yaşından büyük olmanız ve kayıt sırasında doğru bilgi vermeniz gerekir.',
        'Hesabınız kişiseldir; başkasıyla paylaşılamaz, devredilemez veya satılamaz. Bir hesap aynı anda yalnızca bir telefonda açık kalır.',
        'Şifrenizin gizliliğinden siz sorumlusunuz. Hesabınızın izinsiz kullanıldığını düşünüyorsanız şifrenizi hemen değiştirin ve bize bildirin.',
      ],
    },
    {
      title: '4. Kullanım süresi paketleri ve ödeme',
      body: [
        'Paketler: 1 gün, 3 gün ve 1 hafta. Güncel fiyatlar satın alma ekranında gösterilir.',
        'Ödemeler App Store veya Google Play üzerinden alınır; paketler otomatik olarak yenilenmez. Satın aldığınız süre, kalan sürenizin üzerine eklenir ve satın alma anında başlar.',
        'Kullanım süresi, elektronik ortamda anında ifa edilen bir hizmettir. Bu nedenle Mesafeli Sözleşmeler Yönetmeliği m.15 uyarınca cayma hakkı bulunmamaktadır; satın alma ekranındaki onayınızla bu durumu kabul etmiş olursunuz.',
        'İade talepleri Apple ve Google\'ın iade kurallarına göre ilgili mağaza üzerinden yapılır. Mağaza tarafından iade edilen bir satın alımın süresi hesabınızdan düşülür.',
        'Kullanılmayan süre, hesap silinmesi veya bu koşulların ihlali nedeniyle hesabın kapatılması halinde iade edilmez.',
      ],
    },
    {
      title: '5. Trafik kuralları ve sürüş güvenliği',
      body: [
        'Araç kullanırken her zaman 2918 sayılı Karayolları Trafik Kanunu\'na, trafik işaretlerine, yol çizgilerine, ışıklara ve trafik görevlilerinin talimatlarına uymak zorundasınız. Uygulamanın yönlendirmesi hiçbir durumda bunların önüne geçmez.',
        'Uygulamanın gösterdiği yol, yasak bir dönüş, tek yön, kapalı yol veya tehlikeli bir güzergah içeriyorsa uygulamayı değil, yoldaki işaret ve kuralları dikkate alın.',
        'Sürüş sırasında telefonu elinizde tutmayın ve ekranla uğraşmayın. Telefonu sabit bir araç tutucuya yerleştirin; varış noktasını ve ayarları yola çıkmadan önce girin.',
        'Hız sınırı göstergesi bilgilendirme amaçlıdır. Geçerli hız sınırı, yoldaki levhada yazan sınırdır.',
      ],
    },
    {
      title: '6. Sorumluluk reddi',
      body: [
        'Rota, varış süresi, mesafe, kapalı yol, hız sınırı, şerit ve trafik tahmini bilgileri yalnızca bilgilendirme amaçlıdır. Harita verileri OpenStreetMap ve diğer üçüncü taraf kaynaklardan gelir; eksik, hatalı veya güncel olmayan bilgiler içerebilir.',
        'Yolların uygulamada trafiğe kapatılması ve açılması yalnızca kullanıcılar tarafından yapılır; HERMAPS yolları kendisi kapatmaz veya açmaz. Kullanıcıların "Bildir" ile gönderdiği yol çalışması, kaza ve benzeri bildirimler de kullanıcılara aittir ve tarafımızca doğrulanmaz.',
        'Kapalı yol ve bildirim bilgilerinin doğruluğundan, eksikliğinden veya güncel olmamasından ve bu bilgilere dayanılarak verilen kararlardan doğan sonuçlardan HERMAPS sorumlu değildir. Bir yolun uygulamada açık görünmesi gerçekte açık olduğu, kapalı görünmesi de gerçekte kapalı olduğu anlamına gelmez.',
        'GPS sinyali; tünel, köprü altı, yüksek binalar veya telefonunuzdan kaynaklanan nedenlerle zayıflayabilir ya da hatalı olabilir. Bu durumda konumunuz ve yönlendirme yanlış olabilir.',
        'Hizmet "olduğu gibi" sunulur. Hizmetin kesintisiz, hatasız veya her zaman erişilebilir olacağını garanti etmeyiz; bakım, internet bağlantısı, sunucu veya üçüncü taraf hizmetlerinden kaynaklanan kesintiler yaşanabilir.',
        'Mevzuatın izin verdiği ölçüde; uygulamanın kullanımından veya kullanılamamasından doğan trafik kazaları, trafik cezaları, gecikmeler, randevu veya iş kayıpları, yakıt ve diğer doğrudan veya dolaylı zararlardan sorumlu değiliz. Kast veya ağır kusurumuzdan doğan zararlara ilişkin sorumluluğumuz saklıdır.',
        'Araç kullanırken alınan tüm kararların ve sürüş güvenliğinin sorumluluğu sürücüye aittir.',
      ],
    },
    {
      title: '7. Yasak kullanımlar',
      body: [
        'Uygulamayı kanuna aykırı amaçlarla kullanmak',
        'Hesabınızı başkalarıyla paylaşmak veya hesap bilgilerini satmak',
        'Uygulamanın ya da sunucuların işleyişini bozmaya, güvenlik önlemlerini aşmaya veya izinsiz erişim sağlamaya çalışmak',
        'Uygulamayı kopyalamak, tersine mühendislik yapmak, verilerini otomatik yollarla toplamak',
        'Bu durumlarda hesabınızı önceden bildirmeksizin askıya alabilir veya kapatabiliriz.',
      ],
    },
    {
      title: '8. Fikri mülkiyet',
      body: [
        'Uygulamanın adı, logosu, tasarımı ve yazılımı üzerindeki tüm haklar bize aittir; size yalnızca kişisel kullanım için, devredilemez ve münhasır olmayan bir kullanım hakkı tanınır.',
        'Harita verileri © OpenStreetMap katkıcıları (ODbL lisansı); harita görüntüleri Google / Apple\'a aittir.',
      ],
    },
    {
      title: '9. Hesabın sona ermesi',
      body: [
        'Hesabınızı istediğiniz zaman Ayarlar → Hesabımı sil ile kapatabilirsiniz.',
        'Bu koşulları ihlal etmeniz halinde hesabınızı askıya alabilir veya kapatabiliriz.',
      ],
    },
    {
      title: '10. Değişiklikler',
      body: [
        'Bu koşulları güncelleyebiliriz. Önemli değişiklikleri uygulama içinde duyururuz; değişiklikten sonra uygulamayı kullanmaya devam etmeniz güncel koşulları kabul ettiğiniz anlamına gelir.',
      ],
    },
    {
      title: '11. Uygulanacak hukuk ve uyuşmazlıklar',
      body: [
        'Bu koşullara Türkiye Cumhuriyeti hukuku uygulanır.',
        'Tüketici işlemlerinden doğan uyuşmazlıklarda, Ticaret Bakanlığı\'nca her yıl belirlenen parasal sınırlar dahilinde Tüketici Hakem Heyetleri, bu sınırları aşan uyuşmazlıklarda Tüketici Mahkemeleri yetkilidir.',
      ],
    },
    {
      title: '12. İletişim',
      body: ['Sorularınız ve talepleriniz için: [İLETİŞİM E-POSTASI]'],
    },
  ],
};

/** Uygulama içinde ve web sayfasında sırayla gösterilen yasal metinler. */
export const LEGAL_DOCS = [PRIVACY, TERMS];
