import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

/**
 * Kayıtlı kapatma grupları: haritada kapatılan yolları bir isimle kaydetme ve
 * kayıtlı bir grubu tek dokunuşla trafiğe kapatma / açma.
 */
export default function ZonesSheet({ visible, zones, unsavedCount, onClose, onSave, onToggle, onDelete, onShow }) {
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const run = async (id, fn) => {
    setBusyId(id);
    try {
      await fn();
    } finally {
      setBusyId(null);
    }
  };

  const save = () =>
    run('save', async () => {
      if (await onSave(name.trim())) setName('');
    });

  const canSave = name.trim().length > 0 && unsavedCount > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} onShow={() => setConfirmDelete(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.headRow}>
            <Text style={styles.title}>Kayıtlı gruplar</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.done}>Bitti</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>
            {unsavedCount > 0
              ? `Haritada kapattığınız ${unsavedCount} yol parçasını bir isimle kaydedin`
              : 'Kaydetmek için önce haritada yollara dokunarak kapatın'}
          </Text>
          <View style={styles.saveRow}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Ör. Maraton güzergâhı"
              maxLength={80}
              returnKeyType="done"
              onSubmitEditing={canSave ? save : undefined}
            />
            <Pressable style={[styles.saveButton, !canSave && styles.disabled]} disabled={!canSave || busyId === 'save'} onPress={save}>
              <Text style={styles.saveText}>Kaydet</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={{ gap: 10 }}>
            {zones.length === 0 && <Text style={styles.empty}>Henüz kayıtlı grup yok.</Text>}
            {zones.map((z) => {
              const km = z.segments.reduce((sum, s) => sum + s.lengthMeters, 0) / 1000;
              return (
                <View key={z.id} style={styles.zone}>
                  <Pressable style={{ flex: 1 }} onPress={() => onShow(z)}>
                    <Text style={styles.zoneName} numberOfLines={1}>
                      {z.name}
                    </Text>
                    <View style={styles.metaRow}>
                      <View style={[styles.badge, z.active ? styles.badgeClosed : styles.badgeOpen]}>
                        <Text style={[styles.badgeText, { color: z.active ? '#d70015' : '#0b8a3e' }]}>
                          {z.active ? 'Trafiğe kapalı' : 'Trafiğe açık'}
                        </Text>
                      </View>
                      <Text style={styles.zoneMeta}>
                        {z.segments.length} parça · {km.toFixed(1).replace('.', ',')} km
                      </Text>
                    </View>
                  </Pressable>
                  {confirmDelete === z.id ? (
                    <View style={styles.actions}>
                      <Pressable style={[styles.small, styles.ghost]} onPress={() => setConfirmDelete(null)}>
                        <Text style={styles.ghostText}>Vazgeç</Text>
                      </Pressable>
                      <Pressable style={[styles.small, styles.red]} onPress={() => run(z.id, () => onDelete(z))}>
                        <Text style={styles.smallText}>Sil</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.actions}>
                      <Pressable
                        style={[styles.small, z.active ? styles.green : styles.red, busyId === z.id && styles.disabled]}
                        disabled={busyId === z.id}
                        onPress={() => run(z.id, () => onToggle(z))}
                      >
                        <Text style={styles.smallText}>{z.active ? 'Trafiğe aç' : 'Trafiğe kapat'}</Text>
                      </Pressable>
                      <Pressable style={[styles.small, styles.ghost]} onPress={() => setConfirmDelete(z.id)}>
                        <Text style={styles.ghostText}>Sil</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 36, maxHeight: '80%' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: '700' },
  done: { fontSize: 16, fontWeight: '600', color: '#0a66d8' },
  label: { color: '#6e6e73', fontSize: 13, marginTop: 14, marginBottom: 6 },
  saveRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  saveButton: { backgroundColor: '#0a66d8', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.45 },
  list: { marginTop: 16 },
  empty: { color: '#6e6e73', fontSize: 14 },
  zone: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f6f6f8', borderRadius: 12, padding: 12 },
  zoneName: { fontSize: 16, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeClosed: { backgroundColor: '#fde7e9' },
  badgeOpen: { backgroundColor: '#e3f5ea' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  zoneMeta: { color: '#6e6e73', fontSize: 12 },
  actions: { gap: 6, alignItems: 'stretch' },
  small: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' },
  smallText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  green: { backgroundColor: '#0b8a3e' },
  red: { backgroundColor: '#d70015' },
  ghost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d1d6' },
  ghostText: { color: '#1d1d1f', fontWeight: '600', fontSize: 14 },
});
