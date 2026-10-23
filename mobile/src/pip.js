import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * Resim içinde resim (PiP): seyir sırasında uygulama küçük bir pencerede devam eder.
 * Yalnızca Android'de ve APK/development build'de vardır; Expo Go'da modül yoktur,
 * o zaman her şey sessizce devre dışı kalır (expo-pip'in kendi hook'u orada uyarı basıyor).
 */
const native = Platform.OS === 'android' ? requireOptionalNativeModule('ExpoPip') : null;

export const pipSupported = Boolean(native);

// Pencere oranı (genişlik:yükseklik). Android 1:2.39 ile 2.39:1 arasını kabul eder.
const ASPECT = { width: 3, height: 4 };

/** Android 12+ ana ekran tuşunda kendiliğinden küçük pencereye geçsin mi. */
export function setAutoPip(enabled) {
  native?.setPictureInPictureParams({ ...ASPECT, autoEnterEnabled: enabled });
}

/** Küçük pencereye hemen geç (Android 8+; eski sürümler için "Küçült" düğmesi). */
export function enterPip() {
  native?.enterPipMode({ ...ASPECT });
}

export function usePipMode() {
  const [inPip, setInPip] = useState(false);
  useEffect(() => {
    if (!native) return undefined;
    const sub = native.addListener('onPipModeChange', ({ isInPipMode }) => setInPip(isInPipMode));
    return () => sub.remove();
  }, []);
  return inPip;
}
