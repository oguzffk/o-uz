import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Image,
  Keyboard,
  PanResponder,
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
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createApi, defaultApiUrl } from './src/api';
import { DEMO_OWNER, MAX_STOPS, PUBLIC_VALHALLA_URL, createDemoApi } from './src/demoApi';
import { ChangePasswordScreen, LOGO, LoginScreen } from './src/AuthScreens';
import PurchaseScreen from './src/PurchaseScreen';
import MembersSheet from './src/MembersSheet';
import { clearSession, formatRemaining, loadSession, saveSession } from './src/session';
import {
  ISTANBUL_REGION,
  bearingDegrees,
  cumulativeDistances,
  distanceAlong,
  distanceMeters,
  formatArrival,
  formatDistance,
  formatDuration,
  inIstanbul,
  offsetPoint,
  pointAhead,
  pointAtDistance,
  routeLegs,
  snapDistance,
  speedLimitAt,
  toLatLng,
} from './src/geo';
import { stopSpeech, useNavigation } from './src/useNavigation';
import SettingsSheet from './src/SettingsSheet';
import { LaneStrip, ManeuverIcon } from './src/TurnIcons';
import { enterPip, pipSupported, setAutoPip, usePipMode } from './src/pip';
import ZonesSheet from './src/ZonesSheet';

const SETTINGS_KEY = 'nav-settings-v1';
const RECENTS_KEY = 'recent-places-v1';
const MAX_RECENTS = 8;
const CLOSURE_POLL_MS = 5000;

// Demo modu kendi sunucumuz olmadan herkese açık Valhalla'yı kullanır (bkz. src/demoApi.js).
// Oturum hangi sunucuya aitse onu belirten anahtar (sunucu değişince oturum geçersiz).
const backendKey = (s) => (s.backend === 'demo' ? 'demo' : `server:${s.apiUrl}`);
const apiFor = (s, token) => (s.backend === 'demo' ? createDemoApi(PUBLIC_VALHALLA_URL, token) : createApi(s.apiUrl, token));

export default function App() {
  return (
    <SafeAreaProvider>
      <AppScreen />
    </SafeAreaProvider>
  );
}

