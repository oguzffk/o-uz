import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
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

// Küçük pencere en fazla bu kadar büyük olur (dp). Telefon ekranı her iki yönde de daha büyüktür.
const PIP_MAX_DP = 480;

/**
 * Uygulama küçük pencerede mi? expo-pip'in olayı bazı cihazlarda hiç gelmiyor (modül, ekran
 * henüz açılmadan yüklendiği için olayı dinleyen parçayı ekrana ekleyemiyor). Bu yüzden pencere
 * boyutu her değiştiğinde Android'e doğrudan da sorulur; o da cevap vermezse pencerenin
 * küçüldüğüne bakılır.
 */
export function usePipMode() {
  const [eventPip, setEventPip] = useState(false);
  const { width, height } = useWindowDimensions();
  useEffect(() => {
    if (!native) return undefined;
    const sub = native.addListener('onPipModeChange', ({ isInPipMode }) => setEventPip(isInPipMode));
    return () => sub.remove();
  }, []);
  if (!native) return false;
  let asked = false;
  try {
    asked = native.isInPipMode() === true;
  } catch {
    asked = false;
  }
  return eventPip || asked || (width < PIP_MAX_DP && height < PIP_MAX_DP);
}
