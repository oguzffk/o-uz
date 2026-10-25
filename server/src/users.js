import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Kullanıcılar ve oturumlar.
 *
 * Roller:
 * - owner (sahip): her şey; üye ekler, süre verir/kaldırır, yönetici ekler/siler.
 * - admin (yönetici): yalnızca yol kapatma ve gruplar.
 * - member (üye): navigasyon; `expiresAt` geçmişse rota alamaz.
 *
 * Kayıt: üye uygulamadan ad, e-posta, telefon ve şifresiyle kaydolur; hesap, e-postasına giden
 * 6 haneli kod girilince açılır (süresi yoktur, paket satın alır). Sonra e-posta ya da telefon +
 * şifreyle girer; şifresini unutursa e-postasına gelen kodla yenisini belirler.
 * Sahip/yöneticinin eklediği eski üyeler şifresizdir, e-posta koduyla girer. Sahip ve
 * yöneticiler de e-posta koduyla girebilir; telefon + şifre yedek olarak kalır.
 * Şifreler scrypt ile tuzlanıp saklanır, kodların yalnızca özeti tutulur. Oturum anahtarı
 * yalnızca girişte bir kez döner; dosyada sha256 özeti tutulur. Bir hesap aynı anda tek
 * cihazda açıktır: yeni giriş eski oturumu kapatır.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;
export const EXTEND_DAYS = new Set([1, 3, 7]);
const MIN_PASSWORD = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;

/**
 * Mağazada satılan süre paketleri (App Store / Google Play ürün kimliği → gün). Fiyatlar
 * mağaza panellerinde girilir: 1 gün 119,99 TL, 3 gün 299,99 TL, 1 hafta 559,99 TL.
 */
export const PRODUCTS = { hermap_1gun: 1, hermap_3gun: 3, hermap_1hafta: 7 };

export class UserError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

// Altı haneli doğrulama kodu (e-postayla gider).
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

// Altı haneli geçici şifre (WhatsApp'tan iletilir, ilk girişte değiştirilir).
const tempPassword = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** "0532 123 45 67", "+90 532...", "5321234567" → "05321234567". Geçersizse hata. */
export function normalizePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('90') && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 10) digits = `0${digits}`;
  if (!/^0\d{10}$/.test(digits)) throw new UserError(400, 'Geçerli bir telefon numarası girin (ör. 0532 123 45 67)');
  return digits;
}

/** "  Ayse@Ornek.com " → "ayse@ornek.com". Geçersizse hata. */
export function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new UserError(400, 'Geçerli bir e-posta adresi girin');
  }
  return email;
}

export class UserStore {
  constructor(filePath, { now = () => Date.now() } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.users = new Map();
    // Doğrulanmayı bekleyen kayıtlar (e-posta → bilgiler + kod). Hesap kod girilince açılır;
    // bellekte tutulur, sunucu yeniden başlarsa kayıt baştan yapılır.
    this.pending = new Map();
    this.#load();
  }

  #load() {
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
      for (const u of data.users ?? []) this.users.set(u.id, u);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  #save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify({ users: [...this.users.values()] }, null, 2), { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }

  /** Dışarıya verilen kullanıcı bilgisi (şifre özeti ve oturum yok). */
  view(user) {
    const { id, name, role, expiresAt, createdAt, lastLoginAt } = user;
    return {
      id,
      name,
      email: user.email ?? null,
      phone: user.phone ?? null,
      role,
      expiresAt: expiresAt ?? null,
      // Geçici şifreyle girene şifre belirletilir; e-posta koduyla girene gerekmez.
      mustChangePassword: Boolean(user.mustChangePassword && user.sessionVia === 'password'),
      active: this.isActive(user),
      createdAt,
      lastLoginAt: lastLoginAt ?? null,
      lastPurchase: (() => {
        const p = user.purchases?.filter((x) => !x.refunded).at(-1);
        return p ? { productId: p.productId, days: p.days, at: p.at, store: p.store } : null;
      })(),
    };
  }

  /** Sahip ve yönetici her zaman aktif; üye süresi bitene kadar. */
  isActive(user) {
    return user.role !== 'member' || (user.expiresAt != null && user.expiresAt > this.now());
  }

  get(id) {
    return this.users.get(id);
  }

  findByPhone(phone) {
    return [...this.users.values()].find((u) => u.phone === phone);
  }

  findByEmail(email) {
    return [...this.users.values()].find((u) => u.email === email);
  }

