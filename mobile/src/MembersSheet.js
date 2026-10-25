import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { formatRemaining } from './session';

/**
 * Sahibin yönetim sayfası: üyeler (süre ver/kaldır, sil; mağazadan son satın alım) ve
 * yöneticiler (ekle, şifre sıfırla, sil). Ödemeler App Store / Google Play'den alınır.
 */
const TABS = [
  ['member', 'Üyeler'],
  ['admin', 'Yöneticiler'],
];

const PLAN_LABELS = { hermap_1gun: '1 gün', hermap_3gun: '3 gün', hermap_1hafta: '1 hafta' };
const formatPhone = (p) => (p ? p.replace(/^(\d{4})(\d{3})(\d{2})(\d{2})$/, '$1 $2 $3 $4') : '');

function remainingOf(u, now) {
  if (u.expiresAt == null) return { text: 'Süre yok', tone: 'none' };
  const ms = u.expiresAt - now;
  if (ms <= 0) return { text: 'Süresi doldu', tone: 'bad' };
  return { text: formatRemaining(ms), tone: ms < 24 * 3600000 ? 'warn' : 'ok' };
}

export default function MembersSheet({ visible, api, onClose, showToast }) {
  const [tab, setTab] = useState('member');
  const [lists, setLists] = useState({ member: [], admin: [] });
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [issued, setIssued] = useState(null); // { user, tempPassword, reset }
  const [confirm, setConfirm] = useState(null); // "id:işlem" — iki dokunuşla onay
  const [now, setNow] = useState(Date.now());

  const load = useCallback(
    async (role) => {
      setLoading(true);
      try {
        const { users } = await api.users(role);
        setNow(Date.now()); // kalan süreler listenin geldiği ana göre hesaplansın
        setLists((l) => ({ ...l, [role]: users }));
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [api, showToast],
  );

  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    load(tab);
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [visible, tab, load]);

  const switchTab = (t) => {
    setTab(t);
    setAdding(false);
    setIssued(null);
    setConfirm(null);
    setQuery('');
  };

  const act = async (fn, message) => {
    setConfirm(null);
    try {
      const r = await fn();
      if (message) showToast(message);
      await load(tab);
      return r;
    } catch (err) {
      showToast(err.message, 'error');
      return null;
    }
  };

  const create = async () => {
    const r = await act(() => api.createUser({ ...form, role: tab }));
    if (r) {
      setIssued({ user: r.user, tempPassword: r.tempPassword });
      setForm({ name: '', email: '', phone: '' });
      setAdding(false);
    }
  };

  const resetPassword = async (u) => {
    const r = await act(() => api.resetPassword(u.id));
    if (r) setIssued({ user: r.user, tempPassword: r.tempPassword, reset: true });
  };

  // İki dokunuşlu onay: ilk dokunuş düğmeyi "Emin misiniz?" yapar.
  const confirmable = (key, label, onConfirm, danger) => {
    const armed = confirm === key;
    return (
      <Pressable
        style={[styles.chip, danger && styles.chipDanger, armed && styles.chipArmed]}
        onPress={() => (armed ? onConfirm() : setConfirm(key))}
      >
        <Text style={[styles.chipText, danger && styles.chipDangerText, armed && styles.chipArmedText]}>{armed ? 'Emin misiniz?' : label}</Text>
      </Pressable>
    );
  };

  const list = (lists[tab] ?? []).filter((u) => {
    const q = query.trim().toLocaleLowerCase('tr');
    const digits = q.replace(/\D/g, '');
    return !q || u.name.toLocaleLowerCase('tr').includes(q) || (u.email ?? '').includes(q) || (digits && (u.phone ?? '').includes(digits));
  });

  // Üyeye şifre verilmez: uygulamada e-postasını yazıp gelen kodla girer. Yöneticiye yedek geçici şifre de iletilir.
  const shareMessage = !issued
    ? ''
    : issued.tempPassword
      ? `HERMAPS ${issued.reset ? 'yeni geçici şifreniz' : 'yönetici hesabınız açıldı'}.\nE-posta ile giriş: ${issued.user.email}\nYedek giriş — telefon: ${formatPhone(issued.user.phone)}, geçici şifre: ${issued.tempPassword}`
      : `HERMAPS hesabınız açıldı.\nUygulamayı açın, e-posta adresinizi (${issued.user.email}) yazın ve e-postanıza gelen 6 haneli kodla giriş yapın.`;

  const renderUser = ({ item: u }) => {
    const rem = remainingOf(u, now);
    return (
      <View style={styles.row}>
        <View style={styles.rowHead}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>
              {u.name}
            </Text>
            <Text style={styles.phone} numberOfLines={1}>
              {[u.email, formatPhone(u.phone)].filter(Boolean).join(' · ')}
            </Text>
            {tab === 'member' && u.lastPurchase && (
              <Text style={styles.phone} numberOfLines={1}>
                Son satın alma: {PLAN_LABELS[u.lastPurchase.productId] ?? u.lastPurchase.productId} ·{' '}
                {new Date(u.lastPurchase.at).toLocaleDateString('tr-TR')}
              </Text>
            )}
          </View>
          {tab === 'member' && (
            <View style={[styles.pill, styles[`pill_${rem.tone}`]]}>
              <Text style={[styles.pillText, styles[`pillText_${rem.tone}`]]}>{rem.text}</Text>
            </View>
          )}
        </View>
        <View style={styles.actions}>
          {tab === 'member' &&
            [
              [1, '+1 gün'],
              [3, '+3 gün'],
              [7, '+1 hafta'],
            ].map(([days, label]) => (
              <Pressable key={days} style={styles.chipBlue} onPress={() => act(() => api.extendUser(u.id, days), `${u.name}: ${label} eklendi.`)}>
                <Text style={styles.chipBlueText}>{label}</Text>
              </Pressable>
            ))}
          {tab === 'member' &&
            rem.tone !== 'none' &&
            rem.tone !== 'bad' &&
            confirmable(`${u.id}:expire`, 'Süreyi bitir', () => act(() => api.expireUser(u.id), `${u.name}: süre bitirildi.`), true)}
          {tab === 'admin' && confirmable(`${u.id}:reset`, 'Şifre sıfırla', () => resetPassword(u))}
          {confirmable(`${u.id}:delete`, 'Sil', () => act(() => api.deleteUser(u.id), `${u.name} silindi.`), true)}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Yönetim</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>Kapat</Text>
            </Pressable>
          </View>
          <View style={styles.tabs}>
            {TABS.map(([key, label]) => (
              <Pressable key={key} style={[styles.tab, tab === key && styles.tabOn]} onPress={() => switchTab(key)}>
                <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>
                  {label}
                  {lists[key]?.length ? ` (${lists[key].length})` : ''}
                </Text>
              </Pressable>
            ))}
          </View>

          <>
            {issued && (
              <View style={styles.issued}>
                <Text style={styles.issuedTitle}>
                  {issued.reset ? 'Yeni geçici şifre' : `${tab === 'admin' ? 'Yönetici' : 'Üye'} eklendi ✓`}
                </Text>
                <Text style={styles.issuedSub}>
                  {[issued.user.name, issued.user.email, formatPhone(issued.user.phone)].filter(Boolean).join(' · ')}
                </Text>
                {issued.tempPassword ? (
                  <Text style={styles.issuedPw} selectable>
                    Yedek geçici şifre: <Text style={styles.issuedPwValue}>{issued.tempPassword}</Text>
                  </Text>
                ) : (
                  <Text style={styles.issuedPw}>
                    Şifre yok: uygulamada e-postasını yazıp gelen kodla girer. Aşağıdan haber verin.
                  </Text>
                )}
                <View style={styles.issuedActions}>
                  {!!issued.user.phone && (
                    <Pressable
                      style={[styles.btn, { backgroundColor: '#25d366', flex: 1 }]}
                      onPress={() =>
                        Linking.openURL(`https://wa.me/90${issued.user.phone.slice(1)}?text=${encodeURIComponent(shareMessage)}`)
                      }
                    >
                      <Text style={styles.btnText}>{"WhatsApp'a gönder"}</Text>
                    </Pressable>
                  )}
                  <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => Share.share({ message: shareMessage }).catch(() => {})}>
                    <Text style={styles.btnGhostText}>Paylaş</Text>
                  </Pressable>
                  <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => setIssued(null)}>
                    <Text style={styles.btnGhostText}>Tamam</Text>
                  </Pressable>
                </View>
                {tab === 'member' && !issued.reset && (
                  <Text style={styles.issuedHint}>{'Yeni üye "Süre yok" olarak başlar; aşağıdan süre ekleyin.'}</Text>
                )}
              </View>
            )}

            {adding ? (
              <View style={styles.addForm}>
                <TextInput
                  style={styles.input}
                  placeholder="Ad soyad"
                  value={form.name}
                  onChangeText={(name) => setForm((f) => ({ ...f, name }))}
                  maxLength={80}
                />
                <TextInput
                  style={styles.input}
                  placeholder="E-posta (giriş kodu buraya gider)"
                  value={form.email}
                  onChangeText={(email) => setForm((f) => ({ ...f, email }))}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TextInput
                  style={styles.input}
                  placeholder={tab === 'admin' ? 'Telefon (yedek giriş için)' : 'Telefon (isteğe bağlı, WhatsApp için)'}
                  value={form.phone}
                  onChangeText={(phone) => setForm((f) => ({ ...f, phone }))}
                  keyboardType="phone-pad"
                />
                <View style={styles.issuedActions}>
                  <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => setAdding(false)}>
                    <Text style={styles.btnGhostText}>Vazgeç</Text>
                  </Pressable>
                  <Pressable style={[styles.btn, { flex: 1 }]} onPress={create}>
                    <Text style={styles.btnText}>{tab === 'admin' ? 'Yöneticiyi ekle' : 'Üyeyi ekle'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.toolbar}>
                <TextInput style={[styles.input, styles.search]} placeholder="Ad, e-posta ya da telefon ara" value={query} onChangeText={setQuery} />
                <Pressable
                  style={styles.btn}
                  onPress={() => {
                    setAdding(true);
                    setIssued(null);
                  }}
                >
                  <Text style={styles.btnText}>＋ {tab === 'admin' ? 'Yönetici' : 'Üye'} ekle</Text>
                </Pressable>
              </View>
            )}

            {tab === 'admin' && (
              <Text style={styles.hint}>Yöneticiler yalnızca yol kapatıp açar ve gruplara erişir; üyeleri göremez, süre veremez.</Text>
            )}
            {loading && !list.length ? (
              <ActivityIndicator style={{ marginTop: 20 }} />
            ) : (
              <FlatList
                data={list}
                keyExtractor={(u) => u.id}
                renderItem={renderUser}
                keyboardShouldPersistTaps="handled"
                style={styles.list}
                ListEmptyComponent={
                  <Text style={styles.empty}>{query ? 'Eşleşen kişi yok.' : tab === 'admin' ? 'Henüz yönetici yok.' : 'Henüz üye yok.'}</Text>
                }
              />
            )}
          </>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 30, maxHeight: '92%', minHeight: '70%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 20, fontWeight: '800' },
  close: { color: '#0a66d8', fontSize: 15, fontWeight: '600' },
  tabs: { flexDirection: 'row', backgroundColor: '#f2f2f7', borderRadius: 10, padding: 3, marginBottom: 10 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabOn: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 3, elevation: 1 },
  tabText: { color: '#3a3a3c', fontSize: 13 },
  tabTextOn: { fontWeight: '700', color: '#000' },
  toolbar: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6 },
  search: { flex: 1, minWidth: 0, marginBottom: 0 },
  input: { borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, marginBottom: 8, color: '#1c1c1e' },
  btn: { backgroundColor: '#0a66d8', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: { backgroundColor: '#f2f2f7' },
  btnGhostText: { color: '#1c1c1e', fontWeight: '600', fontSize: 14 },
  addForm: { marginBottom: 6 },
  list: { flexGrow: 0 },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#d1d1d6', paddingVertical: 10, gap: 8 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '700', color: '#1c1c1e' },
  phone: { fontSize: 12.5, color: '#6e6e73', marginTop: 1 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pill_ok: { backgroundColor: '#e3f5e8' },
  pill_warn: { backgroundColor: '#fff1d6' },
  pill_bad: { backgroundColor: '#fde7e9' },
  pill_none: { backgroundColor: '#eef0f3' },
  pillText: { fontSize: 12, fontWeight: '700' },
  pillText_ok: { color: '#1f7a3a' },
  pillText_warn: { color: '#8a5a00' },
  pillText_bad: { color: '#b0000f' },
  pillText_none: { color: '#6e6e73' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipBlue: { borderWidth: 1, borderColor: '#c7d8f3', backgroundColor: '#f4f8fe', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  chipBlueText: { color: '#0a66d8', fontWeight: '700', fontSize: 12.5 },
  chip: { borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  chipText: { color: '#3a3a3c', fontSize: 12.5 },
  chipDanger: { borderColor: '#f3c4c9', backgroundColor: '#fff5f6' },
  chipDangerText: { color: '#b0000f', fontWeight: '600' },
  chipArmed: { backgroundColor: '#d70015', borderColor: '#d70015' },
  chipArmedText: { color: '#fff', fontWeight: '700' },
  issued: { backgroundColor: '#f2f7ff', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#c7d8f3' },
  issuedTitle: { fontWeight: '800', fontSize: 15, color: '#1c1c1e' },
  issuedSub: { color: '#6e6e73', fontSize: 12.5, marginTop: 2 },
  issuedPw: { fontSize: 14, marginTop: 8, color: '#1c1c1e' },
  issuedPwValue: { fontSize: 20, fontWeight: '800', letterSpacing: 3 },
  issuedActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  issuedHint: { fontSize: 12, color: '#6e6e73', marginTop: 8 },
  hint: { fontSize: 12, color: '#6e6e73', marginBottom: 8 },
  empty: { color: '#6e6e73', textAlign: 'center', marginTop: 20 },
});
