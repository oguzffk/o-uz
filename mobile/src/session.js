import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Oturum anahtarı telefonun güvenli kasasında (Android Keystore / iOS Keychain) saklanır.
 * Tarayıcı önizlemesinde güvenli kasa olmadığı için AsyncStorage kullanılır.
 */
const KEY = 'hermap-session';
const web = Platform.OS === 'web';

export async function loadSession() {
  try {
    const raw = web ? await AsyncStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** { token, backend } — hangi sunucuya ait olduğu da saklanır; sunucu değişince oturum geçersizdir. */
export async function saveSession(session) {
  const raw = JSON.stringify(session);
  try {
    if (web) await AsyncStorage.setItem(KEY, raw);
    else await SecureStore.setItemAsync(KEY, raw);
  } catch {
    // Saklanamazsa uygulama açık kaldıkça oturum sürer; yeniden açılınca tekrar giriş istenir.
  }
}

export async function clearSession() {
  try {
    if (web) await AsyncStorage.removeItem(KEY);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // yoksa sorun değil
  }
}

/** Kalan süre metni: "2 gün 5 saat", "3 saat 20 dk", "12 dk". */
export function formatRemaining(ms) {
  if (ms <= 0) return 'Süre doldu';
  const min = Math.floor(ms / 60000);
  const days = Math.floor(min / 1440);
  const hours = Math.floor((min % 1440) / 60);
  if (days > 0) return `${days} gün ${hours} saat`;
  if (hours > 0) return `${hours} saat ${min % 60} dk`;
  return `${Math.max(1, min)} dk`;
}

export const ROLE_LABELS = { owner: 'Sahip', admin: 'Yönetici', member: 'Üye' };
