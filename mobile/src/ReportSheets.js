import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

// Bildirim türleri (sunucudaki REPORT_TYPES ile aynı anahtarlar).
export const REPORT_OPTIONS = [
  { type: 'roadwork', label: 'Yol çalışması', icon: '🚧' },
  { type: 'accident', label: 'Kaza', icon: '💥' },
  { type: 'closed', label: 'Yol kapalı', icon: '⛔' },
  { type: 'breakdown', label: 'Araç arızası', icon: '🚗' },
  { type: 'other', label: 'Diğer', icon: '❗' },
];
export const reportIcon = (type) => REPORT_OPTIONS.find((o) => o.type === type)?.icon ?? '❗';

function timeAgo(iso, now) {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (min < 1) return 'şimdi';
  if (min < 60) return `${min} dk önce`;
  return `${Math.floor(min / 60)} sa önce`;
}

/** Kullanıcının bulunduğu yerdeki durumu bildirmesi. Yol kapanmaz; yöneticilere iletilir. */
export function ReportSheet({ visible, onClose, onSend }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const send = async (type) => {
    setBusy(type);
    setError(null);
    try {
      await onSend(type);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onShow={() => setError(null)}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.title}>Ne bildirmek istiyorsunuz?</Text>
        <Text style={styles.sub}>Bulunduğunuz yer yöneticilere iletilir. Yol hemen kapanmaz; yönetici kontrol eder.</Text>
        <View style={styles.grid}>
          {REPORT_OPTIONS.map((o) => (
            <Pressable
              key={o.type}
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
              onPress={() => send(o.type)}
              disabled={!!busy}
              accessibilityLabel={`Bildir: ${o.label}`}
            >
              {busy === o.type ? <ActivityIndicator /> : <Text style={styles.optionIcon}>{o.icon}</Text>}
              <Text style={styles.optionLabel}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable style={styles.cancel} onPress={onClose}>
          <Text style={styles.cancelText}>Vazgeç</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/** Sahip / yönetici: gelen bildirimler. Yolu kapatmak için "Haritada göster" ile yere gidilir. */
export function ReportsSheet({ visible, reports, onClose, onShow, onDismiss }) {
  const now = Date.now(); // eslint-disable-line react-hooks/purity -- "kaç dakika önce" yazısı için
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { maxHeight: '75%' }]}>
        <View style={styles.headRow}>
          <Text style={styles.title}>Bildirimler</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.done}>Bitti</Text>
          </Pressable>
        </View>
        <Text style={styles.sub}>{'Son 24 saat. Yolu kapatmak için "Haritada göster"e basın, sonra yola dokunun.'}</Text>
        <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 6 }}>
          {reports.length === 0 && <Text style={styles.empty}>Yeni bildirim yok.</Text>}
          {reports.map((r) => (
            <View key={r.id} style={styles.report}>
              <Text style={styles.reportIcon}>{reportIcon(r.type)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.reportTitle}>{r.label}</Text>
                <Text style={styles.reportMeta} numberOfLines={2}>
                  {[r.road, timeAgo(r.createdAt, now), r.userName].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <Pressable style={[styles.small, styles.blue]} onPress={() => onShow(r)}>
                  <Text style={styles.smallText}>Haritada göster</Text>
                </Pressable>
                <Pressable style={[styles.small, styles.ghost]} onPress={() => onDismiss(r)}>
                  <Text style={styles.ghostText}>Kaldır</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 34 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: '800', color: '#1c1c1e' },
  done: { fontSize: 16, fontWeight: '600', color: '#0a66d8' },
  sub: { fontSize: 13.5, color: '#6e6e73', marginTop: 4, marginBottom: 14, lineHeight: 19 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  option: {
    width: '31%',
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#f2f2f7',
    gap: 6,
  },
  optionPressed: { backgroundColor: '#e5e5ea' },
  optionIcon: { fontSize: 28, lineHeight: 34 },
  optionLabel: { fontSize: 13.5, fontWeight: '700', color: '#1c1c1e', textAlign: 'center' },
  error: { color: '#d70015', fontSize: 13.5, fontWeight: '600', marginTop: 10 },
  cancel: { marginTop: 14, borderRadius: 12, backgroundColor: '#f2f2f7', paddingVertical: 13, alignItems: 'center' },
  cancelText: { fontSize: 16, fontWeight: '600', color: '#1c1c1e' },
  empty: { color: '#6e6e73', fontSize: 14 },
  report: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f6f6f8', borderRadius: 12, padding: 12 },
  reportIcon: { fontSize: 26 },
  reportTitle: { fontSize: 16, fontWeight: '700', color: '#1c1c1e' },
  reportMeta: { fontSize: 12.5, color: '#6e6e73', marginTop: 2 },
  small: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center' },
  blue: { backgroundColor: '#0a66d8' },
  smallText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  ghost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d1d6' },
  ghostText: { color: '#1d1d1f', fontWeight: '600', fontSize: 13 },
});