  list(role) {
    return [...this.users.values()]
      .filter((u) => !role || u.role === role)
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map((u) => this.view(u));
  }

  hasOwner() {
    return [...this.users.values()].some((u) => u.role === 'owner');
  }

  /**
   * Yeni kullanıcı. Üye: ad + e-posta (telefon isteğe bağlı, ödeme takibi için); şifresi yoktur.
   * Yönetici: ad + e-posta + telefon; yedek giriş için geçici şifre döner.
   */
  create({ name, email, phone, role = 'member' }) {
    if (!['owner', 'admin', 'member'].includes(role)) throw new UserError(400, 'Geçersiz rol');
    const cleanName = String(name ?? '').trim().slice(0, 80);
    if (!cleanName) throw new UserError(400, 'Ad soyad girin');
    const cleanEmail = role === 'owner' && !email ? null : normalizeEmail(email);
    const cleanPhone = role === 'member' && !String(phone ?? '').trim() ? null : normalizePhone(phone);
    if (cleanEmail && this.findByEmail(cleanEmail)) throw new UserError(409, 'Bu e-posta adresiyle kayıtlı biri var');
    if (cleanPhone && this.findByPhone(cleanPhone)) throw new UserError(409, 'Bu telefon numarasıyla kayıtlı biri var');
    const password = role === 'member' ? null : tempPassword();
    const user = {
      id: randomUUID(),
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      role,
      passwordHash: password ? hashPassword(password) : null,
      mustChangePassword: Boolean(password),
      expiresAt: null,
      session: null,
      createdAt: new Date(this.now()).toISOString(),
    };
    this.users.set(user.id, user);
    this.#save();
    return { user: this.view(user), tempPassword: password };
  }

  /**
   * Sunucu ilk açıldığında sahip hesabı yoksa oluşturur. Şifre verilmezse rastgele
   * üretilip döndürülür (konsola bir kez yazılır); sabit bir varsayılan şifre yoktur.
   */
  ensureOwner({ phone, password, name = 'Sahip', email }) {
    if (this.hasOwner()) return null;
    const { user } = this.create({ name, phone, email: email || undefined, role: 'owner' });
    const finalPassword = password || randomBytes(9).toString('base64url');
    const u = this.users.get(user.id);
    u.passwordHash = hashPassword(finalPassword);
    u.mustChangePassword = !password; // rastgele şifreyle açıldıysa ilk girişte değiştirilsin
    this.#save();
    return { user: this.view(u), password: password ? null : finalPassword };
  }

