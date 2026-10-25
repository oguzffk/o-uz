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
 * Giriş: üyeler e-postalarına gelen 6 haneli kodla girer (şifre yok). Sahip ve yöneticiler
 * de e-posta koduyla girebilir; e-posta çalışmazsa diye telefon + şifre yedek olarak kalır.
 * Şifreler scrypt ile tuzlanıp saklanır, kodların yalnızca özeti tutulur. Oturum anahtarı
 * yalnızca girişte bir kez döner; dosyada sha256 özeti tutulur. Bir hesap aynı anda tek
 * cihazda açıktır: yeni giriş eski oturumu kapatır.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;
export const EXTEND_DAYS = new Set([1, 3, 7]);
const MIN_PASSWORD = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;

export const DEFAULT_SETTINGS = {
  iban: '',
  accountName: '',
  whatsapp: '',
  prices: { day1: '119,99 TL', day3: '299,99 TL', week1: '559,99 TL' },
};

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
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.#load();
  }

  #load() {
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
      for (const u of data.users ?? []) this.users.set(u.id, u);
      this.settings = { ...this.settings, ...data.settings, prices: { ...this.settings.prices, ...data.settings?.prices } };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  #save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify({ users: [...this.users.values()], settings: this.settings }, null, 2), { mode: 0o600 });
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

  /** Telefon + şifre (sahip ve yöneticinin yedek girişi). Doğruysa yeni oturum açar, eskisi kapanır. */
  login(phone, password) {
    let user;
    try {
      user = this.findByPhone(normalizePhone(phone));
    } catch {
      user = null;
    }
    if (!user?.passwordHash || !verifyPassword(String(password ?? ''), user.passwordHash)) {
      throw new UserError(401, 'Telefon numarası ya da şifre hatalı');
    }
    if (user.role === 'member') throw new UserError(400, 'Üyeler e-postalarına gelen kodla giriş yapar');
    return this.#startSession(user, 'password');
  }

  /**
   * E-postaya gidecek giriş kodunu üretir. Kayıtlı olmayan adres için null döner (çağıran
   * yine aynı cevabı verir; kimin üye olduğu dışarıdan anlaşılmasın). Yeni kod eskisini geçersiz kılar.
   */
  createEmailCode(email) {
    const user = this.findByEmail(normalizeEmail(email));
    if (!user) return null;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    user.emailCode = { hash: sha256(`${user.id}:${code}`), expiresAt: this.now() + CODE_TTL_MS, attempts: 0 };
    this.#save();
    return { user, code };
  }

  /** E-posta + kod doğruysa oturum açar. Kod 10 dakika ve 5 deneme geçerlidir, tek kullanımlıktır. */
  loginWithEmailCode(email, code) {
    let user;
    try {
      user = this.findByEmail(normalizeEmail(email));
    } catch {
      user = null;
    }
    const entry = user?.emailCode;
    if (!entry) throw new UserError(401, 'Kod hatalı ya da süresi dolmuş. Yeni kod isteyin.');
    if (entry.expiresAt <= this.now()) {
      user.emailCode = null;
      this.#save();
      throw new UserError(401, 'Kodun süresi doldu. Yeni kod isteyin.');
    }
    entry.attempts += 1;
    const ok = /^\d{6}$/.test(String(code ?? '').trim()) && timingSafeEqual(Buffer.from(sha256(`${user.id}:${String(code).trim()}`)), Buffer.from(entry.hash));
    if (!ok) {
      if (entry.attempts >= CODE_MAX_ATTEMPTS) user.emailCode = null;
      this.#save();
      throw new UserError(401, entry.attempts >= CODE_MAX_ATTEMPTS ? 'Çok fazla hatalı deneme. Yeni kod isteyin.' : 'Kod hatalı');
    }
    user.emailCode = null;
    return this.#startSession(user, 'email');
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
    if (user.role === 'member') throw new UserError(400, 'Üyeler şifre kullanmaz; e-postalarına gelen kodla girerler');
    const pw = String(newPassword ?? '');
    if (pw.length < MIN_PASSWORD) throw new UserError(400, `Şifre en az ${MIN_PASSWORD} karakter olmalı`);
    if (/^\d{6}$/.test(pw) && verifyPassword(pw, user.passwordHash)) {
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

  updateSettings(patch) {
    const s = this.settings;
    const str = (v, max) => String(v ?? '').trim().slice(0, max);
    if (patch.iban !== undefined) s.iban = str(patch.iban, 40);
    if (patch.accountName !== undefined) s.accountName = str(patch.accountName, 80);
    if (patch.whatsapp !== undefined) s.whatsapp = patch.whatsapp ? normalizePhone(patch.whatsapp) : '';
    for (const k of Object.keys(DEFAULT_SETTINGS.prices)) {
      if (patch.prices?.[k] !== undefined) s.prices[k] = str(patch.prices[k], 20);
    }
    this.#save();
    return s;
  }

  #mustGet(id) {
    const user = this.users.get(id);
    if (!user) throw new UserError(404, 'Kullanıcı bulunamadı');
    return user;
  }
}
