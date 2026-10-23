import { useEffect, useMemo, useRef } from 'react';
import * as Speech from 'expo-speech';
import { distanceAlong, snapToRoute } from './geo';

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
export function useNavigation({ route, location, active, onOffRoute, onArrive }) {
  const lastIndex = useRef(0);
  const offRouteCount = useRef(0);
  const spoken = useRef(new Set());
  const callbacks = useRef({ onOffRoute, onArrive });
  callbacks.current = { onOffRoute, onArrive };

  // Yeni rota geldiğinde takip durumu sıfırlanır ve ilk talimat okunur.
  useEffect(() => {
    lastIndex.current = 0;
    offRouteCount.current = 0;
    spoken.current = new Set();
    if (active && route) speak(route.maneuvers[0]?.verbalPre);
  }, [route, active]);

  const progress = useMemo(() => {
    if (!route || !location) return null;
    const coords = route.coordinates;
    const snap = snapToRoute([location.lat, location.lon], coords, active ? lastIndex.current : 0);
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
    lastIndex.current = progress.snap.index;

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
      speak('Hedefinize vardınız.');
      callbacks.current.onArrive?.();
      return;
    }

    const { nextIdx, next, distanceToNext } = progress;
    if (nextIdx < 0) return;
    const once = (key, text) => {
      if (spoken.current.has(key)) return;
      spoken.current.add(key);
      speak(text);
    };
    if (distanceToNext < PRE_METERS) once(`${nextIdx}:pre`, next.verbalPre);
    else if (distanceToNext < ALERT_METERS && next.verbalAlert) once(`${nextIdx}:alert`, next.verbalAlert);
  }, [progress, active]);

  return progress;
}
