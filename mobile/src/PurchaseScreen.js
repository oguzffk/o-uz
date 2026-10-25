import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { PRODUCTS, buyStoreProduct, loadStoreProducts, storeAvailable } from './purchases';
import { formatRemaining } from './session';

const STORE_NAME = Platform.OS === 'ios' ? 'App Store' : 'Google Play';

/**
 * Süre paketi satın alma. `expired`: süre bitti, ekran kapatılamaz (rota alınamaz).
 * Aksi halde kalan süreye eklemek için açılır ve kapatılabilir.
 * Demo modunda gerçek ödeme alınmaz; süre telefonda tanımlanır.
 */
export default function PurchaseScreen({ visible = true, expired, user, api, demo, onPurchased, onClose, onLogout }) {
  const [selected, setSelected] = useState(PRODUCTS[2].id);
  const [storeProducts, setStoreProducts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { text, error }
  const canBuy = demo || storeAvailable();
  // Yeni kayıt olan üyenin hiç süresi olmadı: "süreniz doldu" yerine karşılama.
  const neverHadTime = user.expiresAt == null;
  const firstName = String(user.name ?? '').trim().split(/\s+/)[0];

  useEffect(() => {
    if (!visible || demo || !storeAvailable()) return;
    loadStoreProducts(user.id)
      .then(setStoreProducts)
      .catch(() => setStatus({ text: `${STORE_NAME} fiyatları alınamadı; internet bağlantınızı kontrol edin.`, error: true }));
  }, [visible, demo, user.id]);

  const price = (p) => storeProducts?.[p.id]?.priceString ?? p.price;

  // Satın alım sonrası süre sunucuya mağaza bildirimiyle gelir; birkaç saniye içinde yansır.
  const waitForExtension = async (before) => {
    for (let i = 0; i < 15; i++) {
      const { user: fresh } = await api.me();
      if ((fresh.expiresAt ?? 0) > (before ?? 0)) return fresh;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return null;
  };

  const buy = async () => {
    const product = PRODUCTS.find((p) => p.id === selected);
    setBusy(true);
    setStatus(null);
    try {
      if (demo) {
        await api.purchase(product.id);
      } else {
        const storeProduct = storeProducts?.[product.id];
        if (!storeProduct) throw new Error(`Paket ${STORE_NAME}'da bulunamadı. Biraz sonra tekrar deneyin.`);
        const done = await buyStoreProduct(user.id, storeProduct);
        if (!done) return; // kullanıcı vazgeçti
        setStatus({ text: 'Ödemeniz alındı, süreniz tanımlanıyor…' });
        const fresh = await waitForExtension(user.expiresAt);
        if (!fresh) {
          setStatus({ text: 'Ödemeniz alındı; süreniz birkaç dakika içinde tanımlanacak. Uygulamayı kapatıp açabilirsiniz.' });
          return;
        }
      }
      await onPurchased();
      setStatus(null);
      onClose?.();
    } catch (err) {
      setStatus({ text: err.message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <View style={[styles.card, expired && styles.cardExpired]}>
      <View style={styles.icon}>
        <Text style={{ fontSize: 24 }}>{expired && !neverHadTime ? '⏱️' : '🧭'}</Text>
      </View>
      <Text style={styles.title}>{expired ? (neverHadTime ? `Hoş geldiniz${firstName ? `, ${firstName}` : ''}` : 'Kullanım süreniz doldu') : 'Süre ekle'}</Text>
      <Text style={styles.subtitle}>
        {expired
          ? neverHadTime
            ? 'Navigasyonu kullanmaya başlamak için bir paket seçin.'
            : 'Navigasyona devam etmek için bir paket seçin.'
          : `Kalan süre: ${user.expiresAt ? formatRemaining(user.expiresAt - Date.now()) : '—'}. Alacağınız paket bunun üstüne eklenir.`}
      </Text>
      <View style={styles.plans}>
        {PRODUCTS.map((p) => {
          const on = p.id === selected;
          return (
            <Pressable key={p.id} style={[styles.plan, on && styles.planOn]} onPress={() => setSelected(p.id)} accessibilityLabel={`${p.label} paketi`}>
              <Text style={[styles.planLabel, on && styles.planLabelOn]}>{p.label}</Text>
              <Text style={styles.planPrice}>{price(p)}</Text>
              {p.days === 7 && <Text style={styles.planTag}>En avantajlı</Text>}
            </Pressable>
          );
        })}
      </View>
      {!!status && <Text style={[styles.status, status.error && styles.statusError]}>{status.text}</Text>}
      {canBuy ? (
        <Pressable style={[styles.button, busy && { opacity: 0.7 }]} onPress={buy} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{demo ? 'Satın al (demo)' : `${STORE_NAME} ile satın al`}</Text>}
        </Pressable>
      ) : (
        <Text style={styles.note}>
          {"Satın alma yalnızca uygulamanın mağaza sürümünde (App Store / Google Play) yapılabilir; Expo Go'da çalışmaz."}
        </Text>
      )}
      <Text style={styles.legal}>
        {demo
          ? 'Demo modu: gerçek ödeme alınmaz, süre yalnızca bu telefonda tanımlanır.'
          : `Ödeme ${STORE_NAME} hesabınızdan alınır, otomatik yenilenmez. Süre hesabınıza (${user.email ?? user.phone}) tanımlanır; başka telefonda aynı hesapla girince de geçerlidir. Süre satın alındığı anda başladığı için cayma hakkı yoktur (Mesafeli Sözleşmeler Yönetmeliği m.15); iadeler ${STORE_NAME} kurallarına tabidir.`}
      </Text>
      {expired ? (
        <Pressable onPress={onLogout} hitSlop={8}>
          <Text style={styles.link}>Çıkış yap</Text>
        </Pressable>
      ) : (
        <Pressable onPress={onClose} hitSlop={8} disabled={busy}>
          <Text style={styles.link}>Kapat</Text>
        </Pressable>
      )}
    </View>
  );

  if (expired) return <View style={styles.backdrop}>{body}</View>;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>{body}</View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', padding: 12, paddingBottom: 28 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
  },
  cardExpired: {},
  icon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#eef4fd', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  title: { fontSize: 21, fontWeight: '800', color: '#1c1c1e' },
  subtitle: { fontSize: 13.5, color: '#6e6e73', marginTop: 3, marginBottom: 14, lineHeight: 19 },
  plans: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  plan: { flex: 1, borderWidth: 1.5, borderColor: '#d1d1d6', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  planOn: { borderColor: '#0a66d8', backgroundColor: '#eef4fd' },
  planLabel: { fontWeight: '800', fontSize: 15, color: '#1c1c1e' },
  planLabelOn: { color: '#0a66d8' },
  planPrice: { fontSize: 12.5, color: '#3a3a3c', marginTop: 2 },
  planTag: { fontSize: 10, fontWeight: '700', color: '#1f7a3a', marginTop: 3 },
  status: { fontSize: 13, color: '#3a3a3c', marginBottom: 8, fontWeight: '600' },
  statusError: { color: '#d70015' },
  button: { backgroundColor: '#0a66d8', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  note: { fontSize: 13, color: '#8a5a00', backgroundColor: '#fff8e1', borderRadius: 10, padding: 10, lineHeight: 18 },
  legal: { fontSize: 11.5, color: '#8e8e93', marginTop: 10, lineHeight: 16 },
  link: { color: '#0a66d8', fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 14 },
});
