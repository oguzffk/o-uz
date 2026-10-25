import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Süre paketleri App Store / Google Play'den satın alınır (RevenueCat üzerinden). Satın alım
 * tamamlanınca RevenueCat sunucumuza bildirir, sunucu üyenin süresini uzatır; uygulama da
 * süreyi sunucudan okur. Ürün kimlikleri mağaza panellerinde ve sunucuda aynıdır.
 * Fiyatlar mağazadan gelir; aşağıdakiler mağazaya ulaşılamazsa gösterilen varsayılanlardır.
 */
export const PRODUCTS = [
  { id: 'hermap_1gun', days: 1, label: '1 gün', price: '119,99 TL' },
  { id: 'hermap_3gun', days: 3, label: '3 gün', price: '299,99 TL' },
  { id: 'hermap_1hafta', days: 7, label: '1 hafta', price: '559,99 TL' },
];

// RevenueCat'in herkese açık uygulama anahtarları (gizli değildir; EAS ortam değişkeni olarak verilir).
const KEYS = {
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
};

// Expo Go'da mağaza ödemesi yoktur (RevenueCat orada yalnızca önizleme modunda çalışır).
const inExpoGo = Constants.executionEnvironment === 'storeClient';

export function storeAvailable() {
  return !inExpoGo && Platform.OS !== 'web' && Boolean(KEYS[Platform.OS]);
}

let configuredFor = null;

// RevenueCat'e kullanıcı bizim kullanıcı kimliğimizle tanıtılır; sunucuya gelen bildirimde bu kimlik olur.
async function sdk(userId) {
  const Purchases = require('react-native-purchases').default;
  if (configuredFor === null) {
    Purchases.configure({ apiKey: KEYS[Platform.OS], appUserID: userId });
    configuredFor = userId;
  } else if (configuredFor !== userId) {
    await Purchases.logIn(userId);
    configuredFor = userId;
  }
  return Purchases;
}

/** Mağazadaki ürünler: { [ürünKimliği]: storeProduct } (priceString mağazanın yerel fiyatıdır). */
export async function loadStoreProducts(userId) {
  if (!storeAvailable()) return null;
  const Purchases = await sdk(userId);
  const list = await Purchases.getProducts(
    PRODUCTS.map((p) => p.id),
    Purchases.PRODUCT_CATEGORY.NON_SUBSCRIPTION,
  );
  return Object.fromEntries(list.map((p) => [p.identifier, p]));
}

/** Mağaza ödeme penceresini açar. Kullanıcı vazgeçerse false döner. */
export async function buyStoreProduct(userId, storeProduct) {
  const Purchases = await sdk(userId);
  try {
    await Purchases.purchaseStoreProduct(storeProduct);
    return true;
  } catch (err) {
    if (err?.userCancelled) return false;
    throw err;
  }
}
