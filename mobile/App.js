import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createApi, defaultApiUrl } from './src/api';
import { createDemoApi } from './src/demoApi';
import {
  ISTANBUL_REGION,
  bearingDegrees,
  distanceMeters,
  formatDistance,
  formatDuration,
  inIstanbul,
  offsetPoint,
  pointAhead,
  toLatLng,
} from './src/geo';
import { stopSpeech, useNavigation } from './src/useNavigation';
import SettingsSheet from './src/SettingsSheet';
import { enterPip, pipSupported, setAutoPip, usePipMode } from './src/pip';
import ZonesSheet from './src/ZonesSheet';

const SETTINGS_KEY = 'nav-settings-v1';
const RECENTS_KEY = 'recent-places-v1';
const MAX_RECENTS = 8;
const CLOSURE_POLL_MS = 5000;

// Demo modu kendi sunucumuz olmadan herkese açık Valhalla'yı kullanır (bkz. src/demoApi.js).
const apiFor = (s) => (s.backend === 'demo' ? createDemoApi() : createApi(s.apiUrl, s.adminToken));

export default function App() {
  const mapRef = useRef(null);
  const [settings, setSettings] = useState({
    backend: process.env.EXPO_PUBLIC_API_URL ? 'server' : 'demo',
    apiUrl: defaultApiUrl(),
    adminToken: '',
    costing: 'auto',
    avoidTolls: false,
    voice: true,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminMode, setAdminMode] = useState(false);

  const [location, setLocation] = useState(null); // { lat, lon, heading }
  // Harita şu an kullanıcının konumunda mı? Seyirde bu "takip ediliyor" demek. Kullanıcı
  // haritayı kaydırınca ya da rota gösterilince false olur ve "Ortala" düğmesi çıkar.
  const [centered, setCentered] = useState(true);
  const [manualOrigin, setManualOrigin] = useState(null);
  const [destination, setDestination] = useState(null); // { lat, lon, name }
  const [route, setRoute] = useState(null); // seçili rota
  const [routeOptions, setRouteOptions] = useState([]); // önizlemede alternatifler dahil tüm rotalar
  const [closures, setClosures] = useState({ version: -1, closures: [], zones: [] });
  const [zonesOpen, setZonesOpen] = useState(false);
  const [editing, setEditing] = useState(null); // düzenlenen grup: { id, name }
  const [navigating, setNavigating] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState(null);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const [recents, setRecents] = useState([]); // son seçilen yerler (cihazda saklanır)
  // Temizle'de alt panel aşağı kayarak kaybolsun diye: 0 = yerinde, 1 = ekran dışında.
  const panelExit = useRef(new Animated.Value(0)).current;

  const api = useMemo(() => apiFor(settings), [settings]);
  const demo = settings.backend === 'demo';

  const toastTimer = useRef(null);
  const showToast = useCallback((text, kind = 'info') => {
    setToast({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // --- Ayarlar (cihazda saklanır) ---
  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw);
        // Bisiklet/yaya seçenekleri kaldırıldı; eskiden kaydedilmişse araca dön.
        if (!['auto', 'motorcycle'].includes(saved.costing)) saved.costing = 'auto';
        setSettings((s) => ({ ...s, ...saved }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(RECENTS_KEY)
      .then((raw) => raw && setRecents(JSON.parse(raw)))
      .catch(() => {});
  }, []);

  const storeRecents = (list) => {
    setRecents(list);
    AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(list)).catch(() => {});
  };

  // Seçilen yeri son aramaların başına ekler; aynı yer tekrar eklenmez.
  const addRecent = (place) => {
    const key = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    const entry = { name: place.name, address: place.address ?? '', lat: place.lat, lon: place.lon };
    storeRecents([entry, ...recents.filter((r) => key(r) !== key(entry))].slice(0, MAX_RECENTS));
  };

  const saveSettings = (next) => {
    setSettings(next);
    setSettingsOpen(false);
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
  };

  // --- Konum ---
  // locStatus: 'waiting' | 'denied' | 'off' | 'ok' — ekranda neden konum olmadığını söylemek için.
  const [locStatus, setLocStatus] = useState('waiting');
  useEffect(() => {
    let sub;
    let cancelled = false;
    const update = ({ coords }) => {
      if (cancelled) return;
      setLocation({ lat: coords.latitude, lon: coords.longitude, heading: coords.heading, speed: coords.speed });
      setLocStatus('ok');
    };
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return setLocStatus('denied');
      if (!(await Location.hasServicesEnabledAsync())) setLocStatus('off');
      // Hızlı ilk konum: son bilinen konum, sonra tek ölçüm; ardından sürekli takip.
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) update(last);
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(update).catch(() => {});
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 3 },
        update,
      );
    })().catch((err) => showToast(err.message, 'error'));
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [showToast]);

  // Konum ilk kez bulunduğunda harita oraya gelsin.
  const centeredOnce = useRef(false);
  useEffect(() => {
    if (!location || centeredOnce.current) return;
    centeredOnce.current = true;
    if (inIstanbul(location)) {
      mapRef.current?.animateCamera({ center: { latitude: location.lat, longitude: location.lon }, zoom: 15 }, { duration: 800 });
    }
  }, [location]);

  const goToMyLocation = () => {
    if (!location) {
      showToast(
        locStatus === 'denied'
          ? 'Konum izni verilmedi. Telefon ayarlarından bu uygulamaya konum izni verin.'
          : 'Konum henüz bulunamadı. Telefonun Konum (GPS) özelliğinin açık olduğundan emin olun.',
        'error',
      );
      return;
    }
    if (!inIstanbul(location)) showToast('Konumunuz İstanbul dışında görünüyor.');
    mapRef.current?.animateCamera({ center: { latitude: location.lat, longitude: location.lon }, zoom: 16 }, { duration: 600 });
    setCentered(true);
  };

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
        // Seyir sırasında (yeniden rota) tek rota yeter; önizlemede alternatifler de istenir.
        const r = await api.route({
          from,
          to,
          costing: settings.costing,
          avoidTolls: settings.avoidTolls,
          heading,
          alternatives: !navigating,
        });
        if (reqId !== routeRequest.current) return; // daha yeni bir istek var
        const meta = { closuresVersion: r.closuresVersion, costing: r.costing, avoidTolls: r.avoidTolls, traffic: r.traffic };
        const options = (r.routes ?? [r]).map((rt, index) => ({ ...meta, ...rt, index }));
        setRoute(options[0]);
        setRouteOptions(navigating ? [] : options);
        if (r.snappedToRoad && !navigating) {
          showToast('Seçilen noktaya araçla tam ulaşılamıyor; en yakın, araçla gidilebilen yola rota çizildi.');
        }
        if (!navigating) {
          setCentered(false); // harita rotanın tamamını gösteriyor; "Ortala" ile konuma dönülür
          mapRef.current?.fitToCoordinates(options.flatMap((o) => o.coordinates.map(toLatLng)), {
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
    [api, destination, origin, location, navigating, settings.costing, settings.avoidTolls, showToast],
  );

  // Ulaşım türü ya da "ücretli yollardan kaçın" değişince mevcut rota yenilenir.
  useEffect(() => {
    if (route && (route.costing !== settings.costing || Boolean(route.avoidTolls) !== settings.avoidTolls)) {
      requestRoute({ quiet: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.costing, settings.avoidTolls]);

  // --- Kapalı yollar: periyodik kontrol; değişince rota yeniden hesaplanır ---
  const latest = useRef({});
  latest.current = { route, requestRoute };
  const reroutedForVersion = useRef(null);
  const syncClosures = useRef(null); // yönetici işlemlerinden sonra beklemeden yenilemek için
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
    syncClosures.current = tick;
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
    voice: settings.voice !== false,
    onOffRoute: () => {
      showToast('Rotadan çıkıldı, yeniden hesaplanıyor…');
      requestRoute({ quiet: true });
    },
    onArrive: () => {
      setNavigating(false);
      showToast('Hedefinize vardınız.');
    },
  });

  // --- Takip kamerası ve yön oku (Google Haritalar'daki gibi) ---
  // Seyirde konum yola oturtulmuş bir okla gösterilir; harita gidiş yönüne döner ve
  // oku arkadan, hafif eğik açıyla takip eder. Kullanıcı haritayı kaydırınca takip
  // durur; "Ortala" takibi geri açar.
  //
  // Yön telefonun GPS yönünden alınmıyor: o değer yavaşken çoğunlukla boş (0 = kuzey)
  // geliyor ve harita yan dönüyordu. Rotadayken rotanın hemen önündeki kısmının yönü,
  // rotadan çıkınca son iki konum arasındaki hareket yönü kullanılır.
  const lastBearing = useRef(0);
  const lastFix = useRef(null);
  const onRoute = Boolean(navigating && progress && progress.snap.distance < 30);
  const puck = navigating && gpsUsable ? (onRoute ? progress.snap.point : [location.lat, location.lon]) : null;

  let bearing = lastBearing.current;
  if (navigating && gpsUsable) {
    if (onRoute) {
      bearing = bearingDegrees(progress.snap.point, pointAhead(route.coordinates, progress.snap, 25));
    } else if (lastFix.current && distanceMeters(lastFix.current, [location.lat, location.lon]) > 8) {
      bearing = bearingDegrees(lastFix.current, [location.lat, location.lon]);
    }
  }

  useEffect(() => {
    if (!navigating || !gpsUsable) {
      lastFix.current = null;
      return;
    }
    lastBearing.current = bearing;
    const here = [location.lat, location.lon];
    if (!lastFix.current || distanceMeters(lastFix.current, here) > 8) lastFix.current = here;
    if (!centered) return;
    // Hız arttıkça biraz uzaklaş; ok ekranın alt kısmında kalsın diye merkez biraz ileride.
    const speed = location.speed > 0 ? location.speed : 0;
    const zoom = speed > 17 ? 16.6 : speed > 8 ? 17.3 : 17.9;
    const [lat, lon] = offsetPoint(puck, bearing, speed > 17 ? 110 : 55);
    mapRef.current?.animateCamera(
      { center: { latitude: lat, longitude: lon }, heading: bearing, pitch: 55, zoom },
      { duration: 900 },
    );
    // bearing ve puck konumdan türetiliyor; konum değişimi yeterli tetikleyici.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating, centered, gpsUsable, location, route]);

  // Resim içinde resim: seyir sürerken ana ekrana dönülünce (Android 12+) uygulama
  // küçük pencerede devam eder; küçük pencerede yalnızca harita ve yön bandı görünür.
  const inPip = usePipMode();
  useEffect(() => {
    setAutoPip(navigating);
  }, [navigating]);
  useEffect(() => {
    if (inPip) setCentered(true); // küçük pencerede harita hep konumu takip etsin
  }, [inPip]);

  const stopFollowingOnGesture = () => {
    if (centered) setCentered(false);
  };

  const recenter = () => {
    if (navigating) setCentered(true); // takip kamerası hemen konuma döner
    else goToMyLocation();
  };

  const startNavigation = () => {
    if (!gpsUsable) {
      showToast('Seyir için İstanbul içinde GPS konumu gerekli. Rota önizlemesi kullanılabilir.', 'error');
      return;
    }
    // Önizlemede seçilen rota (alternatif olsa bile) olduğu gibi kullanılır. Harita takip
    // kamerasıyla yumuşakça konuma yaklaşır; paneller kayarak değişir.
    setCentered(true);
    setNavigating(true);
    setRouteOptions([]);
  };

  const stopNavigation = () => {
    setNavigating(false);
    stopSpeech();
  };

  // "Seyri bitir": harita düzleşip kuzeye döner, sonra rotanın tamamını gösterecek şekilde uzaklaşır.
  const finishNavigation = () => {
    stopNavigation();
    setCentered(false);
    mapRef.current?.animateCamera({ pitch: 0, heading: 0 }, { duration: 450 });
    if (route) {
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(route.coordinates.map(toLatLng), {
          edgePadding: { top: 160, right: 50, bottom: 260, left: 50 },
          animated: true,
        });
      }, 480);
    }
  };

  // "Temizle": alt panel aşağı kayarak kaybolur, ardından harita yumuşakça konuma döner.
  const clearTrip = () => {
    stopNavigation();
    Animated.timing(panelExit, { toValue: 1, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      setRoute(null);
      setRouteOptions([]);
      setDestination(null);
      setQuery('');
      panelExit.setValue(0);
      if (location) {
        mapRef.current?.animateCamera(
          { center: { latitude: location.lat, longitude: location.lon }, zoom: 15, pitch: 0, heading: 0 },
          { duration: 800 },
        );
        setCentered(true);
      }
    });
  };

  // --- Arama ---
  const searchSeq = useRef(0);
  const skipAutoSearch = useRef(false);
  const search = async ({ auto = false } = {}) => {
    const q = query.trim();
    if (q.length < 2) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const { results: r } = await api.search(q);
      if (seq !== searchSeq.current) return;
      setResults(r);
      if (!r.length && !auto) showToast(`"${q}" için İstanbul'da sonuç bulunamadı.`);
    } catch (err) {
      if (seq === searchSeq.current) showToast(err.message, 'error');
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  // Yazarken otomatik öneri (yazmayı bıraktıktan kısa süre sonra).
  useEffect(() => {
    if (skipAutoSearch.current) {
      skipAutoSearch.current = false;
      return;
    }
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => search({ auto: true }), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const chooseDestination = (place) => {
    addRecent(place);
    setResults([]);
    skipAutoSearch.current = true;
    Keyboard.dismiss();
    setQuery(place.name);
    setDestination(place);
    requestRoute({ to: place });
  };

  // --- Harita etkileşimi ---
  const onMapPress = async (e) => {
    if (editing) return editZoneAt(e.nativeEvent.coordinate);
    if (!adminMode) return;
    const { latitude: lat, longitude: lon } = e.nativeEvent.coordinate;
    try {
      const r = await api.toggleClosure({ lat, lon });
      // Önce yenile: rota güncellenirse onun bildirimi bu bildirimin üstüne yazmasın.
      await syncClosures.current?.();
      showToast(`${r.action === 'closed' ? '⛔ Kapatıldı' : '✅ Açıldı'}: ${r.closure.name}`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // --- Kayıtlı gruplar ---
  const adminAction = async (fn, message) => {
    try {
      await fn();
      await syncClosures.current?.();
      if (message) showToast(message);
      return true;
    } catch (err) {
      showToast(err.message, 'error');
      return false;
    }
  };
  const unsavedCount = closures.closures.filter((c) => !c.zoneId).length;

  // Grup düzenleme modu: haritada dokunulan yol gruba eklenir ya da gruptan çıkarılır.
  const editingZone = editing ? closures.zones.find((z) => z.id === editing.id) : null;
  const startEditing = (zone) => {
    setZonesOpen(false);
    setEditing({ id: zone.id, name: zone.name });
    if (zone.segments.length) showZone(zone);
    showToast('Gruba eklemek ya da çıkarmak için yollara dokunun.');
  };
  const editZoneAt = async ({ latitude: lat, longitude: lon }) => {
    try {
      const r = await api.toggleZoneSegment(editing.id, { lat, lon });
      await syncClosures.current?.();
      showToast(r.action === 'added' ? `Gruba eklendi: ${r.segment.name}` : `Gruptan çıkarıldı: ${r.segment.name}`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  const finishEditing = async () => {
    const name = editing.name.trim();
    if (editingZone && name && name !== editingZone.name) {
      await adminAction(() => api.renameZone(editing.id, name));
    }
    setEditing(null);
    setZonesOpen(true);
  };

  const showZone = (zone) => {
    setZonesOpen(false);
    setCentered(false);
    mapRef.current?.fitToCoordinates(zone.segments.flatMap((s) => s.coordinates.map(toLatLng)), {
      edgePadding: { top: 160, right: 60, bottom: 200, left: 60 },
      animated: true,
    });
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

  const toggleVoice = () => {
    const voice = settings.voice === false;
    saveSettings({ ...settings, voice });
    showToast(voice ? 'Sesli yönlendirme açıldı.' : 'Sesli yönlendirme kapatıldı.');
  };

  const toggleAdmin = () => {
    if (adminMode) return setAdminMode(false);
    if (!demo && !settings.adminToken) {
      setSettingsOpen(true);
      return showToast('Önce Ayarlar\'dan yönetici anahtarını girin.');
    }
    onAdminModeChange(true, settings);
  };

  const onAdminModeChange = async (enabled, draft) => {
    if (!enabled) return setAdminMode(false);
    try {
      await apiFor(draft).checkAdmin();
      saveSettings(draft);
      setAdminMode(true);
      showToast('Yönetici modu açık: kapatmak/açmak için bir sokağa dokunun.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const next = progress?.next;
  const showRecents = !navigating && searchFocused && query.trim().length < 3 && results.length === 0 && recents.length > 0;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={ISTANBUL_REGION}
        // Altlık: telefonun kendi haritası (Android'de Google, iOS'ta Apple). OSM'nin ücretsiz
        // karo sunucusu uygulamalardan gelen istekleri engellediği için onu kullanmıyoruz.
        mapType="standard"
        // Seyirde mavi nokta yerine aşağıdaki yön oku gösterilir.
        showsUserLocation={!navigating}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        onPress={onMapPress}
        onLongPress={onMapLongPress}
        onPanDrag={stopFollowingOnGesture}
        onRegionChangeComplete={(_, details) => details?.isGesture && stopFollowingOnGesture()}
      >
        {/* Seçili olmayan alternatifler gri; dokununca seçilir. */}
        {routeOptions
          .filter((o) => o.index !== route?.index)
          .map((o) => (
            <Polyline
              key={`alt:${o.index}`}
              coordinates={o.coordinates.map(toLatLng)}
              strokeColor="#8e9aa8"
              strokeWidth={7}
              zIndex={0}
              tappable
              onPress={() => setRoute(o)}
            />
          ))}
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
        {/* Yöneticiye, şu an trafiğe açık olan kayıtlı grupları kesik çizgiyle göster. */}
        {adminMode &&
          closures.zones
            .filter((z) => !z.active)
            .flatMap((z) => z.segments.map((s) => ({ ...s, key: `${z.id}:${s.id}` })))
            .map((s) => (
              <Polyline
                key={s.key}
                coordinates={s.coordinates.map(toLatLng)}
                strokeColor="#d70015"
                strokeWidth={4}
                lineDashPattern={[6, 8]}
                zIndex={2}
              />
            ))}
        {/* Düzenlenen grubun yolları turuncu. */}
        {editingZone?.segments.map((seg) => (
          <Polyline
            key={`edit:${seg.id}`}
            coordinates={seg.coordinates.map(toLatLng)}
            strokeColor="#f08c00"
            strokeWidth={9}
            zIndex={3}
          />
        ))}
        {manualOrigin && !gpsUsable && (
          <Marker coordinate={toLatLng([manualOrigin.lat, manualOrigin.lon])} pinColor="green" title="Başlangıç" />
        )}
        {destination && <Marker coordinate={toLatLng([destination.lat, destination.lon])} title={destination.name} />}
        {puck && <NavPuck position={puck} bearing={bearing} />}
      </MapView>

      {/* Küçük pencere (PiP): yalnızca kısa yön bandı. */}
      {inPip && navigating && next && (
        <View style={styles.pipBanner} pointerEvents="none">
          <Text style={styles.pipDistance}>{formatDistance(progress.distanceToNext)}</Text>
          <Text style={styles.pipText} numberOfLines={2}>
            {next.instruction}
          </Text>
        </View>
      )}

      {/* Üst kısım: seyirde manevra bandı, değilse arama kutusu */}
      {!inPip && (
        <View style={styles.top} pointerEvents="box-none">
          {editing ? (
            <View style={styles.editCard}>
              <Text style={styles.editLabel}>GRUBU DÜZENLE · {editingZone?.segments.length ?? 0} yol parçası</Text>
              <View style={styles.editRow}>
                <TextInput
                  style={styles.editInput}
                  value={editing.name}
                  onChangeText={(name) => setEditing((e) => ({ ...e, name }))}
                  maxLength={80}
                  placeholder="Grup adı"
                />
                <Pressable style={styles.editDone} onPress={finishEditing}>
                  <Text style={styles.editDoneText}>Bitti</Text>
                </Pressable>
              </View>
              <Text style={styles.editHint}>Yola dokun: gruba ekle · Turuncu yola dokun: gruptan çıkar</Text>
            </View>
          ) : navigating && next ? (
            <SlideIn from={-24} style={styles.banner}>
              <Text style={styles.bannerDistance}>{formatDistance(progress.distanceToNext)}</Text>
              <Text style={styles.bannerText} numberOfLines={2}>
                {next.instruction}
              </Text>
            </SlideIn>
          ) : (
            <>
              <SlideIn from={-12} style={styles.searchRow}>
                <TextInput
                  style={styles.search}
                  value={query}
                  onChangeText={setQuery}
                  onSubmitEditing={() => search()}
                  onFocus={() => setSearchFocused(true)}
                  // Listeye dokunma kaybolmadan önce işlensin diye biraz gecikmeli.
                  onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                  placeholder="Nereye? (ör. Taksim)"
                  returnKeyType="search"
                />
                <Pressable style={[styles.iconButton, styles.searchButton]} onPress={() => search()}>
                  {searching ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchButtonText}>Ara</Text>}
                </Pressable>
              </SlideIn>
              {showRecents && (
                <View style={styles.results}>
                  <View style={styles.recentsHeader}>
                    <Text style={styles.recentsTitle}>Son aramalar</Text>
                    <Pressable onPress={() => storeRecents([])} hitSlop={10}>
                      <Text style={styles.recentsClear}>Temizle</Text>
                    </Pressable>
                  </View>
                  <FlatList
                    keyboardShouldPersistTaps="handled"
                    data={recents}
                    keyExtractor={(item, i) => `${item.lat},${item.lon},${i}`}
                    renderItem={({ item }) => (
                      <Pressable style={[styles.result, styles.recentRow]} onPress={() => chooseDestination(item)}>
                        <ClockIcon />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.resultName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          {!!item.address && (
                            <Text style={styles.resultAddr} numberOfLines={1}>
                              {item.address}
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    )}
                  />
                </View>
              )}
              {locStatus !== 'ok' && !manualOrigin && (
                <View style={styles.notice}>
                  <Text style={styles.noticeText}>
                    {locStatus === 'denied'
                      ? 'Konum izni yok. Telefon ayarlarından izin verin ya da başlangıcı haritada basılı tutarak seçin.'
                      : locStatus === 'off'
                        ? 'Telefonun Konum (GPS) özelliği kapalı. Açın ya da başlangıcı haritada basılı tutarak seçin.'
                        : 'Konumunuz aranıyor…'}
                  </Text>
                </View>
              )}
              {location && !gpsUsable && !manualOrigin && (
                <View style={styles.notice}>
                  <Text style={styles.noticeText}>
                    Konumunuz İstanbul dışında. Denemek için önce başlangıç, sonra varış noktasını haritada basılı tutun.
                  </Text>
                </View>
              )}
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
          {adminMode && navigating && (
            <View style={styles.adminRow}>
              <View style={styles.adminPill}>
                <Text style={styles.adminPillText}>YÖNETİCİ · {closures.closures.length} kapalı parça</Text>
              </View>
              <Pressable style={styles.zonesButton} onPress={() => setZonesOpen(true)}>
                <Text style={styles.zonesButtonText}>
                  Kayıtlı gruplar{closures.zones.length ? ` (${closures.zones.length})` : ''}
                </Text>
              </Pressable>
            </View>
          )}
          {demo && !navigating && (
            <View style={styles.demoPill}>
              <Text style={styles.demoPillText}>Demo modu · kapatmalar yalnızca bu telefonda</Text>
            </View>
          )}
          {toast && (
            <View style={[styles.toast, toast.kind === 'error' && styles.toastError]}>
              <Text style={styles.toastText}>{toast.text}</Text>
            </View>
          )}
        </View>
      )}

      {/* Alt panel: rota özeti ve düğmeler */}
      {!inPip && (route || busy) && (
        <Animated.View
          onLayout={(e) => setBottomPanelHeight(e.nativeEvent.layout.height)}
          style={[
            styles.bottom,
            {
              opacity: panelExit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
              transform: [{ translateY: panelExit.interpolate({ inputRange: [0, 1], outputRange: [0, 320] }) }],
            },
          ]}
        >
          {/* Başla / Seyri bitir'de panel yeniden kurulur ve kayarak gelir. */}
          <SlideIn key={navigating ? 'nav' : 'preview'} from={40}>
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
                {route.traffic && route.traffic.key !== 'night' && (
                  <Text style={styles.trafficNote}>
                    {route.traffic.label} tahmini dahil · boş yolda {formatDuration(route.freeFlowDurationSec)}
                  </Text>
                )}
                {route.hasToll && (
                  <Text style={styles.tollNote}>
                    {settings.avoidTolls
                      ? 'Ücretsiz yol bulunamadı; bu rota ücretli yol (köprü, tünel ya da otoyol) içeriyor.'
                      : 'Bu rota ücretli yol (köprü, tünel ya da otoyol) içeriyor.'}
                  </Text>
                )}
                {!navigating && (
                  <View style={styles.tollRow}>
                    <Text style={styles.tollLabel}>Ücretli yollardan kaçın</Text>
                    <Switch
                      value={settings.avoidTolls}
                      onValueChange={(avoidTolls) => saveSettings({ ...settings, avoidTolls })}
                    />
                  </View>
                )}
                {!navigating && routeOptions.length > 1 && (
                  <View style={styles.options}>
                    {routeOptions.map((o) => {
                      const selected = o.index === route.index;
                      return (
                        <Pressable key={o.index} style={[styles.option, selected && styles.optionSelected]} onPress={() => setRoute(o)}>
                          <Text style={[styles.optionTime, selected && styles.optionTimeSelected]}>{formatDuration(o.durationSec)}</Text>
                          <Text style={styles.optionSub}>
                            {formatDistance(o.distanceKm * 1000)}
                            {o.index === 0 ? ' · En hızlı' : ''}
                            {o.hasToll ? ' · Ücretli' : ''}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                <View style={styles.actions}>
                  {navigating ? (
                    <Pressable style={[styles.button, styles.stop]} onPress={finishNavigation}>
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
          </SlideIn>
        </Animated.View>
      )}

      {navigating && <KeepScreenOn />}

      {/* Sağ kenardaki düğme paneli (arama sonuçları açıkken gizlenir). */}
      {!inPip && results.length === 0 && !showRecents && !editing && (
        <View style={[styles.sidePanel, { top: navigating ? 170 : 150 }]}>
          <SideButton label="Ayarlar" onPress={() => setSettingsOpen(true)}>
            <Text style={styles.sideGlyph}>⚙︎</Text>
          </SideButton>
          <SideButton label={adminMode ? 'Kapatma\nAÇIK' : 'Yol\nkapat'} active={adminMode} onPress={toggleAdmin}>
            <View style={[styles.noEntry, adminMode && styles.noEntryOn]}>
              <View style={[styles.noEntryBar, adminMode && styles.noEntryBarOn]} />
            </View>
          </SideButton>
          {adminMode && (
            <SideButton label={`Gruplar${closures.zones.length ? ` (${closures.zones.length})` : ''}`} onPress={() => setZonesOpen(true)}>
              <Text style={styles.sideGlyph}>☰</Text>
            </SideButton>
          )}
          <SideButton
            label={settings.voice === false ? 'Ses\nkapalı' : 'Ses\naçık'}
            active={settings.voice === false}
            onPress={toggleVoice}
            last={!(navigating && pipSupported)}
          >
            <Text style={styles.sideGlyph}>{settings.voice === false ? '🔇' : '🔊'}</Text>
          </SideButton>
          {navigating && pipSupported && (
            <SideButton label="Küçült" onPress={enterPip} last>
              <View style={styles.pipIcon}>
                <View style={styles.pipIconInner} />
              </View>
            </SideButton>
          )}
        </View>
      )}

      {/* "Ortala": harita konumda değilken (rota gösterilince ya da kaydırınca) çıkar, basınca gider. */}
      {!inPip && !editing && !centered && location && (
        <Pressable
          style={({ pressed }) => [
            styles.recenter,
            { bottom: route || busy ? bottomPanelHeight + 34 + 12 : 40 },
            pressed && styles.recenterPressed,
          ]}
          onPress={recenter}
        >
          <RecenterIcon />
          <Text style={styles.recenterText}>Ortala</Text>
        </Pressable>
      )}

      {!inPip && <Text style={styles.attribution}>© OpenStreetMap katkıcıları</Text>}

      <ZonesSheet
        visible={zonesOpen}
        zones={closures.zones}
        unsavedCount={unsavedCount}
        closedCount={closures.closures.length}
        onOpenAll={() =>
          adminAction(async () => {
            const r = await api.openAll();
            if (!r.removed && !r.zonesOpened) throw new Error('Zaten kapalı yol yok.');
          }, 'Tüm yollar trafiğe açıldı.')
        }
        onClose={() => setZonesOpen(false)}
        onShow={showZone}
        onSave={(name) => adminAction(() => api.saveZone(name), `"${name}" kaydedildi ve trafiğe kapatıldı.`)}
        onToggle={(z) =>
          adminAction(() => api.setZoneActive(z.id, !z.active), `"${z.name}" ${z.active ? 'trafiğe açıldı' : 'trafiğe kapatıldı'}.`)
        }
        onDelete={(z) => adminAction(() => api.deleteZone(z.id), `"${z.name}" silindi.`)}
        onEdit={startEditing}
      />

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

// Sağ paneldeki tek bir düğme: üstte simge, altta kısa etiket.
function SideButton({ label, onPress, active, highlight, last, children }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.sideButton, !last && styles.sideDivider, active && styles.sideActive, pressed && styles.sidePressed]}
    >
      {children}
      <Text style={[styles.sideLabel, active && styles.sideLabelActive, highlight && styles.sideLabelHighlight]}>{label}</Text>
    </Pressable>
  );
}

// Görünüm ilk kez çizildiğinde kısa bir kayma + solma ile gelir (yön bandı, paneller).
function SlideIn({ from = 24, duration = 260, style, children, ...rest }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [anim, duration]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [from, 0] });
  return (
    <Animated.View style={[style, { opacity: anim, transform: [{ translateY }] }]} {...rest}>
      {children}
    </Animated.View>
  );
}

// Son aramalar listesindeki küçük saat simgesi.
function ClockIcon() {
  return (
    <View style={styles.clock}>
      <View style={styles.clockHandUp} />
      <View style={styles.clockHandRight} />
    </View>
  );
}

// "Ortala" simgesi: gri halka, dört yönde kırmızı nişan çizgileri, ortada mavi konum noktası.
function RecenterIcon() {
  return (
    <View style={styles.recenterIcon}>
      <View style={styles.recenterRing} />
      <View style={[styles.recenterTick, styles.tickTop]} />
      <View style={[styles.recenterTick, styles.tickBottom]} />
      <View style={[styles.recenterTick, styles.tickSide, styles.tickLeft]} />
      <View style={[styles.recenterTick, styles.tickSide, styles.tickRight]} />
      <View style={styles.recenterDot} />
    </View>
  );
}

// Seyirdeki yön oku. Harita düzlemine yatık (flat) olduğu için harita döndükçe
// birlikte döner; kamera gidiş yönüne baktığında ok hep yukarıyı gösterir.
function NavPuck({ position, bearing }) {
  // Android özel işaretçiyi bir kez resme çevirir; ilk çizimde görünüm hazır olmayabilir,
  // bu yüzden kısa süre güncellemeye izin verip sonra (performans için) kapatıyoruz.
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracks(false), 600);
    return () => clearTimeout(t);
  }, []);
  return (
    <Marker
      coordinate={toLatLng(position)}
      anchor={{ x: 0.5, y: 0.5 }}
      flat
      rotation={bearing}
      tracksViewChanges={tracks}
      zIndex={10}
    >
      <View style={styles.navPuck}>
        <View style={styles.navArrowWrap}>
          <View style={styles.navArrow} />
          <View style={styles.navArrowNotch} />
        </View>
      </View>
    </Marker>
  );
}

// Seyir sürerken ekranın kendiliğinden kapanmasını engeller.
function KeepScreenOn() {
  useKeepAwake('navigation');
  return null;
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
  results: { backgroundColor: '#fff', borderRadius: 12, maxHeight: 320, ...shadow },
  result: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#d1d1d6' },
  resultName: { fontSize: 16, fontWeight: '600' },
  resultAddr: { fontSize: 12, color: '#6e6e73', marginTop: 2 },
  banner: { backgroundColor: '#0b5c3b', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, ...shadow },
  bannerDistance: { color: '#fff', fontSize: 22, fontWeight: '800' },
  bannerText: { color: '#fff', fontSize: 15, marginTop: 2 },
  adminRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  adminPill: { backgroundColor: '#d70015', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  zonesButton: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, ...shadow },
  zonesButtonText: { color: '#1d1d1f', fontWeight: '700', fontSize: 12 },
  adminPillText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  demoPill: { alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  demoPillText: { color: '#6e6e73', fontSize: 11 },
  toast: { alignSelf: 'flex-start', marginRight: 76, backgroundColor: 'rgba(29,29,31,0.92)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '100%' },
  toastError: { backgroundColor: 'rgba(215,0,21,0.95)' },
  toastText: { color: '#fff', fontSize: 14 },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 34, backgroundColor: '#fff', borderRadius: 16, padding: 16, ...shadow },
  summaryRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  summaryMain: { fontSize: 26, fontWeight: '800', color: '#0b8a3e' },
  summarySub: { fontSize: 16, color: '#3a3a3c' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  tollNote: { fontSize: 12, color: '#6e6e73', marginTop: 4 },
  tollRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  tollLabel: { fontSize: 14, fontWeight: '600', color: '#1d1d1f' },
  trafficNote: { fontSize: 12, color: '#b35f00', marginTop: 4 },
  options: { flexDirection: 'row', gap: 8, marginTop: 10 },
  option: { flex: 1, borderWidth: 1.5, borderColor: '#d1d1d6', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  optionSelected: { borderColor: '#0a66d8', backgroundColor: '#eef4fd' },
  optionTime: { fontSize: 16, fontWeight: '800', color: '#3a3a3c' },
  optionTimeSelected: { color: '#0a66d8' },
  optionSub: { fontSize: 11, color: '#6e6e73', marginTop: 1 },
  button: { flex: 1, backgroundColor: '#0a66d8', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  secondary: { backgroundColor: '#f2f2f7' },
  secondaryText: { color: '#1d1d1f', fontSize: 17, fontWeight: '600' },
  stop: { backgroundColor: '#d70015' },
  searchButton: { width: 56, backgroundColor: '#0a66d8' },
  searchButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  notice: { backgroundColor: '#fff8e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginRight: 76, ...shadow },
  noticeText: { fontSize: 13, color: '#5c4400' },
  editCard: { backgroundColor: '#fff', borderRadius: 14, padding: 12, gap: 8, borderWidth: 2, borderColor: '#f08c00', ...shadow },
  editLabel: { fontSize: 11, fontWeight: '800', color: '#b35f00', letterSpacing: 0.5 },
  editRow: { flexDirection: 'row', gap: 8 },
  editInput: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16 },
  editDone: { backgroundColor: '#f08c00', borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  editDoneText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  editHint: { fontSize: 12, color: '#6e6e73' },
  pipBanner: { position: 'absolute', top: 6, left: 6, right: 6, backgroundColor: '#0b5c3b', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5 },
  pipDistance: { color: '#fff', fontSize: 15, fontWeight: '800' },
  pipText: { color: '#fff', fontSize: 11 },
  pipIcon: { width: 24, height: 18, borderRadius: 3, borderWidth: 2, borderColor: '#1d1d1f', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 2 },
  pipIconInner: { width: 10, height: 7, borderRadius: 1, backgroundColor: '#1d1d1f' },
  sidePanel: { position: 'absolute', right: 12, width: 64, backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', ...shadow },
  sideButton: { alignItems: 'center', justifyContent: 'center', paddingVertical: 9, gap: 4, minHeight: 60 },
  sideDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#d1d1d6' },
  sideActive: { backgroundColor: '#fde7e9' },
  sidePressed: { backgroundColor: '#f2f2f7' },
  sideGlyph: { fontSize: 20, color: '#1d1d1f', lineHeight: 24 },
  sideLabel: { fontSize: 10, fontWeight: '600', color: '#3a3a3c', textAlign: 'center' },
  sideLabelActive: { color: '#d70015', fontWeight: '800' },
  sideLabelHighlight: { color: '#0a66d8', fontWeight: '800' },
  noEntry: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#d70015', alignItems: 'center', justifyContent: 'center' },
  noEntryOn: { backgroundColor: '#d70015' },
  noEntryBar: { width: 12, height: 3, borderRadius: 1, backgroundColor: '#d70015' },
  noEntryBarOn: { backgroundColor: '#fff' },
  navPuck: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cfd8e3', ...shadow },
  // Mavi üçgenin tabanına beyaz küçük bir üçgen bindirilerek çentikli ok (chevron) elde edilir.
  navArrowWrap: { width: 24, height: 26, marginBottom: 3 },
  navArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 26,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#0a66d8',
  },
  navArrowNotch: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#fff',
  },
  recentsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  recentsTitle: { fontSize: 12, fontWeight: '700', color: '#6e6e73', letterSpacing: 0.4 },
  recentsClear: { fontSize: 13, fontWeight: '600', color: '#0a66d8' },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  clock: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#8e9aa8' },
  clockHandUp: { position: 'absolute', left: 6, top: 2, width: 2, height: 6, backgroundColor: '#8e9aa8', borderRadius: 1 },
  clockHandRight: { position: 'absolute', left: 6, top: 6, width: 5, height: 2, backgroundColor: '#8e9aa8', borderRadius: 1 },
  recenter: {
    position: 'absolute',
    left: 14,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 10,
    paddingRight: 18,
    backgroundColor: '#fff',
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: '#c7ced6',
    ...shadow,
  },
  recenterPressed: { backgroundColor: '#eef4fd' },
  recenterText: { fontSize: 16, fontWeight: '800', color: '#0a66d8' },
  recenterIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  recenterRing: { position: 'absolute', width: 26, height: 26, borderRadius: 13, borderWidth: 2.5, borderColor: '#8e9aa8' },
  recenterTick: { position: 'absolute', width: 3, height: 7, borderRadius: 1.5, backgroundColor: '#d70015' },
  tickTop: { top: 0 },
  tickBottom: { bottom: 0 },
  tickSide: { width: 7, height: 3 },
  tickLeft: { left: 0 },
  tickRight: { right: 0 },
  recenterDot: { width: 13, height: 13, borderRadius: 6.5, backgroundColor: '#0a66d8', borderWidth: 2, borderColor: '#fff' },
  attribution: { position: 'absolute', right: 6, bottom: 6, fontSize: 10, color: '#3a3a3c', backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 4 },
});
