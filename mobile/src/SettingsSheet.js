import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import PrivacyScreen from './PrivacyScreen';
import { ROLE_LABELS, formatRemaining } from './session';

const COSTINGS = [
  { key: 'auto', label: 'Araç' },
  { key: 'motorcycle', label: 'Motor' },
];

const BACKENDS = [
  { key: 'demo', label: 'Demo (herkese açık)' },
  { key: 'server', label: 'Kendi sunucum' },
];

// `user` yoksa (giriş ekranından açıldığında) yalnızca sunucu seçimi gösterilir.
export default function SettingsSheet({ visible, settings, user, onClose, onSave, onLogout, onBuy, onDeleteAccount }) {
  const [draft, setDraft] = useState(settings);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));
  const demo = draft.backend === 'demo';

  return (
    <Modal visible={visible} animationType="slide" transparent onShow={() => setDraft(settings)} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Ayarlar</Text>

          {user && (
            <View style={styles.account}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{user.name}</Text>
                <Text style={styles.rowSub}>
                  {[ROLE_LABELS[user.role], user.email, user.phone].filter(Boolean).join(' · ')}
                  {user.role === 'member' && user.expiresAt ? ` · ${formatRemaining(user.expiresAt - Date.now())}` : ''}
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                {user.role === 'member' && (
                  <Pressable style={styles.buy} onPress={onBuy}>
                    <Text style={styles.buyText}>Süre satın al</Text>
                  </Pressable>
                )}
                <Pressable style={styles.logout} onPress={onLogout}>
                  <Text style={styles.logoutText}>Çıkış yap</Text>
                </Pressable>
              </View>
            </View>
          )}
          {user && (
            <View style={styles.links}>
              <Pressable onPress={() => setPrivacyOpen(true)} hitSlop={6}>
                <Text style={styles.linkText}>Gizlilik Politikası</Text>
              </Pressable>
              {user.role !== 'owner' && (
                <Pressable onPress={() => setDeleting(true)} hitSlop={6}>
                  <Text style={styles.deleteLink}>Hesabımı sil</Text>
                </Pressable>
              )}
            </View>
          )}

          <Text style={styles.label}>Rota sunucusu</Text>
          <View style={styles.segment}>
            {BACKENDS.map((b) => (
              <Pressable
                key={b.key}
                onPress={() => set('backend')(b.key)}
                style={[styles.segmentItem, draft.backend === b.key && styles.segmentOn]}
              >
                <Text style={[styles.segmentText, draft.backend === b.key && styles.segmentTextOn]}>{b.label}</Text>
              </Pressable>
            ))}
          </View>
          {demo && (
            <Text style={styles.hint}>
              Herkese açık OpenStreetMap Valhalla sunucusu kullanılır. Hesaplar ve kapattığınız yollar yalnızca bu telefonda
              geçerlidir.
            </Text>
          )}
          {user && draft.backend !== settings.backend && (
            <Text style={styles.warn}>Sunucu değişince bu hesaptan çıkış yapılır; yeni sunucuda tekrar giriş yapın.</Text>
          )}

          {!demo && (
            <>
              <Text style={styles.label}>Sunucu adresi</Text>
              <TextInput
                style={styles.input}
                value={draft.apiUrl}
                onChangeText={set('apiUrl')}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="http://192.168.1.20:3000"
                placeholderTextColor="#8e8e93"
              />
            </>
          )}

          {user && (
            <>
              <Text style={styles.label}>Ulaşım türü</Text>
              <View style={styles.segment}>
                {COSTINGS.map((c) => (
                  <Pressable
                    key={c.key}
                    onPress={() => set('costing')(c.key)}
                    style={[styles.segmentItem, draft.costing === c.key && styles.segmentOn]}
                  >
                    <Text style={[styles.segmentText, draft.costing === c.key && styles.segmentTextOn]}>{c.label}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Ücretli yollardan kaçın</Text>
                  <Text style={styles.rowSub}>Köprü, tünel ve otoyol ücretlerinden mümkün olduğunca kaçınır.</Text>
                </View>
                <Switch value={Boolean(draft.avoidTolls)} onValueChange={set('avoidTolls')} />
              </View>
            </>
          )}

          <View style={styles.actions}>
            <Pressable style={[styles.button, styles.secondary]} onPress={onClose}>
              <Text style={styles.secondaryText}>Vazgeç</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => onSave(draft)}>
              <Text style={styles.buttonText}>Kaydet</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
      <PrivacyScreen visible={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      {user && <DeleteAccountDialog visible={deleting} user={user} onCancel={() => setDeleting(false)} onConfirm={onDeleteAccount} />}
    </Modal>
  );
}

/** Hesabı kalıcı olarak silme onayı. Şifresi olan hesap şifresini girer. */
function DeleteAccountDialog({ visible, user, onCancel, onConfirm }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const remaining = user.role === 'member' && user.expiresAt > now ? formatRemaining(user.expiresAt - now) : null;

  const confirm = async () => {
    if (user.hasPassword && !password) return setError('Şifrenizi girin.');
    setBusy(true);
    setError(null);
    try {
      await onConfirm(password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onShow={() => {
        setPassword('');
        setNow(Date.now());
      }} onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.dialogBackdrop}>
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>Hesabımı sil</Text>
          <Text style={styles.dialogText}>Hesabınız kalıcı olarak silinir ve geri alınamaz:</Text>
          <Text style={styles.dialogItem}>• Ad, e-posta, telefon ve şifreniz silinir</Text>
          <Text style={styles.dialogItem}>
            • {remaining ? `Kalan kullanım süreniz (${remaining}) silinir` : 'Kullanım süreniz ve satın alma kayıtlarınız silinir'}
          </Text>
          <Text style={styles.dialogItem}>• Mağaza satın alımlarının iadesi Apple / Google kurallarına tabidir</Text>
          {user.hasPassword && (
            <TextInput
              style={[styles.input, { marginTop: 12 }]}
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setError(null);
              }}
              secureTextEntry
              autoCapitalize="none"
              placeholder="Onay için şifreniz"
              placeholderTextColor="#8e8e93"
              onSubmitEditing={confirm}
            />
          )}
          {!!error && <Text style={styles.dialogError}>{error}</Text>}
          <Pressable style={[styles.deleteButton, busy && { opacity: 0.7 }]} onPress={confirm} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Hesabımı kalıcı olarak sil</Text>}
          </Pressable>
          <Pressable style={[styles.button, styles.secondary, { flex: 0, marginTop: 8 }]} onPress={onCancel} disabled={busy}>
            <Text style={styles.secondaryText}>Vazgeç</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 36 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  label: { color: '#6e6e73', fontSize: 13, marginTop: 12, marginBottom: 6 },
  hint: { color: '#6e6e73', fontSize: 12, marginTop: 6 },
  warn: { color: '#b35f00', fontSize: 12, marginTop: 6, fontWeight: '600' },
  account: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f2f2f7', borderRadius: 12, padding: 12, marginBottom: 4 },
  logout: { borderWidth: 1, borderColor: '#f3c4c9', backgroundColor: '#fff5f6', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  logoutText: { color: '#b0000f', fontWeight: '700', textAlign: 'center' },
  buy: { backgroundColor: '#0a66d8', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  buyText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: '#1c1c1e' },
  segment: { flexDirection: 'row', backgroundColor: '#f2f2f7', borderRadius: 10, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  segmentOn: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 3, elevation: 1 },
  segmentText: { color: '#3a3a3c', fontSize: 14 },
  segmentTextOn: { fontWeight: '700', color: '#000' },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 18, gap: 12 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSub: { color: '#6e6e73', fontSize: 13, marginTop: 2 },
  links: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 8 },
  linkText: { color: '#0a66d8', fontSize: 14, fontWeight: '600' },
  deleteLink: { color: '#b0000f', fontSize: 14, fontWeight: '600' },
  dialogBackdrop: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 20 },
  dialog: { backgroundColor: '#fff', borderRadius: 18, padding: 20 },
  dialogTitle: { fontSize: 20, fontWeight: '800', color: '#b0000f', marginBottom: 6 },
  dialogText: { fontSize: 14.5, color: '#1c1c1e', marginBottom: 6 },
  dialogItem: { fontSize: 14, color: '#3a3a3c', lineHeight: 20 },
  dialogError: { color: '#d70015', fontSize: 13.5, fontWeight: '600', marginTop: 8 },
  deleteButton: { backgroundColor: '#d70015', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 24 },
  button: { flex: 1, backgroundColor: '#0a66d8', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { backgroundColor: '#f2f2f7' },
  secondaryText: { color: '#1d1d1f', fontSize: 16, fontWeight: '600' },
});
