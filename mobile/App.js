import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import MapView, { Marker, Polyline, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createApi, defaultApiUrl } from './src/api';
import { ISTANBUL_REGION, formatDistance, formatDuration, inIstanbul, toLatLng } from './src/geo';
import { stopSpeech, useNavigation } from './src/useNavigation';
import SettingsSheet from './src/SettingsSheet';

const SETTINGS_KEY = 'nav-settings-v1';
const CLOSURE_POLL_MS = 5000;

export default function App() {
  const mapRef = useRef(null);
  const [settings, setSettings] = useState({ apiUrl: defaultApiUrl(), adminToken: '', costing: 'auto' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminMode, setAdminMode] = useState(false);

  const [location, setLocation] = useState(null); // { lat, lon, heading }
  const [manualOrigin, setManualOrigin] = useState(null);
  const [destination, setDestination] = useState(null); // { lat, lon, name }
  const [route, setRoute] = useState(null);
  const [closures, setClosures] = useState({ version: -1, closures: [] });
  const [navigating, setNavigating] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const api = useMemo(() => createApi(settings.apiUrl, settings.adminToken), [settings]);

  const toastTimer = useRef(null);
  const showToast = useCallback((text, kind = 'info') => {
    setToast({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // --- Ayarlar (cihazda saklanır) ---
  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((raw) => raw && setSettings((s) => ({ ...s, ...JSON.parse(raw) })))
      .catch(() => {});
  }, []);

  const saveSettings = (next) => {
    setSettings(next);
    setSettingsOpen(false);
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
  };

  // --- Konum ---
  useEffect(() => {
    let sub;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showToast('Konum izni yok: başlangıç noktasını haritada basılı tutarak seçin.');
        return;
      }
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 3 },
        ({ coords }) => setLocation({ lat: coords.latitude, lon: coords.longitude, heading: coords.heading }),
      );
    })().catch((err) => showToast(err.message, 'error'));
    return () => sub?.remove();
  }, [showToast]);

  // Cihaz İstanbul dışındaysa (ör. emülatör) başlangıç haritadan seçilir.
  const gpsUsable = location && inIstanbul(location);
  const origin = gpsUsable ? location : manualOrigin;

  // --- Rota ---
  const routeRequest = useRef(0);
  const requestRoute = useCallback(
    async ({ to = destination, from = origin, quiet = false } = {}) => {
      if (!to) return;
      if (!from) {
        showToast('Önce başlangıç noktasını haritada basılı tutarak seçin.');
        return;
      }
      const reqId = ++routeRequest.current;
      setBusy(true);
      try {
        const heading = navigating && from === location ? location.heading : undefined;
        const r = await api.route({ from, to, costing: settings.costing, heading });
        if (reqId !== routeRequest.current) return; // daha yeni bir istek var
        setRoute(r);
        if (!navigating) {
          mapRef.current?.fitToCoordinates(r.coordinates.map(toLatLng), {
            edgePadding: { top: 160, right: 50, bottom: 260, left: 50 },
            animated: true,
          });
        }
        if (!quiet) Keyboard.dismiss();
      } catch (err) {
        if (reqId === routeRequest.current) showToast(err.message, 'error');
      } finally {
        if (reqId === routeRequest.current) setBusy(false);
      }
    },
    [api, destination, origin, location, navigating, settings.costing, showToast],
  );

  // Ulaşım türü değişince mevcut rota yenilenir.
  useEffect(() => {
    if (route && route.costing !== settings.costing) requestRoute({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.costing]);

  // --- Kapalı yollar: periyodik kontrol; değişince rota yeniden hesaplanır ---
  const latest = useRef({});
  latest.current = { route, requestRoute };
  const reroutedForVersion = useRef(null);
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const data = await api.closures();
        if (stopped) return;
        setClosures((prev) => (prev.version === data.version ? prev : data));
        const { route: r, requestRoute: rr } = latest.current;
        // Rota hesaplandıktan sonra yollar değişti: kapalı yoldan geçiyor olabilir.
        if (r && r.closuresVersion !== data.version && reroutedForVersion.current !== data.version) {
          reroutedForVersion.current = data.version; // aynı sürüm için tekrar tetiklenmesin
          showToast('Yol durumu değişti, rota güncelleniyor…');
          rr({ quiet: true });
        }
      } catch {
        // Sunucu geçici olarak erişilemezse sessizce tekrar denenir.
      }
    };
    tick();
    const id = setInterval(tick, CLOSURE_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [api, showToast]);

  // --- Seyir ---
  const progress = useNavigation({
    route,
    location: gpsUsable ? location : null,
    active: navigating,
    onOffRoute: () => {
      showToast('Rotadan çıkıldı, yeniden hesaplanıyor…');
      requestRoute({ quiet: true });
    },
    onArrive: () => {
      setNavigating(false);
      showToast('Hedefinize vardınız.');
    },
  });

  useEffect(() => {
    if (!navigating || !gpsUsable) return;
    mapRef.current?.animateCamera(
      {
        center: { latitude: location.lat, longitude: location.lon },
        heading: location.heading >= 0 ? location.heading : 0,
        pitch: 45,
        zoom: 17,
      },
      { duration: 800 },
    );
  }, [navigating, gpsUsable, location]);

  const startNavigation = () => {
    if (!gpsUsable) {
      showToast('Seyir için İstanbul içinde GPS konumu gerekli. Rota önizlemesi kullanılabilir.', 'error');
      return;
    }
    setNavigating(true);
    requestRoute({ from: location, quiet: true });
  };

  const stopNavigation = () => {
    setNavigating(false);
    stopSpeech();
  };

  const clearTrip = () => {
    stopNavigation();
    setRoute(null);
    setDestination(null);
    setQuery('');
  };

  // --- Arama ---
  const search = async () => {
    if (query.trim().length < 2) return;
    setBusy(true);
    try {
      const { results: r } = await api.search(query.trim());
      setResults(r);
      if (!r.length) showToast('Sonuç bulunamadı.');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const chooseDestination = (place) => {
    setResults([]);
    setQuery(place.name);
    setDestination(place);
    requestRoute({ to: place });
  };

  // --- Harita etkileşimi ---
  const onMapPress = async (e) => {
    if (!adminMode) return;
    const { latitude: lat, longitude: lon } = e.nativeEvent.coordinate;
    try {
      const r = await api.toggleClosure({ lat, lon });
      setClosures((prev) => ({
        version: r.version,
        closures:
          r.action === 'closed'
            ? [...prev.closures, r.closure]
            : prev.closures.filter((c) => c.id !== r.closure.id),
      }));
      showToast(`${r.action === 'closed' ? '⛔ Kapatıldı' : '✅ Açıldı'}: ${r.closure.name}`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const onMapLongPress = (e) => {
    if (navigating) return;
    const { latitude: lat, longitude: lon } = e.nativeEvent.coordinate;
    if (!gpsUsable && !manualOrigin) {
      setManualOrigin({ lat, lon });
      showToast('Başlangıç seçildi. Şimdi varış noktasını basılı tutun.');
      return;
    }
    const place = { lat, lon, name: 'Seçilen nokta' };
    setDestination(place);
    setQuery('');
    requestRoute({ to: place });
  };

  const onAdminModeChange = async (enabled, draft) => {
    if (!enabled) return setAdminMode(false);
    try {
      await createApi(draft.apiUrl, draft.adminToken).checkAdmin();
      saveSettings(draft);
      setAdminMode(true);
      showToast('Yönetici modu açık: kapatmak/açmak için bir sokağa dokunun.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const next = progress?.next;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={ISTANBUL_REGION}
        // Android'de Google altlığı yerine doğrudan OSM karoları gösterilir; böylece
        // haritada görülen yollar rota motorunun kullandığı veriyle aynı olur.
        mapType={Platform.OS === 'android' ? 'none' : 'standard'}
        showsUserLocation
        showsCompass={false}
        toolbarEnabled={false}
        onPress={onMapPress}
        onLongPress={onMapLongPress}
      >
        <UrlTile
          urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
          shouldReplaceMapContent
          tileSize={256}
        />
        {route && (
          <Polyline coordinates={route.coordinates.map(toLatLng)} strokeColor="#0a66d8" strokeWidth={7} zIndex={1} />
        )}
        {closures.closures.map((c) => (
          <Polyline
            key={c.id}
            coordinates={c.coordinates.map(toLatLng)}
            strokeColor="#d70015"
            strokeWidth={adminMode ? 9 : 6}
            zIndex={2}
          />
        ))}
        {manualOrigin && !gpsUsable && (
          <Marker coordinate={toLatLng([manualOrigin.lat, manualOrigin.lon])} pinColor="green" title="Başlangıç" />
        )}
        {destination && <Marker coordinate={toLatLng([destination.lat, destination.lon])} title={destination.name} />}
      </MapView>

      {/* Üst kısım: seyirde manevra bandı, değilse arama kutusu */}
      <View style={styles.top} pointerEvents="box-none">
        {navigating && next ? (
          <View style={styles.banner}>
            <Text style={styles.bannerDistance}>{formatDistance(progress.distanceToNext)}</Text>
            <Text style={styles.bannerText} numberOfLines={2}>
              {next.instruction}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.searchRow}>
              <TextInput
                style={styles.search}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={search}
                placeholder="Nereye gitmek istiyorsunuz?"
                returnKeyType="search"
              />
              <Pressable style={styles.iconButton} onPress={() => setSettingsOpen(true)}>
                <Text style={styles.iconText}>⚙︎</Text>
              </Pressable>
            </View>
            {results.length > 0 && (
              <FlatList
                style={styles.results}
                keyboardShouldPersistTaps="handled"
                data={results}
                keyExtractor={(item, i) => `${item.lat},${item.lon},${i}`}
                renderItem={({ item }) => (
                  <Pressable style={styles.result} onPress={() => chooseDestination(item)}>
                    <Text style={styles.resultName}>{item.name}</Text>
                    <Text style={styles.resultAddr} numberOfLines={1}>
                      {item.address}
                    </Text>
                  </Pressable>
                )}
              />
            )}
          </>
        )}
        {adminMode && (
          <View style={styles.adminPill}>
            <Text style={styles.adminPillText}>YÖNETİCİ MODU · {closures.closures.length} kapalı segment</Text>
          </View>
        )}
        {toast && (
          <View style={[styles.toast, toast.kind === 'error' && styles.toastError]}>
            <Text style={styles.toastText}>{toast.text}</Text>
          </View>
        )}
      </View>

      {/* Alt panel: rota özeti ve düğmeler */}
      {(route || busy) && (
        <View style={styles.bottom}>
          {busy && !route ? (
            <ActivityIndicator />
          ) : (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryMain}>
                  {formatDuration(
                    navigating && progress
                      ? (route.durationSec * progress.remainingMeters) / Math.max(1, route.distanceKm * 1000)
                      : route.durationSec,
                  )}
                </Text>
                <Text style={styles.summarySub}>
                  {formatDistance(navigating && progress ? progress.remainingMeters : route.distanceKm * 1000)}
                  {busy ? '  ·  güncelleniyor…' : ''}
                </Text>
              </View>
              <View style={styles.actions}>
                {navigating ? (
                  <Pressable style={[styles.button, styles.stop]} onPress={stopNavigation}>
                    <Text style={styles.buttonText}>Seyri bitir</Text>
                  </Pressable>
                ) : (
                  <>
                    <Pressable style={[styles.button, styles.secondary]} onPress={clearTrip}>
                      <Text style={styles.secondaryText}>Temizle</Text>
                    </Pressable>
                    <Pressable style={styles.button} onPress={startNavigation}>
                      <Text style={styles.buttonText}>Başla</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </>
          )}
        </View>
      )}

      <Text style={styles.attribution}>© OpenStreetMap katkıcıları</Text>

      <SettingsSheet
        visible={settingsOpen}
        settings={settings}
        adminMode={adminMode}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
        onAdminModeChange={onAdminModeChange}
      />
    </View>
  );
}

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.15,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 4,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#e9e9e9' },
  top: { position: 'absolute', top: 56, left: 12, right: 12, gap: 8 },
  searchRow: { flexDirection: 'row', gap: 8 },
  search: { flex: 1, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, ...shadow },
  iconButton: { width: 48, backgroundColor: '#fff', borderRadius: 12, alignItems: 'center', justifyContent: 'center', ...shadow },
  iconText: { fontSize: 22 },
  results: { backgroundColor: '#fff', borderRadius: 12, maxHeight: 320, ...shadow },
  result: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#d1d1d6' },
  resultName: { fontSize: 16, fontWeight: '600' },
  resultAddr: { fontSize: 12, color: '#6e6e73', marginTop: 2 },
  banner: { backgroundColor: '#0b5c3b', borderRadius: 14, padding: 16, ...shadow },
  bannerDistance: { color: '#fff', fontSize: 30, fontWeight: '800' },
  bannerText: { color: '#fff', fontSize: 18, marginTop: 4 },
  adminPill: { alignSelf: 'center', backgroundColor: '#d70015', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  adminPillText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  toast: { alignSelf: 'center', backgroundColor: 'rgba(29,29,31,0.92)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '100%' },
  toastError: { backgroundColor: 'rgba(215,0,21,0.95)' },
  toastText: { color: '#fff', fontSize: 14 },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 34, backgroundColor: '#fff', borderRadius: 16, padding: 16, ...shadow },
  summaryRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  summaryMain: { fontSize: 26, fontWeight: '800', color: '#0b8a3e' },
  summarySub: { fontSize: 16, color: '#3a3a3c' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  button: { flex: 1, backgroundColor: '#0a66d8', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  secondary: { backgroundColor: '#f2f2f7' },
  secondaryText: { color: '#1d1d1f', fontSize: 17, fontWeight: '600' },
  stop: { backgroundColor: '#d70015' },
  attribution: { position: 'absolute', right: 6, bottom: 6, fontSize: 10, color: '#3a3a3c', backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 4 },
});
