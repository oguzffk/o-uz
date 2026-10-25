import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { ClosureStore } from './closures.js';
import { UserStore } from './users.js';
import { createValhallaClient } from './valhalla.js';
import { createMailer } from './mailer.js';

const PORT = Number(process.env.PORT ?? 3000);
const VALHALLA_URL = process.env.VALHALLA_URL ?? 'http://localhost:8002';
const DATA_FILE = process.env.CLOSURES_FILE ?? fileURLToPath(new URL('../data/closures.json', import.meta.url));
const USERS_FILE = process.env.USERS_FILE ?? fileURLToPath(new URL('../data/users.json', import.meta.url));

const store = new ClosureStore(DATA_FILE);
const users = new UserStore(USERS_FILE);

// İlk açılışta sahip hesabı: OWNER_PHONE (+ isteğe bağlı OWNER_PASSWORD). Şifre verilmezse rastgele
// üretilir ve yalnızca bu sefer konsola yazılır; sabit varsayılan şifre yoktur.
if (!users.hasOwner()) {
  if (!process.env.OWNER_PHONE) {
    console.error('Sahip hesabı yok. OWNER_PHONE (ve isteğe bağlı OWNER_PASSWORD) ortam değişkeniyle başlatın.');
    process.exit(1);
  }
  const created = users.ensureOwner({
    phone: process.env.OWNER_PHONE,
    password: process.env.OWNER_PASSWORD,
    name: process.env.OWNER_NAME,
    email: process.env.OWNER_EMAIL,
  });
  console.log(`Sahip hesabı oluşturuldu: ${created.user.phone}`);
  if (created.password) console.log(`İlk giriş şifresi (girişte değiştirmeniz istenecek): ${created.password}`);
}

const mailer = createMailer();
if (!mailer.configured) console.warn('⚠️  SMTP ayarlı değil: giriş kodları e-postayla gönderilmez, bu konsola yazılır.');

const app = createApp({
  valhalla: createValhallaClient(VALHALLA_URL),
  store,
  users,
  mailer,
  nominatimUrl: process.env.NOMINATIM_URL,
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API: http://localhost:${PORT}  (yönetim paneli: http://localhost:${PORT}/admin/)`);
  console.log(`Valhalla: ${VALHALLA_URL}  ·  ${store.list().length} kapalı segment yüklendi`);
});
