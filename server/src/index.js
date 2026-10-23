import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { ClosureStore } from './closures.js';
import { createValhallaClient } from './valhalla.js';

const PORT = Number(process.env.PORT ?? 3000);
const VALHALLA_URL = process.env.VALHALLA_URL ?? 'http://localhost:8002';
const DATA_FILE = process.env.CLOSURES_FILE ?? fileURLToPath(new URL('../data/closures.json', import.meta.url));
let ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
  ADMIN_TOKEN = 'istanbul-admin';
  console.warn(`⚠️  ADMIN_TOKEN ayarlanmadı, geliştirme anahtarı kullanılıyor: "${ADMIN_TOKEN}"`);
}

const store = new ClosureStore(DATA_FILE);
const app = createApp({
  valhalla: createValhallaClient(VALHALLA_URL),
  store,
  adminToken: ADMIN_TOKEN,
  nominatimUrl: process.env.NOMINATIM_URL,
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API: http://localhost:${PORT}  (yönetici paneli: http://localhost:${PORT}/admin/)`);
  console.log(`Valhalla: ${VALHALLA_URL}  ·  ${store.list().length} kapalı segment yüklendi`);
});
