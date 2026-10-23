import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

const COSTINGS = [
  { key: 'auto', label: 'Araç' },
  { key: 'motorcycle', label: 'Motor' },
];

const BACKENDS = [
  { key: 'demo', label: 'Demo (herkese açık)' },
  { key: 'server', label: 'Kendi sunucum' },
];

export default function SettingsSheet({ visible, settings, adminMode, onClose, onSave, onAdminModeChange }) {
  const [draft, setDraft] = useState(settings);
  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));
  const demo = draft.backend === 'demo';

  return (
    <Modal visible={visible} animationType="slide" transparent onShow={() => setDraft(settings)} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Ayarlar</Text>

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
              Herkese açık OpenStreetMap Valhalla sunucusu kullanılır. Kapattığınız yollar yalnızca bu telefonda geçerlidir.
            </Text>
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

          {!demo && (
            <>
              <Text style={styles.label}>Yönetici anahtarı</Text>
              <TextInput
                style={styles.input}
                value={draft.adminToken}
                onChangeText={set('adminToken')}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                placeholder="Yalnızca yöneticiler için"
              />
            </>
          )}

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Yönetici modu</Text>
              <Text style={styles.rowSub}>Açıkken haritada bir sokağa dokunmak onu kapatır / açar.</Text>
            </View>
            <Switch value={adminMode} onValueChange={(v) => onAdminModeChange(v, draft)} />
          </View>

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