  #startSession(user, via) {
    const token = randomBytes(32).toString('base64url');
    user.session = sha256(token);
    user.sessionVia = via;
    user.lastLoginAt = new Date(this.now()).toISOString();
    this.#save();
    return { token, user: this.view(user) };
  }

  /** E-posta ya da telefon numarasıyla kullanıcı (hiçbirine uymuyorsa null). */
  findByLogin(login) {
    const value = String(login ?? '').trim();
    try {
      return value.includes('@') ? this.findByEmail(normalizeEmail(value)) : this.findByPhone(normalizePhone(value));
    } catch {
      return null;
    }
  }

  /** E-posta ya da telefon + şifre. Doğruysa yeni oturum açar, eskisi kapanır. */
  login(login, password) {
    const user = this.findByLogin(login);
    if (user && !user.passwordHash) {
      throw new UserError(400, 'Bu hesabın şifresi yok. "E-posta koduyla giriş" ile girin ya da "Şifremi unuttum" ile şifre belirleyin.');
    }
    if (!user || !verifyPassword(String(password ?? ''), user.passwordHash)) {
      throw new UserError(401, 'E-posta / telefon ya da şifre hatalı');
    }
    return this.#startSession(user, 'password');
  }

  /**
   * Kayıt, 1. adım: bilgiler denetlenir ve doğrulama kodu üretilir; hesap henüz açılmaz.
   * Aynı e-postayla tekrar istenirse önceki bekleyen kayıt ve kodu geçersiz olur.
   */
  startRegistration({ name, email, phone, password }) {
    const cleanName = String(name ?? '').trim().slice(0, 80);
    if (!cleanName) throw new UserError(400, 'Ad soyad girin');
    const cleanEmail = normalizeEmail(email);
    const cleanPhone = normalizePhone(phone);
    const pw = String(password ?? '');
    if (pw.length < MIN_PASSWORD) throw new UserError(400, `Şifre en az ${MIN_PASSWORD} karakter olmalı`);
    if (this.findByEmail(cleanEmail)) throw new UserError(409, 'Bu e-posta ile kayıtlı bir hesap var. Giriş yapın.');
    if (this.findByPhone(cleanPhone)) throw new UserError(409, 'Bu telefon numarasıyla kayıtlı bir hesap var. Giriş yapın.');
    const code = newCode();
    this.pending.set(cleanEmail, {
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      passwordHash: hashPassword(pw),
      code: { hash: sha256(`reg:${cleanEmail}:${code}`), expiresAt: this.now() + CODE_TTL_MS, attempts: 0 },
    });
    return { email: cleanEmail, code };
  }

  /** Kayıt, 2. adım: kod doğruysa üye hesabı açılır ve oturum başlar. */
  completeRegistration(email, code) {
    let cleanEmail;
    try {
      cleanEmail = normalizeEmail(email);
    } catch {
      cleanEmail = null;
    }
    const reg = cleanEmail && this.pending.get(cleanEmail);
    this.#checkCode(reg, 'code', `reg:${cleanEmail}`, code, () => this.pending.delete(cleanEmail));
    this.pending.delete(cleanEmail);
    // Bu arada aynı bilgilerle hesap açıldıysa (ör. sahip ekledi) ikinci hesap açılmaz.
    if (this.findByEmail(reg.email) || this.findByPhone(reg.phone)) {
      throw new UserError(409, 'Bu bilgilerle kayıtlı bir hesap var. Giriş yapın.');
    }
    const user = {
      id: randomUUID(),
      name: reg.name,
      email: reg.email,
      phone: reg.phone,
      role: 'member',
      passwordHash: reg.passwordHash,
      mustChangePassword: false,
      expiresAt: null,
      session: null,
      selfRegistered: true,
      createdAt: new Date(this.now()).toISOString(),
    };
    this.users.set(user.id, user);
    return this.#startSession(user, 'register');
  }

  /**
   * Kod denetimi (giriş, kayıt, şifre yenileme). `holder[key]` kod kaydıdır; 10 dakika ve 5
   * deneme geçerlidir. Geçersizse `drop` ile kod silinir ve hata fırlatılır.
   */
  #checkCode(holder, key, prefix, code, drop = () => (holder[key] = null)) {
    const entry = holder?.[key];
    if (!entry) throw new UserError(401, 'Kod hatalı ya da süresi dolmuş. Yeni kod isteyin.');
    if (entry.expiresAt <= this.now()) {
      drop();
      this.#save();
      throw new UserError(401, 'Kodun süresi doldu. Yeni kod isteyin.');
    }
    entry.attempts += 1;
    const clean = String(code ?? '').trim();
    const ok = /^\d{6}$/.test(clean) && timingSafeEqual(Buffer.from(sha256(`${prefix}:${clean}`)), Buffer.from(entry.hash));
    if (!ok) {
      if (entry.attempts >= CODE_MAX_ATTEMPTS) drop();
      this.#save();
      throw new UserError(401, entry.attempts >= CODE_MAX_ATTEMPTS ? 'Çok fazla hatalı deneme. Yeni kod isteyin.' : 'Kod hatalı');
    }
  }

  /**
   * E-postaya gidecek giriş kodunu üretir. Kayıtlı olmayan adres için null döner (çağıran
   * yine aynı cevabı verir; kimin üye olduğu dışarıdan anlaşılmasın). Yeni kod eskisini geçersiz kılar.
   */
  createEmailCode(email) {
    const user = this.findByEmail(normalizeEmail(email));
    if (!user) return null;
    const code = newCode();
    user.emailCode = { hash: sha256(`${user.id}:${code}`), expiresAt: this.now() + CODE_TTL_MS, attempts: 0 };
    this.#save();
    return { user, code };
  }

  /** E-posta + kod doğruysa oturum açar. Kod 10 dakika ve 5 deneme geçerlidir, tek kullanımlıktır. */
  loginWithEmailCode(email, code) {
    const user = this.#userForCode(email);
    this.#checkCode(user, 'emailCode', user?.id, code);
    user.emailCode = null;
    return this.#startSession(user, 'email');
  }

  /** Şifremi unuttum: e-postaya gelen kodla yeni şifre belirlenir ve oturum açılır. */
  resetPasswordWithCode(email, code, newPassword) {
    const pw = String(newPassword ?? '');
    if (pw.length < MIN_PASSWORD) throw new UserError(400, `Şifre en az ${MIN_PASSWORD} karakter olmalı`);
    const user = this.#userForCode(email);
    this.#checkCode(user, 'emailCode', user?.id, code);
    user.emailCode = null;
    user.passwordHash = hashPassword(pw);
    user.mustChangePassword = false;
    return this.#startSession(user, 'password');
  }

  #userForCode(email) {
    try {
      return this.findByEmail(normalizeEmail(email)) ?? null;
    } catch {
      return null;
    }
  }

  byToken(token) {
    if (!token) return null;
    const hash = sha256(token);
    return [...this.users.values()].find((u) => u.session === hash) ?? null;
  }

  logout(id) {
    const user = this.users.get(id);
    if (!user) return;
    user.session = null;
    this.#save();
  }

  changePassword(id, newPassword) {
    const user = this.users.get(id);
    const pw = String(newPassword ?? '');
    if (pw.length < MIN_PASSWORD) throw new UserError(400, `Şifre en az ${MIN_PASSWORD} karakter olmalı`);
    if (user.mustChangePassword && verifyPassword(pw, user.passwordHash)) {
      throw new UserError(400, 'Yeni şifre geçici şifreyle aynı olamaz');
    }
    user.passwordHash = hashPassword(pw);
    user.mustChangePassword = false;
    this.#save();
    return this.view(user);
  }

  /** Yeni geçici şifre verir ve açık oturumu kapatır (yalnızca yönetici; üyeler şifre kullanmaz). */
  resetPassword(id) {
    const user = this.#mustGet(id);
    if (user.role === 'member') throw new UserError(400, 'Üyeler şifre kullanmaz; e-postalarına gelen kodla girerler');
    const password = tempPassword();
    user.passwordHash = hashPassword(password);
    user.mustChangePassword = true;
    user.session = null;
    this.#save();
    return { user: this.view(user), tempPassword: password };
  }

  /** Üyeye gün ekler: süresi devam ediyorsa bitişin üstüne, bittiyse şimdiden itibaren. */
  extend(id, days) {
    const user = this.#mustGet(id);
    if (user.role !== 'member') throw new UserError(400, 'Süre yalnızca üyelere tanımlanır');
    if (!EXTEND_DAYS.has(days)) throw new UserError(400, 'Süre 1, 3 ya da 7 gün olabilir');
    const base = Math.max(this.now(), user.expiresAt ?? 0);
    user.expiresAt = base + days * DAY_MS;
    this.#save();
    return this.view(user);
  }

  /** Üyenin süresini hemen bitirir. */
  expire(id) {
    const user = this.#mustGet(id);
    if (user.role !== 'member') throw new UserError(400, 'Süre yalnızca üyelere tanımlanır');
    user.expiresAt = this.now();
    this.#save();
    return this.view(user);
  }

  remove(id) {
    const user = this.#mustGet(id);
    if (user.role === 'owner') throw new UserError(400, 'Sahip hesabı silinemez');
    this.users.delete(id);
    this.#save();
    return this.view(user);
  }

  /**
   * Mağaza satın alımı (RevenueCat bildirimi): ürünün günü kadar süre ekler. Aynı işlem
   * (transactionId) ikinci kez gelirse yok sayılır. Sonuç: { user, applied } ya da null (kullanıcı yok).
   */
  applyPurchase({ userId, productId, transactionId, store = null }) {
    const user = this.users.get(userId);
    if (!user) return null;
    const days = PRODUCTS[productId];
    if (!days) throw new UserError(400, `Bilinmeyen ürün: ${productId}`);
    user.purchases ??= [];
    if (user.purchases.some((p) => p.transactionId === transactionId)) return { user: this.view(user), applied: false };
    const base = Math.max(this.now(), user.expiresAt ?? 0);
    user.expiresAt = base + days * DAY_MS;
    user.purchases.push({ transactionId, productId, days, store, at: new Date(this.now()).toISOString() });
    this.#save();
    return { user: this.view(user), applied: true };
  }

  /** İade edilen satın alımın günlerini geri alır (süre şimdiden geriye düşmez). */
  refundPurchase({ userId, transactionId }) {
    const user = this.users.get(userId);
    const purchase = user?.purchases?.find((p) => p.transactionId === transactionId);
    if (!purchase || purchase.refunded) return null;
    purchase.refunded = true;
    user.expiresAt = Math.max(this.now(), (user.expiresAt ?? 0) - purchase.days * DAY_MS);
    this.#save();
    return { user: this.view(user) };
  }

  #mustGet(id) {
    const user = this.users.get(id);
    if (!user) throw new UserError(404, 'Kullanıcı bulunamadı');
    return user;
  }
}