function AppScreen() {
  // Alt kenardaki geri / ana ekran tuş çubuğunun yüksekliği; düğmeler bunun altında kalmasın.
  const insets = useSafeAreaInsets();
  const panelBottom = Math.max(34, insets.bottom + 16);
  const mapRef = useRef(null);
  const [settings, setSettings] = useState({
    backend: process.env.EXPO_PUBLIC_API_URL ? 'server' : 'demo',
    apiUrl: defaultApiUrl(),
    costing: 'auto',
    avoidTolls: false,
    voice: true,
    night: false,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // Oturum: { token, user, settings } — user.role: 'owner' (sahip) | 'admin' (yönetici) | 'member' (üye).
  const [session, setSession] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false); // süre bitmeden paket almak için
  const [now, setNow] = useState(Date.now()); // kalan süre göstergesi için
  const [adminMode, setAdminMode] = useState(false);

  const [location, setLocation] = useState(null); // { lat, lon, heading }
  // Harita şu an kullanıcının konumunda mı? Seyirde bu "takip ediliyor" demek. Kullanıcı
  // haritayı kaydırınca ya da rota gösterilince false olur ve "Ortala" düğmesi çıkar.
  const [centered, setCentered] = useState(true);
  // Nereden: null = Konumum (GPS); başka bir yer seçilirse { lat, lon, name, address }.
  const [fromPlace, setFromPlace] = useState(null);
  const [fromText, setFromText] = useState('');
  const [activeField, setActiveField] = useState('to'); // arama hangi kutu için: 'from' | 'stop' | 'to'
  // Kutudan çıkınca yazıyı geri yüklerken en güncel seçimi görmek için (blur, seçimden önce gelebilir).
  const fromPlaceRef = useRef(null);
  const selectFrom = (place) => {
    fromPlaceRef.current = place;
    setFromPlace(place);
    setFromText(place ? place.name : '');
  };
  const [destination, setDestination] = useState(null); // { lat, lon, name }
  // Ara duraklar (sırayla uğranır), en fazla MAX_STOPS. addingStop: "Durak ekle" kutusu açık mı.
  const [stops, setStops] = useState([]);
  const [stopText, setStopText] = useState('');
  const [addingStop, setAddingStop] = useState(false);
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
  // Arama kartının alt kenarı (üst alana göre); duraklar eklendikçe kart uzar, sağ panel altına iner.
  const [searchCardBottom, setSearchCardBottom] = useState(0);
  // Varış saati "şimdi"ye bağlı: rota ekrandayken dakikada bir yenilensin (seyirde konum zaten yeniler).
  const [, setClockTick] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  // Kutuya dokunduktan sonra bir şey yazıldı mı? Yazılmadıysa öneri listesi (Konumum, son aramalar) gösterilir.
  const [typed, setTyped] = useState(false);
  const [recents, setRecents] = useState([]); // son seçilen yerler (cihazda saklanır)
  // Temizle'de alt panel aşağı kayarak kaybolsun diye: 0 = yerinde, 1 = ekran dışında.
  const panelExit = useRef(new Animated.Value(0)).current;

  const token = session?.token ?? null;
  const api = useMemo(() => apiFor(settings, token), [settings, token]);
  const user = session?.user ?? null;
  const isStaff = user?.role === 'owner' || user?.role === 'admin'; // yol kapatma ve gruplar
  const isOwner = user?.role === 'owner'; // üyeler, süreler, yöneticiler
  const isMember = user?.role === 'member';
  const remainingMs = isMember && user.expiresAt != null ? user.expiresAt - now : 0;
  const expired = isMember && remainingMs <= 0;
  // API hatası oturumla ilgiliyse (oturum kapandı, süre doldu) burada ele alınır; true dönerse bildirim gösterilmez.
  const onApiError = useRef(() => false);
  const night = Boolean(settings.night);
  const styles = night ? nightStyles : baseStyles;
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
        delete saved.adminToken; // eski sürümden kalan ortak yönetici anahtarı artık kullanılmıyor
        setSettings((s) => ({ ...s, ...saved }));
      })
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
  }, []);

  // --- Oturum ---
  // Kayıtlı oturum aynı sunucuya aitse doğrulanır; geçersizse giriş ekranı açılır.
  useEffect(() => {
    if (!settingsLoaded) return;
    let cancelled = false;
    (async () => {
      const stored = await loadSession();
      if (stored?.token && stored.backend === backendKey(settings)) {
        try {
          const me = await apiFor(settings, stored.token).me();
          if (!cancelled) setSession({ token: stored.token, ...me });
        } catch (err) {
          if (err.status === 401) await clearSession();
          // Sunucuya ulaşılamadıysa oturum korunur ama ekrana giriş istenir; bir sonraki açılışta tekrar denenir.
        }
      }
      if (!cancelled) setSessionReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // yalnızca ilk açılışta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);

  const startSession = async (r) => {
    await saveSession({ token: r.token, backend: backendKey(settings) });
    setNow(Date.now());
    setSession({ token: r.token, user: r.user });
  };
  // Yedek giriş (sahip/yönetici): telefon + şifre.
  const login = async (loginId, password) => startSession(await apiFor(settings, null).login(loginId, password));
  const register = (form) => apiFor(settings, null).register(form);
  const verifyRegistration = async (email, code) => startSession(await apiFor(settings, null).verifyRegistration(email, code));
  const resetPassword = async (email, code, pw) => startSession(await apiFor(settings, null).resetPasswordWithCode(email, code, pw));
  // Asıl giriş: e-postaya gelen kod.
  const requestEmailCode = (email, purpose) => apiFor(settings, null).requestEmailCode(email, purpose);
  const emailLogin = async (email, code) => startSession(await apiFor(settings, null).emailLogin(email, code));

  const refreshMe = useCallback(async () => {
    if (!token) return;
    try {
      const me = await api.me();
      setNow(Date.now());
      setSession((s) => (s && s.token === token ? { ...s, ...me } : s));
    } catch (err) {
      onApiError.current(err);
    }
  }, [api, token]);

  // Süre, rol ve oturum her dakika sunucudan tazelenir (sahip süre ekleyince ya da hesap başka
  // telefonda açılınca hemen yansısın).
  useEffect(() => {
    if (!token) return undefined;
    const id = setInterval(() => {
      setNow(Date.now());
      refreshMe();
    }, 60000);
    return () => clearInterval(id);
  }, [token, refreshMe]);


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
    // Sunucu değişince oturum o sunucuya ait olmadığından çıkış yapılır.
    if (session && backendKey(next) !== backendKey(settings)) logout();
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
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
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

  // Başlangıç: seçilmiş bir yer varsa o, yoksa GPS konumu (İstanbul içindeyse).
  const gpsUsable = location && inIstanbul(location);
  const origin = fromPlace ?? (gpsUsable ? location : null);
  // Seyir GPS ile takip edildiği için yalnızca konumdan başlayan rotalarda mümkün.
  const canNavigate = !fromPlace && gpsUsable;

  // --- Rota ---
  const routeRequest = useRef(0);
  // Seyirde aracın gerçekten gittiği yön (derece): rotanın bulunulan noktadaki yönü ya da son
  // hareket yönü. Bilinmiyorsa null. Yeniden rota bu yönden başlar (aşağıda).
  const travelHeading = useRef(null);
  const requestRoute = useCallback(
    async ({ to = destination, from = origin, via, quiet = false } = {}) => {
      if (!to) return;
      if (!via) {
        via = stops;
        // Seyirde yeniden rota: geçilen duraklar atılır (rota durakları istek sırasıyla döndürür).
        const { route: current, progress: p } = navRef.current;
        if (navigating && p && current?.stops?.length === stops.length) {
          via = stops.filter((_, i) => current.stops[i].shapeIndex > p.snap.index);
          if (via.length !== stops.length) setStops(via);
        }
      }
      if (!from) {
        showToast('Önce başlangıç seçin: "Nereden" kutusundan arayın ya da haritada basılı tutun.');
        return;
      }
      const reqId = ++routeRequest.current;
      setBusy(true);
      try {
        // Yeniden rotada araç gittiği yönden devam etsin. Telefonun pusulası duran araçta 0 (kuzey)
        // döndüğü için ona yalnızca hareket halindeyken ve gidiş yönü bilinmiyorsa güvenilir;
        // yoksa güneye giderken durup önündeki yolu kapatınca rota geri (kuzeye) döndürüyordu.
        const heading =
          navigating && from === location
            ? (travelHeading.current ?? (location.speed > 3 && location.heading >= 0 ? location.heading : undefined))
            : undefined;
        // Seyir sırasında (yeniden rota) tek rota yeter; önizlemede alternatifler de istenir.
        const r = await api.route({
          from,
          to,
          via,
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
        if (reqId === routeRequest.current && !onApiError.current(err)) showToast(err.message, 'error');
      } finally {
        if (reqId === routeRequest.current) setBusy(false);
      }
    },
    [api, destination, stops, origin, location, navigating, settings.costing, settings.avoidTolls, showToast],
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
      } catch (err) {
        // Sunucu geçici olarak erişilemezse sessizce tekrar denenir.
        onApiError.current(err);
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

  useEffect(() => {
    if (!route) return undefined;
    const id = setInterval(() => setClockTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, [route]);

  // --- Seyir ---
  const navRef = useRef({}); // requestRoute'un seyirdeki konumu görebilmesi için (aşağıda doldurulur)
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
      // "Seyri bitir"deki gibi harita düzleşip kuzeye dönsün (sesli "vardınız" kesilmesin diye susturmuyoruz).
      // Aynı karede takip kamerası da çalıştığı için düzleştirme bir sonraki ana erteleniyor.
      setTimeout(() => mapRef.current?.animateCamera({ pitch: 0, heading: 0 }, { duration: 600 }), 50);
      showToast('Hedefinize vardınız.');
    },
  });

  navRef.current = { route, progress };

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
  let bearingKnown = false; // bu konumda gidiş yönü gerçekten biliniyor mu
  if (navigating && gpsUsable) {
    if (onRoute) {
      bearing = bearingDegrees(progress.snap.point, pointAhead(route.coordinates, progress.snap, 25));
      bearingKnown = true;
    } else if (lastFix.current && distanceMeters(lastFix.current, [location.lat, location.lon]) > 8) {
      bearing = bearingDegrees(lastFix.current, [location.lat, location.lon]);
      bearingKnown = true;
    }
  }

  useEffect(() => {
    if (!navigating || !gpsUsable) {
      lastFix.current = null;
      travelHeading.current = null;
      return;
    }
    lastBearing.current = bearing;
    if (bearingKnown) travelHeading.current = Math.round(bearing);
    const here = [location.lat, location.lon];
    if (!lastFix.current || distanceMeters(lastFix.current, here) > 8) lastFix.current = here;
    // bearing konumdan türetiliyor; konum değişimi yeterli tetikleyici.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating, gpsUsable, location]);

  // Takip başlarken (seyir başı, "Ortala") kamera konuma yumuşakça kayar; sonrasını
  // NavFollower her karede kendisi sürer.
  const followStartedAt = useRef(0);
  useEffect(() => {
    if (!navigating || !centered || !puck) return;
    followStartedAt.current = Date.now();
    const [lat, lon] = offsetPoint(puck, bearing, followOffset(location.speed));
    mapRef.current?.animateCamera(
      { center: { latitude: lat, longitude: lon }, heading: bearing, pitch: 55, zoom: followZoom(location.speed) },
      { duration: 600 },
    );
    // yalnızca takip açıldığında
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating, centered, Boolean(puck)]);

  // Rota başından mesafeler: oku ve kalan çizgiyi rota boyunca kaydırmak için.
  const routeCum = useMemo(() => (route ? cumulativeDistances(route.coordinates) : null), [route]);
  const travelled = navigating && progress && routeCum ? snapDistance(route.coordinates, routeCum, progress.snap) : null;

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
    if (fromPlace) {
      showToast('Seyir yalnızca konumunuzdan başlar. "Nereden"i Konumum yapın.', 'error');
      return;
    }
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
      selectFrom(null);
      setStops([]);
      closeStopField();
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
  const activeText = activeField === 'from' ? fromText : activeField === 'stop' ? stopText : query;
  const search = async ({ auto = false } = {}) => {
    const q = activeText.trim();
    if (q.length < 2) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const { results: r } = await api.search(q);
      if (seq !== searchSeq.current) return;
      setResults(r);
      if (!r.length && !auto) showToast(`"${q}" için İstanbul'da sonuç bulunamadı.`);
    } catch (err) {
      if (seq === searchSeq.current && !onApiError.current(err)) showToast(err.message, 'error');
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
    // Yalnızca kullanıcı yazınca ara; kutuya dokunmak ya da kutu değiştirmek arama başlatmasın.
    if (!typed || activeText.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => search({ auto: true }), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeText]);

  // Listeden seçilen yer, o an hangi kutu düzenleniyorsa ona yazılır.
  const choosePlace = (place) => {
    setResults([]);
    skipAutoSearch.current = true;
    Keyboard.dismiss();
    if (activeField === 'from') {
      if (place.myLocation) return chooseMyLocationAsStart();
      addRecent(place);
      selectFrom(place);
      if (destination) requestRoute({ from: place });
      return;
    }
    if (activeField === 'stop') {
      if (place.myLocation) return;
      addRecent(place);
      addStop(place);
      return;
    }
    addRecent(place);
    setQuery(place.name);
    setDestination(place);
    requestRoute({ to: place });
  };

  const addStop = (place) => {
    const next = [...stops, place].slice(0, MAX_STOPS);
    setStops(next);
    closeStopField();
    if (destination) requestRoute({ via: next });
  };
  // Sürükleyerek sıralama: `from` sıradaki durak `to` sırasına taşınır.
  const moveStop = (from, to) => {
    const next = [...stops];
    next.splice(to, 0, ...next.splice(from, 1));
    setStops(next);
    if (destination) requestRoute({ via: next });
  };
  const removeStop = (index) => {
    const next = stops.filter((_, i) => i !== index);
    setStops(next);
    if (destination) requestRoute({ via: next });
  };
  const openStopField = () => {
    setAddingStop(true);
    setStopText('');
    setActiveField('stop');
    setTyped(false);
    setResults([]);
  };
  const closeStopField = () => {
    setAddingStop(false);
    setStopText('');
    setActiveField((f) => (f === 'stop' ? 'to' : f));
  };

  const chooseMyLocationAsStart = () => {
    if (!gpsUsable) {
      showToast('Konumunuz bulunamadı ya da İstanbul dışında; başlangıç olarak bir yer seçin.', 'error');
      return;
    }
    selectFrom(null);
    if (destination) requestRoute({ from: location });
  };

  // ⇅: başlangıç ve varışı yer değiştirir ("Konumum" da taşınabilir).
  const swapPlaces = () => {
    const myLocation = gpsUsable ? { lat: location.lat, lon: location.lon, name: 'Konumum', myLocation: true } : null;
    const newFrom = destination;
    const newTo = fromPlace ?? myLocation;
    if (!newTo) {
      showToast('Yer değiştirmek için önce başlangıç noktası gerekli.', 'error');
      return;
    }
    const startIsMe = !newFrom || newFrom.myLocation;
    selectFrom(startIsMe ? null : newFrom);
    skipAutoSearch.current = true;
    setQuery(newTo.name);
    setDestination(newTo);
    const from = startIsMe ? (gpsUsable ? location : null) : newFrom;
    const via = [...stops].reverse(); // duraklar ters sırayla uğranır
    setStops(via);
    if (from) requestRoute({ from, to: newTo, via });
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
      if (!onApiError.current(err)) showToast(err.message, 'error');
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
    if (!origin) {
      selectFrom({ lat, lon, name: 'Haritada seçilen başlangıç' });
      showToast('Başlangıç seçildi. Şimdi varış noktasını basılı tutun.');
      return;
    }
    if (addingStop) {
      setResults([]);
      addStop({ lat, lon, name: 'Haritada seçilen durak' });
      return;
    }
    const place = { lat, lon, name: 'Haritada seçilen nokta' };
    skipAutoSearch.current = true; // kutuya yazılan ad arama başlatmasın
    setResults([]);
    setDestination(place);
    setQuery(place.name);
    requestRoute({ to: place });
  };

  const toggleNight = () => {
    const night = !settings.night;
    saveSettings({ ...settings, night });
    showToast(night ? 'Gece modu açıldı.' : 'Gece modu kapatıldı.');
  };

  const toggleVoice = () => {
    const voice = settings.voice === false;
    saveSettings({ ...settings, voice });
    showToast(voice ? 'Sesli yönlendirme açıldı.' : 'Sesli yönlendirme kapatıldı.');
  };

  const toggleAdmin = () => {
    if (!isStaff) return;
    if (adminMode) return setAdminMode(false);
    setAdminMode(true);
    showToast('Yol kapatma açık: kapatmak/açmak için bir sokağa dokunun.');
  };

  // Çıkış: oturum sunucuda da kapatılır, yolculuk ve yönetim ekranları sıfırlanır.
  const logout = async () => {
    const current = api;
    setSession(null);
    setAdminMode(false);
    setEditing(null);
    setSettingsOpen(false);
    setMembersOpen(false);
    setPurchaseOpen(false);
    setZonesOpen(false);
    stopNavigation();
    setRoute(null);
    setRouteOptions([]);
    setDestination(null);
    setStops([]);
    setQuery('');
    selectFrom(null);
    await clearSession();
    current.logout().catch(() => {});
  };

  onApiError.current = (err) => {
    if (!session) return false;
    if (err?.status === 401) {
      logout();
      showToast('Oturumunuz kapandı. Hesabınız başka bir telefonda açılmış olabilir.', 'error');
      return true;
    }
    if (err?.code === 'expired') {
      refreshMe();
      return true;
    }
    return false;
  };

  const next = progress?.next;
  // Sıradaki talimat varışsa Valhalla'nın "Hedefinize vardınız." cümlesini erkenden göstermeyelim.
  const nextIsArrival = Boolean(route && next && next === route.maneuvers[route.maneuvers.length - 1]);
  const bannerInstruction = next ? (nextIsArrival ? 'Hedefe varış' : next.instruction) : '';
  // "Ardından": sıradaki dönüşten kısa süre sonra bir manevra daha varsa onu da göster.
  const thenManeuver = next && !nextIsArrival && progress.nextIdx >= 0 ? route.maneuvers[progress.nextIdx + 1] : null;
  const showThen = Boolean(thenManeuver && next.distanceKm * 1000 <= THEN_METERS);
  // Hız sınırı (OSM'de etiketliyse) ve anlık hız; seyirde yön bandının altında gösterilir.
  const speedLimit = onRoute ? speedLimitAt(route, progress.snap.index) : null;
  const speedKph = navigating && location?.speed >= 0 ? Math.round(location.speed * 3.6) : null;
  const overLimit = speedLimit != null && speedKph != null && speedKph > speedLimit + 3;
  // Süre, mesafe ve varış saati sıradaki hedefe göre: ara durak varsa önce o durağa (önizlemede
  // 1. durağa; seyirde geçilen duraktan sonra bir sonrakine), duraklar bitince hedefe.
  const legs = useMemo(() => (route ? routeLegs(route) : []), [route]);
  let legIndex = 0;
  if (navigating && progress) {
    legIndex = legs.findIndex((l) => l.endIndex > progress.snap.index);
    if (legIndex < 0) legIndex = legs.length - 1;
  }
  const leg = legs[legIndex];
  const toStop = Boolean(leg) && legIndex < legs.length - 1;
  const remainingMeters = !leg ? 0 : navigating && progress ? distanceAlong(route.coordinates, progress.snap, leg.endIndex) : leg.meters;
  // Kalan süre: bacağın tahmini süresinin (yoğun saat dahil) kalan mesafeye düşen payı.
  const remainingSec = leg ? (leg.durationSec * remainingMeters) / Math.max(1, leg.meters) : 0;
  const freeFlowSec = route ? (route.freeFlowDurationSec * (leg?.durationSec ?? 0)) / Math.max(1, route.durationSec) : 0;
  // Kutuya dokunulup henüz yazılmadıysa: son aramalar (Nereden'de en üstte "Konumum").
  const showRecents =
    !navigating &&
    searchFocused &&
    (!typed || activeText.trim().length < 3) &&
    results.length === 0 &&
    (recents.length > 0 || activeField === 'from');

  // --- Giriş kapısı: ayarlar/oturum yüklenene kadar açılış ekranı, oturum yoksa giriş ekranı ---
  if (!settingsLoaded || !sessionReady) {
    return (
      <View style={[styles.splash]}>
        <StatusBar style="light" />
        <Image source={LOGO} style={{ width: 150, height: 150 }} accessibilityLabel="HERMAPS" />
        <ActivityIndicator color="#fff" style={{ marginTop: 24 }} />
      </View>
    );
  }
  if (!session) {
    return (
      <>
        <StatusBar style="light" />
        <LoginScreen
          onLogin={login}
          onRegister={register}
          onVerifyRegistration={verifyRegistration}
          onRequestCode={requestEmailCode}
          onEmailLogin={emailLogin}
          onResetPassword={resetPassword}
          notice={toast}
          demoHint={demo ? `Demo sahip hesabı: ${DEMO_OWNER.phone.replace(/^(\d{4})(\d{3})(\d{2})(\d{2})$/, '$1 $2 $3 $4')} / ${DEMO_OWNER.password}` : null}
          backendLabel={demo ? 'Demo (bu telefon)' : settings.apiUrl}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <SettingsSheet visible={settingsOpen} settings={settings} user={null} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />
      </>
    );
  }
  if (user.mustChangePassword) {
    return (
      <>
        <StatusBar style="light" />
        <ChangePasswordScreen
          user={user}
          onLogout={logout}
          onSubmit={async (pw) => {
            const r = await api.changePassword(pw);
            setSession((s) => ({ ...s, user: r.user }));
            showToast('Şifreniz kaydedildi.');
          }}
        />
      </>
    );
  }

  return (
    <NightContext.Provider value={night}>
      <View style={styles.container}>
        <StatusBar style={night ? 'light' : 'dark'} />
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={ISTANBUL_REGION}
          // Gece modu: Android'de (Google) koyu harita stili, iOS'ta (Apple) koyu görünüm.
          customMapStyle={night ? NIGHT_MAP_STYLE : []}
          userInterfaceStyle={night ? 'dark' : 'light'}
          // Altlık: telefonun kendi haritası (Android'de Google, iOS'ta Apple). OSM'nin ücretsiz
          // karo sunucusu uygulamalardan gelen istekleri engellediği için onu kullanmıyoruz.
          mapType="standard"
          // Seyirde mavi nokta yerine aşağıdaki yön oku gösterilir.
          showsUserLocation={!navigating}
          showsMyLocationButton={false}
          showsCompass={false}
        // Android: işaretçiye (girilmez levhası) dokununca harita oraya kaymasın.
        moveOnMarkerPress={false}
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
          {route && !(puck && travelled != null) && (
            <Polyline coordinates={route.coordinates.map(toLatLng)} strokeColor="#0a66d8" strokeWidth={7} zIndex={1} />
          )}
          {/* Kapalı yollar: kırmızı-beyaz şerit (bariyer bandı) + ortada "girilmez" levhası. */}
          {closures.closures.map((c) => (
            <ClosedRoad
              key={c.id}
              closure={c}
              width={adminMode ? 9 : 7}
              onPress={() => onMapPress({ nativeEvent: { coordinate: toLatLng(c.midpoint ?? midpointOf(c.coordinates)) } })}
            />
          ))}
          {/* Yöneticiye, şu an trafiğe açık olan kayıtlı grupları gri kesik çizgiyle göster. */}
          {adminMode &&
            closures.zones
              .filter((z) => !z.active)
              .flatMap((z) => z.segments.map((s) => ({ ...s, key: `${z.id}:${s.id}` })))
              .map((s) => (
                <Polyline
                  key={s.key}
                  coordinates={s.coordinates.map(toLatLng)}
                  strokeColor="#8e8e93"
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
          {fromPlace && (
            <Marker coordinate={toLatLng([fromPlace.lat, fromPlace.lon])} pinColor="green" title={fromPlace.name} />
          )}
          {stops.map((s, i) => (
            <Marker
              key={`stop:${i}:${s.lat},${s.lon}`}
              coordinate={toLatLng([s.lat, s.lon])}
              pinColor="orange"
              title={`${i + 1}. durak: ${s.name}`}
            />
          ))}
          {destination && <Marker coordinate={toLatLng([destination.lat, destination.lon])} title={destination.name} />}
          {puck && travelled != null && (
            <NavFollower
              mapRef={mapRef}
              coords={route.coordinates}
              cum={routeCum}
              travelled={travelled}
              onRoute={onRoute}
              position={puck}
              bearing={bearing}
              speed={location.speed}
              follow={centered}
              compact={inPip}
              followStartedAt={followStartedAt}
            />
          )}
        </MapView>

        {/* Küçük pencere (PiP): yalnızca kısa yön bandı. */}
        {inPip && navigating && next && (
          <View style={styles.pipBanner} pointerEvents="none">
            <View style={styles.bannerRow}>
              <ManeuverIcon type={nextIsArrival ? 4 : next.type} size={26} />
              <Text style={styles.pipDistance}>{formatDistance(progress.distanceToNext)}</Text>
            </View>
            <Text style={styles.pipText} numberOfLines={2}>
              {bannerInstruction}
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
                    placeholderTextColor="#8e8e93"
                  />
                  <Pressable style={styles.editDone} onPress={finishEditing}>
                    <Text style={styles.editDoneText}>Bitti</Text>
                  </Pressable>
                </View>
                <Text style={styles.editHint}>Yola dokun: gruba ekle · Turuncu yola dokun: gruptan çıkar</Text>
              </View>
            ) : navigating && next ? (
              <>
                <SlideIn from={-24} style={[styles.banner, showThen && styles.bannerWithThen]}>
                  <View style={styles.bannerRow}>
                    <View style={styles.bannerIcon} accessibilityLabel={`Manevra ${next.type}`}>
                      <ManeuverIcon type={nextIsArrival ? 4 : next.type} size={44} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bannerDistance}>{formatDistance(progress.distanceToNext)}</Text>
                      <Text style={styles.bannerText} numberOfLines={2}>
                        {bannerInstruction}
                      </Text>
                    </View>
                  </View>
                  {!nextIsArrival && next.lanes && <LaneStrip lanes={next.lanes} />}
                </SlideIn>
                {showThen && (
                  <View style={styles.thenChip} accessibilityLabel={`Ardından manevra ${thenManeuver.type}`}>
                    <Text style={styles.thenText}>Ardından</Text>
                    <ManeuverIcon type={thenManeuver.type} size={28} />
                  </View>
                )}
                {(speedLimit != null || speedKph != null) && (
                  <View style={styles.speedRow} pointerEvents="none">
                    {speedLimit != null && (
                      <View style={styles.speedSign} accessibilityLabel={`Hız sınırı ${speedLimit}`}>
                        <Text style={styles.speedSignText}>{speedLimit}</Text>
                      </View>
                    )}
                    {speedKph != null && (
                      <View style={[styles.speedNow, overLimit && styles.speedNowOver]}>
                        <Text style={[styles.speedNowValue, overLimit && styles.speedNowOverText]}>{speedKph}</Text>
                        <Text style={[styles.speedNowUnit, overLimit && styles.speedNowOverText]}>km/sa</Text>
                      </View>
                    )}
                  </View>
                )}
              </>
            ) : (
              <>
                <SlideIn
                  from={-12}
                  style={styles.searchRow}
                  onLayout={(e) => setSearchCardBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
                >
                  <View style={styles.routeCard}>
                    <View style={styles.fieldRow}>
                      <View style={styles.iconSlot}>
                        <View style={styles.fromDot} />
                      </View>
                      <TextInput
                        style={styles.fieldInput}
                        value={fromText}
                        onChangeText={(t) => {
                          setTyped(true);
                          setFromText(t);
                        }}
                        selectTextOnFocus
                        onSubmitEditing={() => search()}
                        onFocus={() => {
                          setActiveField('from');
                          setTyped(false);
                          setResults([]);
                          setSearchFocused(true);
                        }}
                        onBlur={() =>
                          setTimeout(() => {
                            setSearchFocused(false);
                            // yarım kalan yazı silinsin, seçili başlangıcın adı geri gelsin
                            setFromText(fromPlaceRef.current ? fromPlaceRef.current.name : '');
                          }, 150)
                        }
                        placeholder={gpsUsable ? 'Konumum' : 'Nereden? (başlangıç seçin)'}
                        placeholderTextColor={gpsUsable ? (night ? '#4c9bff' : '#0a66d8') : '#8e8e93'}
                        returnKeyType="search"
                      />
                    </View>
                    <StopRows stops={stops} onRemove={removeStop} onMove={moveStop} />
                    {addingStop && (
                      <View>
                        <FieldJoiner />
                        <View style={styles.fieldRow}>
                          <View style={styles.iconSlot}>
                            <View style={styles.stopBadge}>
                              <Text style={styles.stopBadgeText}>{stops.length + 1}</Text>
                            </View>
                          </View>
                          <TextInput
                            style={styles.fieldInput}
                            value={stopText}
                            autoFocus
                            onChangeText={(t) => {
                              setTyped(true);
                              setStopText(t);
                            }}
                            onSubmitEditing={() => search()}
                            onFocus={() => {
                              setActiveField('stop');
                              setTyped(false);
                              setResults([]);
                              setSearchFocused(true);
                            }}
                            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                            placeholder="Ara durak ara ya da haritada basılı tut"
                            placeholderTextColor="#8e8e93"
                            returnKeyType="search"
                          />
                          <Pressable onPress={closeStopField} hitSlop={10} accessibilityLabel="Durak eklemeyi iptal et">
                            <Text style={styles.stopRemove}>✕</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                    <FieldJoiner />
                    <View style={styles.fieldRow}>
                      <View style={styles.iconSlot}>
                        <View style={styles.toPin} />
                      </View>
                      <TextInput
                        style={styles.fieldInput}
                        value={query}
                        onChangeText={(t) => {
                          setTyped(true);
                          setQuery(t);
                        }}
                        selectTextOnFocus
                        onSubmitEditing={() => search()}
                        onFocus={() => {
                          setActiveField('to');
                          setTyped(false);
                          setResults([]);
                          setSearchFocused(true);
                        }}
                        // Listeye dokunma kaybolmadan önce işlensin diye biraz gecikmeli.
                        onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                        placeholder="Nereye? (ör. Taksim)"
                        placeholderTextColor="#8e8e93"
                        returnKeyType="search"
                      />
                    </View>
                    {destination && !addingStop && stops.length < MAX_STOPS && (
                      <Pressable style={styles.addStop} onPress={openStopField} hitSlop={6}>
                        <Text style={styles.addStopText}>＋ Ara durak ekle</Text>
                      </Pressable>
                    )}
                  </View>
                  <View style={styles.cardButtons}>
                    <Pressable style={[styles.iconButton, styles.swapButton]} onPress={swapPlaces} accessibilityLabel="Yer değiştir">
                      <Text style={styles.swapText}>⇅</Text>
                    </Pressable>
                    <Pressable style={[styles.iconButton, styles.searchButton, styles.cardSearch]} onPress={() => search()}>
                      {searching ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchButtonText}>Ara</Text>}
                    </Pressable>
                  </View>
                </SlideIn>
                {isMember && !expired && !showRecents && results.length === 0 && (
                  <Pressable
                    style={[styles.timeBadge, remainingMs < 24 * 3600000 && styles.timeBadgeWarn]}
                    onPress={() => setPurchaseOpen(true)}
                    accessibilityLabel="Kalan süre · süre ekle"
                  >
                    <View style={[styles.timeDot, remainingMs < 24 * 3600000 && styles.timeDotWarn]} />
                    <Text style={[styles.timeText, remainingMs < 24 * 3600000 && styles.timeTextWarn]}>{formatRemaining(remainingMs)} kaldı</Text>
                    <Text style={styles.timeAdd}>＋ Süre ekle</Text>
                  </Pressable>
                )}
                {showRecents && (
                  <View style={styles.results}>
                    {activeField === 'from' && <MyLocationRow onPress={chooseMyLocationAsStart} />}
                    {recents.length > 0 && (
                      <View style={styles.recentsHeader}>
                        <Text style={styles.recentsTitle}>Son aramalar</Text>
                        <Pressable onPress={() => storeRecents([])} hitSlop={10}>
                          <Text style={styles.recentsClear}>Temizle</Text>
                        </Pressable>
                      </View>
                    )}
                    <FlatList
                      keyboardShouldPersistTaps="handled"
                      data={recents}
                      keyExtractor={(item, i) => `${item.lat},${item.lon},${i}`}
                      renderItem={({ item }) => (
                        <Pressable style={[styles.result, styles.recentRow]} onPress={() => choosePlace(item)}>
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
                {locStatus !== 'ok' && !fromPlace && (
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
                {location && !gpsUsable && !fromPlace && (
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
                    ListHeaderComponent={activeField === 'from' ? <MyLocationRow onPress={chooseMyLocationAsStart} /> : null}
                    renderItem={({ item }) => (
                      <Pressable style={styles.result} onPress={() => choosePlace(item)}>
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
              { bottom: panelBottom },
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
              ) : navigating ? (
                <NavSummary
                  legText={toStop ? `${legIndex + 1}. DURAĞA${stops[legIndex] ? ` · ${stops[legIndex].name}` : ''}` : null}
                  duration={formatDuration(remainingSec)}
                  detail={`${formatDistance(remainingMeters)} · ${formatArrival(remainingSec)} varış${busy ? ' · güncelleniyor…' : ''}`}
                  onEnd={finishNavigation}
                />
              ) : (
                <>
                  {toStop && (
                    <Text style={styles.legLabel} numberOfLines={1}>
                      {legIndex + 1}. DURAĞA{stops[legIndex] ? ` · ${stops[legIndex].name}` : ''}
                    </Text>
                  )}
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryMain}>{formatDuration(remainingSec)}</Text>
                    <Text style={styles.summarySub}>
                      {formatDistance(remainingMeters)}
                      {busy ? '  ·  güncelleniyor…' : ''}
                    </Text>
                    <View style={styles.arrival}>
                      <Text style={styles.arrivalLabel}>Varış</Text>
                      <Text style={styles.arrivalTime}>{formatArrival(remainingSec)}</Text>
                    </View>
                  </View>
                  {route.traffic && route.traffic.key !== 'night' && (
                    <Text style={styles.trafficNote}>
                      {route.traffic.label} tahmini dahil · boş yolda {formatDuration(freeFlowSec)}
                    </Text>
                  )}
                  {route.hasToll && (
                    <Text style={styles.tollNote}>
                      {settings.avoidTolls
                        ? 'Ücretsiz yol bulunamadı; bu rota ücretli yol (köprü, tünel ya da otoyol) içeriyor.'
                        : 'Bu rota ücretli yol (köprü, tünel ya da otoyol) içeriyor.'}
                    </Text>
                  )}
                  {!navigating && fromPlace && (
                    <Text style={styles.previewNote}>
                      Rota önizlemesi: seyir yalnızca konumunuzdan başlar. Başlamak için “Nereden”i Konumum yapın.
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
                            <Text style={styles.optionArrival}>Varış {formatArrival(o.durationSec)}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                  <View style={styles.actions}>
                    <Pressable style={[styles.button, styles.secondary]} onPress={clearTrip}>
                      <Text style={styles.secondaryText}>Temizle</Text>
                    </Pressable>
                    {canNavigate && (
                      <Pressable style={styles.button} onPress={startNavigation}>
                        <Text style={styles.buttonText}>Başla</Text>
                      </Pressable>
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
          <View style={[styles.sidePanel, { top: navigating ? 170 : Math.max(200, TOP_OFFSET + searchCardBottom + 12) }]}>
            <SideButton label="Ayarlar" onPress={() => setSettingsOpen(true)}>
              <Text style={styles.sideGlyph}>⚙︎</Text>
            </SideButton>
            {isOwner && (
              <SideButton label="Üyeler" onPress={() => setMembersOpen(true)}>
                <Text style={styles.sideGlyph}>👥</Text>
              </SideButton>
            )}
            {isStaff && (
              <SideButton label={adminMode ? 'Kapatma\nAÇIK' : 'Yol\nkapat'} active={adminMode} onPress={toggleAdmin}>
                <View style={[styles.noEntry, adminMode && styles.noEntryOn]}>
                  <View style={[styles.noEntryBar, adminMode && styles.noEntryBarOn]} />
                </View>
              </SideButton>
            )}
            {isStaff && adminMode && (
              <SideButton label={`Gruplar${closures.zones.length ? ` (${closures.zones.length})` : ''}`} onPress={() => setZonesOpen(true)}>
                <Text style={styles.sideGlyph}>☰</Text>
              </SideButton>
            )}
            <SideButton
              label={settings.voice === false ? 'Ses\nkapalı' : 'Ses\naçık'}
              active={settings.voice === false}
              onPress={toggleVoice}
            >
              <Text style={styles.sideGlyph}>{settings.voice === false ? '🔇' : '🔊'}</Text>
            </SideButton>
            <SideButton
              label={night ? 'Gece\naçık' : 'Gece\nmodu'}
              highlight={night}
              onPress={toggleNight}
              last={!(navigating && pipSupported)}
            >
              <Text style={styles.sideGlyph}>{night ? '🌙' : '☀️'}</Text>
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
              { bottom: route || busy ? bottomPanelHeight + panelBottom + 12 : Math.max(96, insets.bottom + 48) },
              pressed && styles.recenterPressed,
            ]}
            onPress={recenter}
            accessibilityLabel="Ortala"
          >
            <RecenterIcon />
          </Pressable>
        )}

        {!inPip && <Text style={[styles.attribution, { bottom: insets.bottom + 4 }]}>© OpenStreetMap katkıcıları</Text>}

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
          user={user}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
          onLogout={logout}
          onBuy={() => {
            setSettingsOpen(false);
            setPurchaseOpen(true);
          }}
          onDeleteAccount={async (password) => {
            await api.deleteAccount(password);
            await logout();
            showToast('Hesabınız silindi.');
          }}
        />

        {isOwner && <MembersSheet visible={membersOpen} api={api} onClose={() => setMembersOpen(false)} showToast={showToast} />}

        {/* Üyenin süresi bittiyse: rota alınamaz, paket satın alma ekranı açılır (devam eden seyir yarıda kesilmez). */}
        {expired && !navigating && (
          <PurchaseScreen expired user={user} api={api} demo={demo} onPurchased={refreshMe} onLogout={logout} />
        )}
        {isMember && !expired && purchaseOpen && (
          <PurchaseScreen
            user={user}
            api={api}
            demo={demo}
            onPurchased={async () => {
              await refreshMe();
              showToast('Süreniz eklendi.');
            }}
            onClose={() => setPurchaseOpen(false)}
          />
        )}
      </View>
    </NightContext.Provider>
  );
}

// Sağ paneldeki tek bir düğme: üstte simge, altta kısa etiket.
function SideButton({ label, onPress, active, highlight, last, children }) {
  const styles = useStyles();
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

/**
 * Ara durak satırları. Birden çok durak varsa sağdaki ≡ tutamağından sürükleyerek sıra
 * değiştirilir: sürüklenen satır parmağı izler, üzerinden geçtiği satırlar yer açar,
 * bırakınca onMove(eski sıra, yeni sıra) çağrılır.
 */
function StopRows({ stops, onRemove, onMove }) {
  const styles = useStyles();
  const [drag, setDrag] = useState(null); // { index, dy }
  const rowHeight = useRef(44);
  const target = drag ? Math.max(0, Math.min(stops.length - 1, drag.index + Math.round(drag.dy / rowHeight.current))) : -1;
  return stops.map((s, i) => {
    // Sürükleme sırasında satırın gösterilen yeri ve numarası (bırakınca alacağı sıra).
    let shift = 0;
    let number = i + 1;
    if (drag && i === drag.index) {
      shift = drag.dy;
      number = target + 1;
    } else if (drag && drag.index < i && i <= target) {
      shift = -rowHeight.current;
      number = i;
    } else if (drag && target <= i && i < drag.index) {
      shift = rowHeight.current;
      number = i + 2;
    }
    const dragging = drag?.index === i;
    return (
      <View
        key={`${i}:${s.lat},${s.lon}`}
        onLayout={(e) => (rowHeight.current = e.nativeEvent.layout.height)}
        style={[{ transform: [{ translateY: shift }] }, dragging && styles.stopDragging]}
      >
        <FieldJoiner />
        <View style={styles.fieldRow}>
          <View style={styles.iconSlot}>
            <View style={styles.stopBadge}>
              <Text style={styles.stopBadgeText}>{number}</Text>
            </View>
          </View>
          <Text style={styles.stopName} numberOfLines={1}>
            {s.name}
          </Text>
          <Pressable onPress={() => onRemove(i)} hitSlop={10} accessibilityLabel={`${i + 1}. durağı kaldır`}>
            <Text style={styles.stopRemove}>✕</Text>
          </Pressable>
          {stops.length > 1 && (
            <DragHandle
              label={`${i + 1}. durağı sürükle`}
              onDrag={(dy) => setDrag({ index: i, dy })}
              onDrop={(dy) => {
                setDrag(null);
                const to = Math.max(0, Math.min(stops.length - 1, i + Math.round(dy / rowHeight.current)));
                if (to !== i) onMove(i, to);
              }}
            />
          )}
        </View>
      </View>
    );
  });
}

function DragHandle({ label, onDrag, onDrop }) {
  const styles = useStyles();
  const handlers = useRef({ onDrag, onDrop });
  handlers.current = { onDrag, onDrop };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false, // harita sürüklemeyi devralmasın
      onPanResponderGrant: () => handlers.current.onDrag(0),
      onPanResponderMove: (_, g) => handlers.current.onDrag(g.dy),
      onPanResponderRelease: (_, g) => handlers.current.onDrop(g.dy),
      onPanResponderTerminate: () => handlers.current.onDrop(0),
    }),
  ).current;
  return (
    <View {...pan.panHandlers} style={styles.dragHandle} accessibilityLabel={label} hitSlop={8}>
      <View style={styles.dragLine} />
      <View style={styles.dragLine} />
      <View style={styles.dragLine} />
    </View>
  );
}

// Kutular arasındaki ayırıcı çizgi ve soldaki noktalı bağlantı (Nereden → duraklar → Nereye).
function FieldJoiner() {
  const styles = useStyles();
  return (
    <View style={styles.joiner}>
      <View style={styles.joinerDots} pointerEvents="none">
        <View style={styles.connectorDot} />
        <View style={styles.connectorDot} />
        <View style={styles.connectorDot} />
      </View>
      <View style={styles.fieldDivider} />
    </View>
  );
}

// Son aramalar listesindeki küçük saat simgesi.
function ClockIcon() {
  const styles = useStyles();
  return (
    <View style={styles.clock}>
      <View style={styles.clockHandUp} />
      <View style={styles.clockHandRight} />
    </View>
  );
}

// "Ortala" simgesi: Apple Haritalar'daki gibi sağ üste bakan mavi konum oku.
function RecenterIcon() {
  const styles = useStyles();
  return (
    <View style={styles.locArrow}>
      <View style={styles.locArrowHead} />
      <View style={styles.locArrowNotch} />
    </View>
  );
}

// "Nereden" listesinin başındaki "Konumum" seçeneği.
function MyLocationRow({ onPress }) {
  const styles = useStyles();
  return (
    <Pressable style={[styles.result, styles.recentRow]} onPress={onPress}>
      <View style={styles.myLocIcon}>
        <View style={styles.myLocIconDot} />
      </View>
      <Text style={[styles.resultName, styles.myLocText]}>Konumum</Text>
    </Pressable>
  );
}

// Hız arttıkça kamera biraz uzaklaşır; ok ekranın alt kısmında kalsın diye merkez ileride.
// Küçük pencerede (compact) biraz uzaklaşılır ki önümüzdeki yol daha çok görünsün.
const followZoom = (speed, compact = false) => (speed > 17 ? 16.6 : speed > 8 ? 17.3 : 17.9) - (compact ? 0.9 : 0);
const followOffset = (speed, compact = false) => (speed > 17 ? 110 : 55) * (compact ? 0.5 : 1);

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => {
  const d = ((b - a + 540) % 360) - 180; // en kısa yönden dön
  return (a + d * t + 360) % 360;
};

// Seyirde oku, kalan rota çizgisini ve takip kamerasını her karede günceller.
// GPS saniyede bir konum verdiği için ok yalnızca o anlarda güncellenirse kesik kesik
// (dona dona) ilerliyordu. Burada ok, iki ölçüm arasında rota boyunca kayarak gider; yeni
// ölçüm gecikirse kısa süre aynı hızla devam eder. Kamera da aynı karede oka kilitlenir.
// Mavi çizgi okun bulunduğu yerden başlar: geride kalan kısım silinir.
// Sıradaki iki dönüş arası bundan kısaysa yön bandının altında "Ardından" gösterilir.
const THEN_METERS = 300;

const FRAME_MS = 33;
const LINE_MS = 100;
const MAX_COAST_MS = 1500;
function NavFollower({ mapRef, coords, cum, travelled, onRoute, position, bearing, speed, follow, followStartedAt, compact }) {
  const anim = useRef(null);
  const [frame, setFrame] = useState(() => ({ point: position, bearing, dist: travelled }));
  const [line, setLine] = useState(() => ({ index: -1, coords: [] }));
  const props = useRef({ mapRef, follow, followStartedAt, speed, compact });
  useEffect(() => {
    props.current = { mapRef, follow, followStartedAt, speed, compact };
  });

  // Yeni ölçüm: animasyon o an gösterilen yerden yeni hedefe doğru yeniden kurulur.
  useEffect(() => {
    const now = Date.now();
    const prev = anim.current;
    const shown = prev?.shown ?? { point: position, bearing, dist: travelled };
    const sameRoute = prev?.coords === coords;
    // Ölçümler arası sürenin ortalaması; ok yeni hedefe bu sürede varır.
    const interval = prev ? Math.min(2000, Math.max(400, lerp(prev.interval, now - prev.fixAt, 0.5))) : 1000;
    let fromDist = sameRoute ? shown.dist : travelled;
    if (Math.abs(travelled - fromDist) > 60) fromDist = travelled; // büyük sıçrama: atla
    // Tahminle biraz ileri gidilmişse geri yürümesin, araç yetişene kadar beklesin.
    const toDist = travelled >= fromDist - 15 ? Math.max(travelled, fromDist) : travelled;
    anim.current = {
      coords,
      fixAt: now,
      interval,
      fromDist,
      toDist,
      onRoute,
      // Rotadan dışarıdayken ya da rota değişince ok düz çizgide kayar.
      blendFrom: !onRoute || !sameRoute || !prev?.onRoute ? shown.point : null,
      toPoint: position,
      fromBearing: shown.bearing,
      toBearing: bearing,
      speed: speed > 0 ? speed : 0,
      zoom: prev?.zoom ?? followZoom(speed),
      offset: prev?.offset ?? followOffset(speed),
      shown,
    };
  }, [travelled, position[0], position[1], bearing, coords, onRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let raf;
    let lastFrame = 0;
    let lastLine = 0;
    let lineIndex = -1;
    let lineTail = [];
    let lineDist = null;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = Date.now();
      if (now - lastFrame < FRAME_MS) return;
      lastFrame = now;
      const a = anim.current;
      if (!a) return;
      const elapsed = now - a.fixAt;
      const t = Math.min(1, elapsed / a.interval);
      // Hedefe varıldıktan sonra yeni ölçüm gelmediyse aynı hızla kısa süre devam et.
      const coast = elapsed > a.interval ? (Math.min(elapsed - a.interval, MAX_COAST_MS) / 1000) * a.speed : 0;
      const dist = Math.min(cum[cum.length - 1], lerp(a.fromDist, a.toDist, t) + (a.onRoute ? coast : 0));
      const target = a.onRoute ? pointAtDistance(coords, cum, dist).point : a.toPoint;
      const point = a.blendFrom ? [lerp(a.blendFrom[0], target[0], t), lerp(a.blendFrom[1], target[1], t)] : target;
      const shown = { point, dist, bearing: lerpAngle(a.fromBearing, a.toBearing, Math.min(1, t * 1.5)) };
      const moved =
        shown.point[0] !== a.shown.point[0] || shown.point[1] !== a.shown.point[1] || shown.bearing !== a.shown.bearing;
      a.shown = shown;
      if (moved) setFrame(shown);

      // Kalan çizgi: okun olduğu yerden rota sonuna (köşe noktası listesi yalnızca değişince kopyalanır).
      if (now - lastLine >= LINE_MS && dist !== lineDist) {
        lastLine = now;
        lineDist = dist;
        const at = pointAtDistance(coords, cum, dist);
        if (at.index !== lineIndex) {
          lineIndex = at.index;
          lineTail = coords.slice(at.index + 1).map(toLatLng);
        }
        setLine({ index: lineIndex, coords: [toLatLng(at.point), ...lineTail] });
      }

      const { mapRef: map, follow: following, followStartedAt: started, speed: sp, compact: small } = props.current;
      if (!following || now - started.current < 650) return;
      if (!moved && Math.abs(a.zoom - followZoom(sp, small)) < 0.01) return;
      a.zoom = lerp(a.zoom, followZoom(sp, small), 0.05);
      a.offset = lerp(a.offset, followOffset(sp, small), 0.05);
      const [lat, lon] = offsetPoint(point, shown.bearing, a.offset);
      map.current?.setCamera({ center: { latitude: lat, longitude: lon }, heading: shown.bearing, pitch: 55, zoom: a.zoom });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [coords, cum]);

  return (
    <>
      {line.coords.length > 1 && <Polyline coordinates={line.coords} strokeColor="#0a66d8" strokeWidth={7} zIndex={1} />}
      <NavPuck position={frame.point} bearing={frame.bearing} />
    </>
  );
}

// Seyirde alt panel (Google Haritalar tarzı): ortada kalan süre, altında mesafe ve varış saati;
// solda ✕ seyri bitirir. Yanlışlıkla basılmasın diye ✕ önce kısa bir onay sorar.
function NavSummary({ legText, duration, detail, onEnd }) {
  const styles = useStyles();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return undefined;
    const t = setTimeout(() => setConfirming(false), 5000); // cevap verilmezse onay kapanır
    return () => clearTimeout(t);
  }, [confirming]);

  if (confirming) {
    return (
      <View style={styles.navSummary}>
        <Text style={[styles.navEndQuestion, { flex: 1 }]}>Seyir bitsin mi?</Text>
        <Pressable style={[styles.navEndChoice, styles.secondary]} onPress={() => setConfirming(false)}>
          <Text style={styles.secondaryText}>Vazgeç</Text>
        </Pressable>
        <Pressable style={[styles.navEndChoice, styles.stop]} onPress={onEnd}>
          <Text style={styles.buttonText}>Bitir</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.navSummary}>
      <Pressable style={styles.navEnd} onPress={() => setConfirming(true)} hitSlop={6} accessibilityLabel="Seyri bitir">
        <Text style={styles.navEndText}>✕</Text>
      </Pressable>
      <View style={styles.navSummaryCenter}>
        {!!legText && (
          <Text style={styles.legLabel} numberOfLines={1}>
            {legText}
          </Text>
        )}
        <Text style={styles.navDuration}>{duration}</Text>
        <Text style={styles.navDetail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {/* ✕ ile denge: süre tam ortada dursun */}
      <View style={styles.navEndSpacer} />
    </View>
  );
}

// Seyirdeki yön oku. Harita düzlemine yatık (flat) olduğu için harita döndükçe
// birlikte döner; kamera gidiş yönüne baktığında ok hep yukarıyı gösterir.
function NavPuck({ position, bearing }) {
  const styles = useStyles();
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

// Kapalı yol: beyaz zemin üstüne kırmızı kesik çizgi (kırmızı-beyaz şerit) ve ortasında
// "girilmez" levhası. Levhaya dokunmak yola dokunmakla aynıdır (yöneticide aç/kapat).
function ClosedRoad({ closure, width, onPress }) {
  const coordinates = closure.coordinates.map(toLatLng);
  // Android özel işaretçiyi resme çevirir; ilk çizimden sonra güncellemeyi kapatmak performans için.
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracks(false), 600);
    return () => clearTimeout(t);
  }, []);
  return (
    <>
      <Polyline coordinates={coordinates} strokeColor="#ffffff" strokeWidth={width} zIndex={2} />
      <Polyline coordinates={coordinates} strokeColor="#d70015" strokeWidth={width} lineDashPattern={[10, 8]} zIndex={3} />
      <Marker
        coordinate={toLatLng(closure.midpoint ?? midpointOf(closure.coordinates))}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={tracks}
        onPress={onPress}
        zIndex={4}
      >
        <NoEntrySign />
      </Marker>
    </>
  );
}

function NoEntrySign() {
  const styles = useStyles();
  return (
    <View style={styles.noEntrySign} accessibilityLabel="Kapalı yol">
      <View style={styles.noEntrySignBar} />
    </View>
  );
}

const midpointOf = (coords) => coords[Math.floor(coords.length / 2)];

// Seyir sürerken ekranın kendiliğinden kapanmasını engeller.
function KeepScreenOn() {
  useKeepAwake('navigation');
  return null;
}

const TOP_OFFSET = 56; // üst alanın (arama kartı / yön bandı) ekranın üstünden uzaklığı

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.15,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 4,
};

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#e9e9e9' },
  top: { position: 'absolute', top: TOP_OFFSET, left: 12, right: 12, gap: 8 },
  searchRow: { flexDirection: 'row', gap: 8 },
  search: { flex: 1, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, ...shadow },
  iconButton: { width: 48, backgroundColor: '#fff', borderRadius: 12, alignItems: 'center', justifyContent: 'center', ...shadow },
  results: { backgroundColor: '#fff', borderRadius: 12, maxHeight: 320, ...shadow },
  result: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#d1d1d6' },
  resultName: { fontSize: 16, fontWeight: '600' },
  resultAddr: { fontSize: 12, color: '#6e6e73', marginTop: 2 },
  banner: { backgroundColor: '#0b5c3b', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, ...shadow },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bannerWithThen: { borderBottomLeftRadius: 0 },
  thenChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -8, // üstteki bandın hemen altına yapışık
    backgroundColor: '#084a30',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 6,
    ...shadow,
  },
  thenText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  bannerIcon: { width: 48, alignItems: 'center' },
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
  legLabel: { fontSize: 12, fontWeight: '800', color: '#b35f00', letterSpacing: 0.3, marginBottom: 2 },
  navSummary: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56 },
  navSummaryCenter: { flex: 1, alignItems: 'center' },
  navDuration: { fontSize: 26, fontWeight: '800', color: '#0b8a3e', lineHeight: 31 },
  navDetail: { fontSize: 15, color: '#6e6e73', fontWeight: '500' },
  navEnd: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#f2f2f7', alignItems: 'center', justifyContent: 'center' },
  navEndText: { fontSize: 20, fontWeight: '700', color: '#1c1c1e' },
  navEndSpacer: { width: 46 },
  navEndQuestion: { fontSize: 17, fontWeight: '700', color: '#1c1c1e' },
  navEndChoice: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center' },
  summaryRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  summaryMain: { fontSize: 26, fontWeight: '800', color: '#0b8a3e' },
  summarySub: { fontSize: 16, color: '#3a3a3c' },
  arrival: { marginLeft: 'auto', alignItems: 'flex-end' },
  arrivalLabel: { fontSize: 11, fontWeight: '700', color: '#6e6e73', letterSpacing: 0.3 },
  arrivalTime: { fontSize: 20, fontWeight: '800', color: '#1d1d1f', fontVariant: ['tabular-nums'] },
  optionArrival: { fontSize: 11, color: '#3a3a3c', fontWeight: '600', marginTop: 2 },
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
  editInput: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, color: '#1c1c1e' },
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
  splash: { flex: 1, backgroundColor: '#141a21', alignItems: 'center', justifyContent: 'center' },
  timeBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingVertical: 6,
    paddingLeft: 9,
    paddingRight: 12,
    ...shadow,
  },
  timeBadgeWarn: { backgroundColor: '#fff8e1' },
  timeDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#30a14e' },
  timeDotWarn: { backgroundColor: '#f08c00' },
  timeText: { fontSize: 12.5, fontWeight: '700', color: '#1c1c1e' },
  timeTextWarn: { color: '#8a5a00' },
  timeAdd: { fontSize: 12.5, fontWeight: '700', color: '#0a66d8', marginLeft: 4 },
  noEntrySign: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#d70015',
    borderWidth: 2.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  noEntrySignBar: { width: 14, height: 4.5, borderRadius: 1, backgroundColor: '#fff' },
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
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    ...shadow,
  },
  recenterPressed: { backgroundColor: '#eef4fd' },
  // Konum oku: mavi üçgen + beyaz çentik, 45° döndürülerek sağ üste baktırılır.
  locArrow: { width: 20, height: 22, transform: [{ rotate: '45deg' }], marginTop: 2, marginRight: 2 },
  locArrowHead: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 22,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#0a7aff',
  },
  locArrowNotch: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#fff',
  },
  routeCard: { flex: 1, backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 12, ...shadow },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldInput: { flex: 1, minWidth: 0, paddingVertical: 11, fontSize: 16, color: '#1c1c1e' },
  fieldDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#d1d1d6', marginLeft: 24 },
  fromDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 3, borderColor: '#0a66d8', backgroundColor: '#fff' },
  iconSlot: { width: 14, alignItems: 'center', justifyContent: 'center' },
  // Konum iğnesi: bir köşesi sivri yuvarlak, 45° döndürülünce sivri uç aşağı bakar.
  toPin: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderBottomRightRadius: 1,
    borderWidth: 3,
    borderColor: '#3a3a3c',
    backgroundColor: '#fff',
    transform: [{ rotate: '45deg' }],
    marginTop: -2,
  },
  joiner: { justifyContent: 'center' },
  joinerDots: { position: 'absolute', left: 0, width: 14, top: -12, height: 24, alignItems: 'center', justifyContent: 'space-evenly' },
  stopBadge: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#f08c00', alignItems: 'center', justifyContent: 'center' },
  stopBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  stopName: { flex: 1, minWidth: 0, paddingVertical: 11, fontSize: 16, color: '#1c1c1e' },
  stopDragging: { backgroundColor: '#fff', zIndex: 10, ...shadow, shadowOpacity: 0.25, elevation: 8, borderRadius: 8 },
  dragHandle: { width: 28, height: 36, alignItems: 'center', justifyContent: 'center', gap: 3, marginLeft: 6 },
  dragLine: { width: 16, height: 2, borderRadius: 1, backgroundColor: '#8e8e93' },
  stopRemove: { color: '#8e8e93', fontSize: 16, paddingHorizontal: 4 },
  addStop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#d1d1d6', marginLeft: 24, paddingVertical: 8 },
  addStopText: { color: '#0a66d8', fontSize: 14, fontWeight: '600' },
  speedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  speedSign: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 5,
    borderColor: '#d70015',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  speedSignText: { fontSize: 17, fontWeight: '800', color: '#1c1c1e' },
  speedNow: { minWidth: 48, height: 48, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, ...shadow },
  speedNowOver: { backgroundColor: '#d70015' },
  speedNowValue: { fontSize: 17, fontWeight: '800', color: '#1c1c1e' },
  speedNowUnit: { fontSize: 9, color: '#636366', marginTop: -2 },
  speedNowOverText: { color: '#fff' },
  connectorDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#aeb4bc' },
  cardButtons: { gap: 8 },
  swapButton: { flex: 1, minHeight: 40 },
  swapText: { fontSize: 22, color: '#3a3a3c', fontWeight: '600' },
  cardSearch: { flex: 1, minHeight: 40 },
  previewNote: { fontSize: 12, color: '#6e6e73', marginTop: 4 },
  myLocText: { color: '#0a66d8' },
  myLocIcon: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#cfe0fb', alignItems: 'center', justifyContent: 'center' },
  myLocIconDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#0a66d8', borderWidth: 1.5, borderColor: '#fff' },
  attribution: { position: 'absolute', right: 6, bottom: 6, fontSize: 10, color: '#3a3a3c', backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 4 },
});

// --- Gece modu ---
// Koyu renkler yalnızca değişen özellikleri ezer; bileşenler useStyles() ile o anki temayı alır.
const NIGHT = {
  surface: '#1c1c1e',
  raised: '#2c2c2e',
  text: '#f2f2f7',
  sub: '#a1a1a6',
  line: '#3a3a3c',
  blue: '#4c9bff',
};
const nightOverrides = StyleSheet.create({
  container: { backgroundColor: NIGHT.surface },
  search: { backgroundColor: NIGHT.surface, color: NIGHT.text },
  iconButton: { backgroundColor: NIGHT.surface },
  results: { backgroundColor: NIGHT.surface },
  result: { borderColor: NIGHT.line },
  resultName: { color: NIGHT.text },
  resultAddr: { color: NIGHT.sub },
  zonesButton: { backgroundColor: NIGHT.surface },
  zonesButtonText: { color: NIGHT.text },
  demoPill: { backgroundColor: 'rgba(44,44,46,0.92)' },
  demoPillText: { color: NIGHT.sub },
  bottom: { backgroundColor: NIGHT.surface },
  summaryMain: { color: '#30d158' },
  legLabel: { color: '#ffb340' },
  summarySub: { color: '#d1d1d6' },
  navDuration: { color: '#30d158' },
  navDetail: { color: NIGHT.sub },
  navEnd: { backgroundColor: NIGHT.raised },
  navEndText: { color: NIGHT.text },
  navEndQuestion: { color: NIGHT.text },
  arrivalLabel: { color: NIGHT.sub },
  arrivalTime: { color: NIGHT.text },
  optionArrival: { color: '#d1d1d6' },
  tollNote: { color: NIGHT.sub },
  tollLabel: { color: NIGHT.text },
  trafficNote: { color: '#ffb340' },
  option: { borderColor: NIGHT.line },
  optionSelected: { borderColor: NIGHT.blue, backgroundColor: '#10284a' },
  optionTime: { color: '#d1d1d6' },
  optionTimeSelected: { color: NIGHT.blue },
  optionSub: { color: NIGHT.sub },
  secondary: { backgroundColor: NIGHT.raised },
  secondaryText: { color: NIGHT.text },
  notice: { backgroundColor: '#3a3000' },
  noticeText: { color: '#ffe08a' },
  editCard: { backgroundColor: NIGHT.surface },
  editInput: { borderColor: NIGHT.line, color: NIGHT.text },
  editHint: { color: NIGHT.sub },
  pipIcon: { borderColor: NIGHT.text },
  pipIconInner: { backgroundColor: NIGHT.text },
  sidePanel: { backgroundColor: NIGHT.surface },
  sideDivider: { borderColor: NIGHT.line },
  sideActive: { backgroundColor: '#4a1418' },
  sidePressed: { backgroundColor: NIGHT.raised },
  sideGlyph: { color: NIGHT.text },
  sideLabel: { color: '#d1d1d6' },
  sideLabelHighlight: { color: NIGHT.blue },
  recentsTitle: { color: NIGHT.sub },
  recentsClear: { color: NIGHT.blue },
  recenter: { backgroundColor: NIGHT.surface },
  recenterPressed: { backgroundColor: NIGHT.raised },
  locArrowHead: { borderBottomColor: NIGHT.blue },
  locArrowNotch: { borderBottomColor: NIGHT.surface },
  routeCard: { backgroundColor: NIGHT.surface },
  fieldInput: { color: NIGHT.text },
  fieldDivider: { backgroundColor: NIGHT.line },
  fromDot: { borderColor: NIGHT.blue, backgroundColor: NIGHT.surface },
  toPin: { borderColor: '#d1d1d6', backgroundColor: NIGHT.surface },
  stopName: { color: NIGHT.text },
  stopDragging: { backgroundColor: NIGHT.raised },
  addStop: { borderTopColor: NIGHT.line },
  addStopText: { color: NIGHT.blue },
  speedNow: { backgroundColor: NIGHT.surface },
  speedNowValue: { color: NIGHT.text },
  speedNowUnit: { color: NIGHT.sub },
  connectorDot: { backgroundColor: '#636366' },
  swapText: { color: NIGHT.text },
  previewNote: { color: NIGHT.sub },
  myLocIcon: { backgroundColor: '#10284a' },
  myLocText: { color: NIGHT.blue },
  timeBadge: { backgroundColor: NIGHT.surface },
  timeText: { color: NIGHT.text },
  attribution: { color: '#d1d1d6', backgroundColor: 'rgba(0,0,0,0.5)' },
});
const nightStyles = Object.fromEntries(
  Object.entries(baseStyles).map(([key, style]) => [key, nightOverrides[key] ? [style, nightOverrides[key]] : style]),
);
const NightContext = createContext(false);
const useStyles = () => (useContext(NightContext) ? nightStyles : baseStyles);

// Google Haritalar'ın gece stili (Android). iOS'taki Apple haritası userInterfaceStyle ile kararır.
const NIGHT_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] },
];
