import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
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
export default function SettingsSheet({ visible, settings, user, onClose, onSave, onLogout }) {
  const [draft, setDraft] = useState(settings);
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
              <Pressable style={styles.logout} onPress={onLogout}>
                <Text style={styles.logoutText}>Çıkış yap</Text>
              </Pressable>
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
  logoutText: { color: '#b0000f', fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  segment: { flexDirection: 'row', backgroundColor: '#f2f2f7', borderRadius: 10, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  segmentOn: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 3, elevation: 1 },
  segmentText: { color: '#3a3a3c', fontSize: 14 },
  segmentTextOn: { fontWeight: '700', color: '#000' },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 18, gap: 12 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSub: { color: '#6e6e73', fontSize: 13, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 24 },
  button: { flex: 1, backgroundColor: '#0a66d8', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { backgroundColor: '#f2f2f7' },
  secondaryText: { color: '#1d1d1f', fontSize: 16, fontWeight: '600' },
});
