import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIVACY } from './legal';

/** Gizlilik Politikası ve KVKK Aydınlatma Metni (kayıt ekranından ve Ayarlar'dan açılır). */
export default function PrivacyScreen({ visible, onClose }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <Text style={styles.brand}>HERMAPS</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Kapat">
            <Text style={styles.close}>Kapat</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}>
          <Text style={styles.title}>{PRIVACY.title}</Text>
          <Text style={styles.meta}>
            Sürüm {PRIVACY.version} · Son güncelleme: {PRIVACY.updated}
          </Text>
          <Text style={styles.text}>{PRIVACY.intro}</Text>
          {PRIVACY.sections.map((sec) => (
            <View key={sec.title}>
              <Text style={styles.heading}>{sec.title}</Text>
              {sec.body.map((line) => (
                <View key={line} style={styles.item}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={[styles.text, { flex: 1 }]}>{line}</Text>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d1d6',
  },
  brand: { fontSize: 15, fontWeight: '900', letterSpacing: 2, color: '#1c1c1e' },
  close: { color: '#0a66d8', fontSize: 16, fontWeight: '700' },
  body: { padding: 18 },
  title: { fontSize: 22, fontWeight: '800', color: '#1c1c1e' },
  meta: { fontSize: 12.5, color: '#6e6e73', marginTop: 4, marginBottom: 12 },
  heading: { fontSize: 16.5, fontWeight: '800', color: '#1c1c1e', marginTop: 20, marginBottom: 6 },
  item: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  bullet: { color: '#6e6e73', fontSize: 14.5, lineHeight: 21 },
  text: { fontSize: 14.5, color: '#3a3a3c', lineHeight: 21 },
});
