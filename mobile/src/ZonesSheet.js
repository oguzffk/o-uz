import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

// Aramada büyük/küçük harf ve Türkçe karakter farkı gözetilmez ("isk" → "İSKİ Kazısı").
const fold = (t) =>
  String(t)
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c])
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/**
 * Kayıtlı kapatma grupları: haritada kapatılan yolları bir isimle kaydetme ve
 * kayıtlı bir grubu tek dokunuşla trafiğe kapatma / açma.
 */
export default function ZonesSheet({ visible, zones, unsavedCount, closedCount, onClose, onSave, onToggle, onDelete, onShow, onOpenAll, onEdit }) {
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [query, setQuery] = useState('');
  const shown = query.trim() ? zones.filter((z) => fold(z.name).includes(fold(query.trim()))) : zones;

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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} onShow={() => {
        setConfirmDelete(null);
        setQuery('');
      }}>
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
              placeholderTextColor="#8e8e93"
              maxLength={80}
              returnKeyType="done"
              onSubmitEditing={canSave ? save : undefined}
            />
            <Pressable style={[styles.saveButton, !canSave && styles.disabled]} disabled={!canSave || busyId === 'save'} onPress={save}>
              <Text style={styles.saveText}>Kaydet</Text>
            </Pressable>
          </View>

          {closedCount > 0 &&
            (confirmDelete === 'all' ? (
              <View style={styles.openAllConfirm}>
                <Text style={styles.openAllQuestion}>
                  {closedCount} kapalı yol parçasının hepsi trafiğe açılsın mı? Kayıtlı gruplar silinmez.
                </Text>
                <View style={styles.openAllActions}>
                  <Pressable style={[styles.small, styles.ghost, { flex: 1 }]} onPress={() => setConfirmDelete(null)}>
                    <Text style={styles.ghostText}>Vazgeç</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.small, styles.green, { flex: 1 }, busyId === 'all' && styles.disabled]}
                    disabled={busyId === 'all'}
                    onPress={() => run('all', async () => {
                      await onOpenAll();
                      setConfirmDelete(null);
                    })}
                  >
                    <Text style={styles.smallText}>Evet, hepsini aç</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable style={styles.openAll} onPress={() => setConfirmDelete('all')}>
                <Text style={styles.openAllText}>Tüm yolları trafiğe aç ({closedCount})</Text>
              </Pressable>
            ))}

          {zones.length > 0 && (
            <View style={styles.searchRow}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Kayıtlı grup ara"
                placeholderTextColor="#8e8e93"
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Kayıtlı grup ara"
              />
              {!!query && (
                <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Aramayı temizle">
                  <Text style={styles.searchClear}>✕</Text>
                </Pressable>
              )}
            </View>
          )}

          <ScrollView style={styles.list} contentContainerStyle={{ gap: 10 }} keyboardShouldPersistTaps="handled">
            {zones.length === 0 && <Text style={styles.empty}>Henüz kayıtlı grup yok.</Text>}
            {zones.length > 0 && shown.length === 0 && (
              <Text style={styles.empty}>"{query.trim()}" adında kayıtlı grup yok.</Text>
            )}
            {shown.map((z) => {
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
                      <Pressable style={[styles.small, styles.ghost]} onPress={() => onEdit(z)}>
                        <Text style={styles.ghostText}>Düzenle</Text>
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
  input: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: '#1c1c1e' },
  saveButton: { backgroundColor: '#0a66d8', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.45 },
  list: { marginTop: 12 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    backgroundColor: '#f2f2f7',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 10, fontSize: 16, color: '#1c1c1e' },
  searchClear: { color: '#8e8e93', fontSize: 16, fontWeight: '700', paddingHorizontal: 2 },
  openAll: { marginTop: 14, borderWidth: 1.5, borderColor: '#0b8a3e', borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  openAllText: { color: '#0b8a3e', fontWeight: '700', fontSize: 15 },
  openAllConfirm: { marginTop: 14, backgroundColor: '#e3f5ea', borderRadius: 10, padding: 12, gap: 10 },
  openAllQuestion: { fontSize: 14, color: '#1d1d1f' },
  openAllActions: { flexDirection: 'row', gap: 8 },
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
