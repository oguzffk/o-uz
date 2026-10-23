// app.json'daki ayarların üzerine, gizli tutulması gereken değerleri ortam değişkenlerinden ekler.
// GOOGLE_MAPS_API_KEY: Android'de haritanın görünmesi için gerekli (Expo Go'da gerekmez).
// EAS Build'de `eas env:create` ile tanımlanır; anahtar asla dosyaya yazılmaz.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_API_KEY },
    },
  },
});
