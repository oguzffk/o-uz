import { useEffect, useMemo, useRef } from 'react';
import * as Speech from 'expo-speech';
import { distanceAlong, distanceMeters, snapToRoute } from './geo';

const OFF_ROUTE_METERS = 45;
const OFF_ROUTE_FIXES = 3; // GPS sıçramalarında hemen yeniden rota almamak için
const ARRIVE_METERS = 25;
const ALERT_METERS = 350;
const PRE_METERS = 60;

export const stopSpeech = () => Speech.stop();

const speak = (text) => {
  if (!text) return;
  Speech.stop();
  Speech.speak(text, { language: 'tr-TR' });
};

/**
 * Seyir sırasında konumu rotaya oturtur, sıradaki manevrayı ve mesafeleri hesaplar,
 * sesli yönlendirme yapar. Rotadan çıkılırsa onOffRoute, varışta onArrive çağrılır.
 */
export function useNavigation({ route, location, active, voice = true, onOffRoute, onArrive }) {
  // Konumun rotada en son oturtulduğu nokta. Hangi rotaya ait olduğu da tutulur: rotadan çıkınca
  // gelen yeni rota daha kısa olur; eski rotanın indeksiyle aranırsa konum rotanın sonunu aşıyor,
  // "hedefe 10 m, 1 dk" gösteriliyordu.
  const tracked = useRef({ route: null, index: 0 });
  const offRouteCount = useRef(0);
  const spoken = useRef(new Set());
  const callbacks = useRef({ onOffRoute, onArrive });
  callbacks.current = { onOffRoute, onArrive };
  // Sesli yönlendirme kapalıysa talimatlar yine "söylendi" sayılır; açılınca eskiler tekrarlanmaz.
  const voiceOn = useRef(voice);
  voiceOn.current = voice;
  const say = (text) => {
    if (voiceOn.current) speak(text);
  };

  useEffect(() => {
    if (!voice) Speech.stop(); // kapatılınca o an okunan talimat da sussun
  }, [voice]);

  // Yeni rota geldiğinde takip durumu sıfırlanır ve ilk talimat okunur.
  useEffect(() => {
    tracked.current = { route, index: 0 };
    offRouteCount.current = 0;
    spoken.current = new Set();
    if (active && route) say(route.maneuvers[0]?.verbalPre);
  }, [route, active]);

  const progress = useMemo(() => {
    if (!route || !location) return null;
    const coords = route.coordinates;
    const fromIndex = active && tracked.current.route === route ? tracked.current.index : 0;
    const snap = snapToRoute([location.lat, location.lon], coords, fromIndex);
    const nextIdx = route.maneuvers.findIndex((m) => m.beginShapeIndex > snap.index);
    const next = nextIdx >= 0 ? route.maneuvers[nextIdx] : route.maneuvers[route.maneuvers.length - 1];
    return {
      snap,
      nextIdx,
      next,
      distanceToNext: nextIdx >= 0 ? distanceAlong(coords, snap, next.beginShapeIndex) : 0,
      remainingMeters: distanceAlong(coords, snap, coords.length - 1),
    };
  }, [route, location, active]);

  useEffect(() => {
    if (!active || !progress) return;
    tracked.current = { route, index: progress.snap.index };
    // Ara durağa varıldıysa takip durağın ötesinden sürer. Durak sonrası aynı sokaktan geri
    // dönülüyorsa (U dönüşü) konum, üst üste binen önceki bacağa oturtulmasın.
    const here = [location.lat, location.lon];
    // Yalnızca sıradaki durak: rota sonraki bir durağın yanından erken geçerse o durak atlanmasın.
    const nextStop = (route.stops ?? []).find((st) => st.shapeIndex > tracked.current.index);
    if (nextStop && distanceMeters(here, route.coordinates[nextStop.shapeIndex]) < ARRIVE_METERS) {
      tracked.current.index = nextStop.shapeIndex;
    }

    if (progress.snap.distance > OFF_ROUTE_METERS) {
      offRouteCount.current += 1;
      if (offRouteCount.current >= OFF_ROUTE_FIXES) {
        offRouteCount.current = 0;
        callbacks.current.onOffRoute?.();
      }
      return;
    }
    offRouteCount.current = 0;

    if (progress.remainingMeters < ARRIVE_METERS) {
      say('Hedefinize vardınız.');
      callbacks.current.onArrive?.();
      return;
    }

    const { nextIdx, next, distanceToNext } = progress;
    if (nextIdx < 0) return;
    const once = (key, text) => {
      if (spoken.current.has(key)) return;
      spoken.current.add(key);
      say(text);
    };
    if (distanceToNext < PRE_METERS) once(`${nextIdx}:pre`, next.verbalPre);
    else if (distanceToNext < ALERT_METERS && next.verbalAlert) once(`${nextIdx}:alert`, next.verbalAlert);
    // konum ve rota `progress` ile birlikte değişir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, active]);

  return progress;
}
