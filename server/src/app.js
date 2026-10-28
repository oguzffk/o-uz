import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { ValhallaError } from './valhalla.js';
import { decodePolyline } from './geo.js';
import { adjustedTime, trafficPeriod } from './traffic.js';
import { fixStreetSuffixes } from './turkish.js';
import { ClosureStore } from './closures.js';
import { PRODUCTS, UserError, normalizeEmail, normalizePhone } from './users.js';
import { PRIVACY, TERMS, privacyHtml } from './privacy.js';
import { searchPlaces } from './search.js';

// İstanbul il sınırını kabaca kapsayan kutu (indirme betiğiyle aynı).
export const ISTANBUL_BBOX = { minLon: 27.95, minLat: 40.78, maxLon: 29.95, maxLat: 41.6 };
const COSTINGS = new Set(['auto', 'motorcycle']);
// Dokunulan nokta en yakın yoldan bundan uzaksa "yol bulunamadı" denir.
const MAX_SNAP_METERS = 40;
// Dokunulan nokta kapalı bir yola bu kadar yakınsa (metre) yeni yol kapatmak yerine o yol açılır;
// bulunan en yakın yoldan en fazla BIAS kadar uzak olmalı (yan yana şeritlerde diğerini kapatabilmek için).
const REOPEN_TAP_METERS = 25;
const REOPEN_BIAS_METERS = 8;

function parsePoint(p, label) {
  const lat = Number(p?.lat);
  const lon = Number(p?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new HttpError(400, `${label} için geçerli lat/lon gerekli`);
  }
  const b = ISTANBUL_BBOX;
  if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) {
    throw new HttpError(400, `${label} İstanbul sınırları dışında`);
  }
  return { lat, lon };
}

// Valhalla'nın varış manevraları (düz, sağda, solda). Ara durakların sonundakiler "Ara durak" olarak yazılır.
const ARRIVAL_TYPES = new Set([4, 5, 6]);
export const MAX_STOPS = 3;

/**
 * Valhalla trip'ini uygulamanın rota biçimine çevirir; süreler yoğun saate göre ayarlanır.
 * Ara durak varsa her durak ayrı bir "leg" olarak gelir; bacaklar tek çizgide birleştirilir,
 * manevra ve hız sınırı indeksleri birleşik çizgiye göre kaydırılır.
 */
function buildRoute(trip, periodKey, legSpeedLimits = [], legLanes = []) {
  const coordinates = [];
  const maneuvers = [];
  const stops = [];
  const speedLimits = [];
  trip.legs.forEach((leg, li) => {
    const offset = coordinates.length;
    const coords = decodePolyline(leg.shape);
    coordinates.push(...coords);
    const lastLeg = li === trip.legs.length - 1;
    leg.maneuvers.forEach((m, mi) => {
      const isStop = !lastLeg && ARRIVAL_TYPES.has(m.type);
      const lanes = isStop ? null : legLanes[li]?.[mi];
      maneuvers.push({
        type: m.type,
        instruction: isStop ? `${li + 1}. ara durağa varış` : fixStreetSuffixes(m.instruction),
        verbalPre: isStop
          ? `${li + 1}. ara durağa varmak üzeresiniz.`
          : fixStreetSuffixes(m.verbal_pre_transition_instruction ?? m.instruction),
        verbalAlert: isStop ? null : fixStreetSuffixes(m.verbal_transition_alert_instruction ?? null),
        streetNames: m.street_names ?? [],
        distanceKm: m.length,
        durationSec: Math.round(adjustedTime(m.length, m.time, periodKey)),
        beginShapeIndex: m.begin_shape_index + offset,
        endShapeIndex: m.end_shape_index + offset,
        ...(isStop ? { stop: li + 1 } : {}),
        ...(lanes ? { lanes } : {}),
      });
    });
    if (!lastLeg) stops.push({ shapeIndex: coordinates.length - 1 });
    for (const r of legSpeedLimits[li] ?? []) speedLimits.push({ from: r.from + offset, to: r.to + offset, kph: r.kph });
  });
  return {
    distanceKm: trip.summary.length,
    hasToll: Boolean(trip.summary.has_toll),
    durationSec: maneuvers.reduce((sum, m) => sum + m.durationSec, 0),
    freeFlowDurationSec: Math.round(trip.summary.time),
    coordinates,
    maneuvers,
    stops,
    speedLimits,
  };
}

/**
 * Bir rota bacağının hız sınırları (OSM maxspeed etiketi): [{ from, to, kph }] — from/to bacak
 * çizgisindeki nokta indeksleri. Valhalla rotada hız sınırı vermiyor; aynı çizgi trace_attributes'a
 * "edge_walk" ile verilip her yol parçasının sınırı alınır. Sınırı bilinmeyen yerler listede yoktur.
 * Hız sınırı yardımcı bilgi olduğundan hata olursa rota yine döner (boş liste).
 */
export async function legSpeedLimits(valhalla, leg, costing) {
  try {
    const data = await valhalla.traceAttributes({
      encoded_polyline: leg.shape,
      costing,
      shape_match: 'edge_walk',
      filters: {
        attributes: ['edge.speed_limit', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape'],
        action: 'include',
      },
    });
    // İndeksler Valhalla'nın döndürdüğü çizgiye göre; rotanınkiyle aynı değilse eşleme güvenilmez.
    if (!data.shape || decodePolyline(data.shape).length !== decodePolyline(leg.shape).length) return [];
    const runs = [];
    for (const e of data.edges ?? []) {
      const kph = e.speed_limit;
      if (!(kph > 0 && kph < 200)) continue; // bilinmiyor ya da "sınırsız"
      const prev = runs[runs.length - 1];
      if (prev && prev.kph === kph && prev.to === e.begin_shape_index) prev.to = e.end_shape_index;
      else runs.push({ from: e.begin_shape_index, to: e.end_shape_index, kph });
    }
    return runs;
  } catch {
    return [];
  }
}

/**
 * Şerit bilgisi (OSM turn:lanes). Valhalla bunu yalnızca OSRM biçimli çıktıda veriyor; aynı
 * istek o biçimde bir kez daha sorulur ve her manevranın kavşağındaki şeritler alınır.
 * Sonuç: [rota][bacak][manevra] → şeritler ya da null. Hata olursa şeritsiz devam edilir.
 */
async function routeLanes(valhalla, body, trips) {
  try {
    const data = await valhalla.route({ ...body, format: 'osrm' });
    return trips.map((trip, ti) =>
      trip.legs.map((leg, li) => {
        const steps = data.routes?.[ti]?.legs?.[li]?.steps ?? [];
        // Adımlar manevralarla bire bir eşleşmiyorsa (farklı rota) şerit gösterme.
        if (steps.length !== leg.maneuvers.length) return [];
        return steps.map((st) => simplifyLanes(st.intersections?.[0]?.lanes));
      }),
    );
  } catch {
    return [];
  }
}

// { indications, valid, active } → { dirs, ok, best }; tüm şeritler uygunsa göstermeye gerek yok.
function simplifyLanes(lanes) {
  if (!Array.isArray(lanes) || lanes.length < 2) return null;
  const out = lanes.map((l) => ({
    dirs: (l.indications ?? []).filter((d) => d !== 'none'),
    ok: Boolean(l.valid),
    best: Boolean(l.active),
    ...(l.valid_indication ? { use: l.valid_indication } : {}),
  }));
  return out.every((l) => l.ok) || !out.some((l) => l.ok) ? null : out;
}

// Valhalla "rota yok" hataları: 442 yol bulunamadı, 170 bağlantısız bölgeler, 171 yakında uygun yol yok.
const NO_ROUTE_CODES = new Set([442, 170, 171]);

/**
 * Arama sonuçları büyük alanların (havalimanı, AVM, park) ortasına düşebilir; Valhalla o noktayı
 * dışarıdan girilemeyen bir iç yola bağlayınca rota çıkmaz. Böyle olursa noktaları önce en yakın
 * halka açık yola (servis yolları hariç), olmazsa en yakın ana yola bağlayarak tekrar dener.
 */
async function routeWithFallback(valhalla, body) {
  const attempts = [null, 'residential', 'tertiary'];
  for (const [i, minRoadClass] of attempts.entries()) {
    const locations = minRoadClass
      ? body.locations.map((l) => ({ ...l, search_filter: { min_road_class: minRoadClass } }))
      : body.locations;
    try {
      const used = { ...body, locations };
      return { data: await valhalla.route(used), snappedToRoad: Boolean(minRoadClass), body: used };
    } catch (err) {
      const retryable = err instanceof ValhallaError && NO_ROUTE_CODES.has(err.details?.error_code);
      if (!retryable || i === attempts.length - 1) throw err;
    }
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Şifre deneme sınırı: aynı telefona 5, aynı IP'den 20 hatalı denemeden sonra 15 dakika bekleme.
const LOGIN_LIMITS = { phone: 5, ip: 20 };
const LOGIN_LOCK_MS = 15 * 60 * 1000;

function createLoginLimiter(now) {
  const fails = new Map(); // anahtar → { count, until }
  const keys = (phone, ip) => [
    [`p:${phone}`, LOGIN_LIMITS.phone],
    [`ip:${ip}`, LOGIN_LIMITS.ip],
  ];
  return {
    check(phone, ip) {
      for (const [k] of keys(phone, ip)) {
        if ((fails.get(k)?.until ?? 0) > now()) {
          throw new UserError(429, 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.');
        }
      }
    },
    fail(phone, ip) {
      for (const [k, limit] of keys(phone, ip)) {
        const e = fails.get(k) ?? { count: 0, until: 0 };
        if (e.until && e.until <= now()) Object.assign(e, { count: 0, until: 0 });
        e.count += 1;
        if (e.count >= limit) e.until = now() + LOGIN_LOCK_MS;
        fails.set(k, e);
      }
    },
    success(phone) {
      fails.delete(`p:${phone}`);
    },
  };
}

// Giriş kodu isteme sınırı: aynı e-postaya dakikada 1, saatte 5; aynı IP'den saatte 30 istek.
function createCodeLimiter(now) {
  const sent = new Map(); // anahtar → zaman damgaları
  const recent = (key, windowMs) => (sent.get(key) ?? []).filter((t) => t > now() - windowMs);
  const limiter = {
    check(email, ip) {
      const e = recent(`e:${email}`, 3600000);
      const i = recent(`ip:${ip}`, 3600000);
      if (e.some((t) => t > now() - 60000)) throw new UserError(429, 'Yeni kod için 1 dakika bekleyin.');
      if (e.length >= 5 || i.length >= 30) throw new UserError(429, 'Çok fazla kod istendi. Bir saat sonra tekrar deneyin.');
    },
    record(email, ip) {
      sent.set(`e:${email}`, [...recent(`e:${email}`, 3600000), now()]);
      sent.set(`ip:${ip}`, [...recent(`ip:${ip}`, 3600000), now()]);
    },
    take(email, ip) {
      limiter.check(email, ip);
      limiter.record(email, ip);
    },
  };
  return limiter;
}

export function createApp({
  valhalla,
  store,
  users,
  mailer = { configured: false, sendLoginCode: async () => {} },
  hereApiKey = null, // varsa adres arama HERE'den yapılır (siteler, işletmeler daha eksiksiz)
  reports = null, // kullanıcı bildirimleri (ReportStore); verilmezse bildirim uçları kapalı
  fetchImpl = fetch,
  now = () => Date.now(),
  revenuecat = { webhookAuth: null, allowSandbox: false },
}) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  // Mobil uygulama ve yönetici sayfası farklı adreslerden erişebilsin.
  app.use((req, res, next) => {
    res.set('access-control-allow-origin', '*');
    res.set('access-control-allow-headers', 'content-type, authorization');
    res.set('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // --- Oturum ve yetki ---
  // Oturum anahtarı "Authorization: Bearer ..." başlığıyla gelir (SSE için ?token= de kabul edilir).
  app.use((req, res, next) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : typeof req.query.token === 'string' ? req.query.token : null;
    req.user = users.byToken(token);
    next();
  });
  // Giriş yapmış, şifresini belirlemiş ve (üyeyse) süresi devam eden kullanıcı.
  const requireActive = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Oturum açın', code: 'auth' });
    if (users.view(req.user).mustChangePassword) return res.status(403).json({ error: 'Önce kendi şifrenizi belirleyin', code: 'password' });
    if (!users.isActive(req.user)) return res.status(402).json({ error: 'Kullanım süreniz doldu', code: 'expired' });
    next();
  };
  const requireRole =
    (...roles) =>
    (req, res, next) => {
      if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Bu işlem için yetkiniz yok', code: 'forbidden' });
      next();
    };
  const staff = [requireActive, requireRole('owner', 'admin')]; // yol kapatma ve gruplar
  const owner = [requireActive, requireRole('owner')]; // üyeler, süreler, yöneticiler
  const limiter = createLoginLimiter(now);
  const codeLimiter = createCodeLimiter(now);

  const sendCode = async (email, code, kind) => {
    try {
      await mailer.sendLoginCode(email, code, kind);
    } catch (err) {
      console.error('E-posta gönderilemedi:', err.message);
      throw new UserError(502, 'Kod e-postası gönderilemedi. Biraz sonra tekrar deneyin.');
    }
  };

  // Kayıt ol, 1. adım: ad, e-posta, telefon ve şifre denetlenir; e-postaya doğrulama kodu gider.
  app.post('/api/auth/register', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      codeLimiter.check(email, req.ip);
      const reg = users.startRegistration({ ...req.body, privacyVersion: PRIVACY.version, termsVersion: TERMS.version });
      codeLimiter.record(email, req.ip);
      await sendCode(reg.email, reg.code, 'register');
      res.json({ ok: true, email: reg.email });
    } catch (err) {
      next(err);
    }
  });

  // Kayıt ol, 2. adım: kod doğruysa hesap açılır ve oturum başlar (süre yok; paket satın alınır).
  app.post('/api/auth/register/verify', (req, res, next) => {
    try {
      res.json(users.completeRegistration(req.body.email, req.body.code));
    } catch (err) {
      next(err);
    }
  });

  // E-posta ile giriş ya da şifremi unuttum, 1. adım: kayıtlı adrese 6 haneli kod gönderilir.
  // Adres kayıtlı olmasa da cevap aynıdır (kimin üye olduğu anlaşılmasın).
  app.post('/api/auth/email-code', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      codeLimiter.take(email, req.ip);
      const issued = users.createEmailCode(email);
      if (issued) await sendCode(email, issued.code, req.body.purpose === 'reset' ? 'reset' : 'login');
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // E-posta ile giriş, 2. adım: kod doğruysa oturum açılır (aynı hesabın eski oturumu kapanır).
  app.post('/api/auth/email-login', (req, res, next) => {
    try {
      const result = users.loginWithEmailCode(req.body.email, req.body.code);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // Şifremi unuttum, 2. adım: e-postaya gelen kod + yeni şifre; doğruysa oturum açılır.
  app.post('/api/auth/reset-password', (req, res, next) => {
    try {
      res.json(users.resetPasswordWithCode(req.body.email, req.body.code, req.body.newPassword));
    } catch (err) {
      next(err);
    }
  });

  // E-posta ya da telefon + şifre (eski uygulama sürümleri `phone` gönderir).
  app.post('/api/auth/login', (req, res, next) => {
    const login = String(req.body.login ?? req.body.phone ?? '').trim();
    const found = users.findByLogin(login);
    const key = found ? found.id : login.toLowerCase(); // aynı hesabın e-posta ve telefonu tek sayılır
    try {
      limiter.check(key, req.ip);
      const result = users.login(login, req.body.password);
      limiter.success(key);
      res.json(result);
    } catch (err) {
      if (err instanceof UserError && err.status === 401) limiter.fail(key, req.ip);
      next(err);
    }
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Oturum açın', code: 'auth' });
    res.json({ user: users.view(req.user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.user) users.logout(req.user.id);
    res.json({ ok: true });
  });

  // Hesabımı sil: oturumdaki kullanıcı kendi hesabını kalıcı olarak siler (şifresi varsa şifreyle).
  app.delete('/api/auth/account', (req, res, next) => {
    try {
      if (!req.user) throw new UserError(401, 'Oturum açın', 'auth');
      users.deleteSelf(req.user.id, req.body?.password);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Gizlilik Politikası / KVKK ve Kullanım Koşulları (mağaza sayfalarına bu adres yazılır).
  app.get(['/gizlilik', '/privacy', '/kosullar'], (req, res) => {
    res.type('html').send(privacyHtml());
  });

  app.post('/api/auth/password', (req, res, next) => {
    try {
      if (!req.user) throw new UserError(401, 'Oturum açın', 'auth');
      res.json({ user: users.changePassword(req.user.id, req.body.newPassword) });
    } catch (err) {
      next(err);
    }
  });

  // --- Mağaza satın alımları ---
  // Ödeme App Store / Google Play'de alınır; RevenueCat satın alımı doğrulayıp bu adrese bildirir.
  // Uygulama RevenueCat'e kullanıcıyı bizim kullanıcı kimliğimizle (app_user_id) tanıtır.
  // Bildirim, RevenueCat panelinde girilen gizli anahtarla (Authorization başlığı) gelmelidir.
  app.get('/api/products', (req, res) => {
    res.json({ products: Object.entries(PRODUCTS).map(([id, days]) => ({ id, days })) });
  });

  app.post('/api/webhooks/revenuecat', (req, res, next) => {
    try {
      const expected = revenuecat.webhookAuth;
      if (!expected) return res.status(503).json({ error: 'Satın alma bildirimi ayarlı değil' });
      const got = req.get('authorization') ?? '';
      const a = Buffer.from(got);
      const b = Buffer.from(`Bearer ${expected}`);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'Yetkisiz' });
      const event = req.body?.event ?? {};
      // Mağazanın deneme (sandbox) satın alımları yalnızca açıkça izin verilirse süre ekler.
      if (event.environment === 'SANDBOX' && !revenuecat.allowSandbox) return res.json({ ignored: 'sandbox' });
      const userId = event.app_user_id;
      const transactionId = event.transaction_id ?? event.id;
      if (event.type === 'NON_RENEWING_PURCHASE') {
        if (!PRODUCTS[event.product_id]) return res.json({ ignored: 'unknown-product' });
        const r = users.applyPurchase({ userId, productId: event.product_id, transactionId, store: event.store ?? null });
        return res.json(r ? { applied: r.applied } : { ignored: 'unknown-user' });
      }
      if (event.type === 'CANCELLATION') {
        // Tek seferlik ürünlerde CANCELLATION = iade.
        const r = users.refundPurchase({ userId, transactionId });
        return res.json(r ? { refunded: true } : { ignored: 'unknown-purchase' });
      }
      res.json({ ignored: event.type ?? 'unknown' });
    } catch (err) {
      next(err);
    }
  });

  // --- Üyeler ve yöneticiler (yalnızca sahip) ---
  const userAction = (fn) => (req, res, next) => {
    try {
      res.json(fn(req));
    } catch (err) {
      next(err);
    }
  };
  app.get('/api/users', ...owner, userAction((req) => ({ users: users.list(req.query.role) })));
  app.post(
    '/api/users',
    ...owner,
    userAction((req) =>
      users.create({ name: req.body.name, email: req.body.email, phone: req.body.phone, role: req.body.role === 'admin' ? 'admin' : 'member' }),
    ),
  );
  app.post('/api/users/:id/extend', ...owner, userAction((req) => ({ user: users.extend(req.params.id, Number(req.body.days)) })));
  app.post('/api/users/:id/expire', ...owner, userAction((req) => ({ user: users.expire(req.params.id) })));
  app.post('/api/users/:id/reset-password', ...owner, userAction((req) => users.resetPassword(req.params.id)));
  app.delete('/api/users/:id', ...owner, userAction((req) => ({ user: users.remove(req.params.id) })));

  app.get('/api/health', async (req, res) => {
    let valhallaStatus = null;
    try {
      valhallaStatus = await valhalla.status();
    } catch {
      // Valhalla henüz ayakta değilse API yine de cevap versin.
    }
    res.json({ ok: true, valhalla: valhallaStatus, closuresVersion: store.version });
  });

  // closures: şu an trafiğe kapalı tüm segmentler (tekil + aktif gruplar).
  // zones: kayıtlı gruplar, kapalı olsun olmasın segmentleriyle birlikte.
  app.get('/api/closures', requireActive, (req, res) => {
    res.json({ version: store.version, closures: store.effectiveClosures(), zones: store.listZones() });
  });

  // Yönetici sayfası için canlı değişiklik akışı (Server-Sent Events).
  app.get('/api/closures/stream', ...staff, (req, res) => {
    res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.flushHeaders();
    const send = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);
    send({ type: 'hello', version: store.version });
    store.on('change', send);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      store.off('change', send);
    });
  });

  // Haritada dokunulan noktadaki sokak segmentini kapatır; zaten kapalıysa açar.
  app.post('/api/closures/toggle', ...staff, async (req, res, next) => {
    try {
      const point = parsePoint(req.body, 'Nokta');
      const edge = await valhalla.locateEdge(point);
      const edgeOk = edge && edge.distanceMeters <= MAX_SNAP_METERS;
      // Kapalı yola tekrar dokununca kesin açılsın: en yakın yol (Valhalla) kavşakta ya da çizginin
      // biraz yanına dokununca yandaki sokak çıkabiliyor, o zaman açmak yerine onu kapatıyordu.
      // Dokunulan noktanın yakınında kapalı yol varsa ve bulunan yoldan belirgin uzak değilse o açılır.
      const near = store.nearestClosed([point.lat, point.lon], REOPEN_TAP_METERS);
      const edgeClosed = edgeOk && store.effectiveClosures().some((c) => c.id === ClosureStore.idForShape(edge.shapeEncoded));
      if (near && !edgeClosed && (!edgeOk || near.distance <= edge.distanceMeters + REOPEN_BIAS_METERS)) {
        const target = near.closure;
        if (target.zoneId && !store.get(target.id)) {
          throw new HttpError(409, `Bu yol "${target.zoneName}" grubuyla kapalı. Açmak için grubu trafiğe açın.`);
        }
        return res.json({ action: 'opened', closure: store.remove(target.id), version: store.version });
      }
      if (!edgeOk) throw new HttpError(404, 'Dokunulan yere yakın bir araç yolu bulunamadı');
      const id = ClosureStore.idForShape(edge.shapeEncoded);
      const zone = store.activeZoneOf(id);
      if (zone && !store.get(id)) {
        throw new HttpError(409, `Bu yol "${zone.name}" grubuyla kapalı. Açmak için grubu trafiğe açın.`);
      }
      if (store.get(id)) {
        res.json({ action: 'opened', closure: store.remove(id), version: store.version });
      } else {
        const closure = store.add(edge, { reason: String(req.body.reason ?? '').slice(0, 200) });
        res.json({ action: 'closed', closure, version: store.version });
      }
    } catch (err) {
      next(err);
    }
  });

  // --- Kullanıcı bildirimleri ---
  // Her aktif kullanıcı bulunduğu yerdeki yol çalışması, kaza vb. durumu bildirebilir; bu yolu
  // kapatmaz. Sahip ve yöneticiler bildirimleri görür, gerekirse yolu kendileri kapatır.
  app.post('/api/reports', requireActive, async (req, res, next) => {
    try {
      if (!reports) throw new HttpError(503, 'Bildirim alınamıyor');
      const point = parsePoint(req.body, 'Konum');
      const edge = await valhalla.locateEdge(point).catch(() => null);
      const road = edge && edge.distanceMeters <= MAX_SNAP_METERS ? edge.names.join(' / ') || null : null;
      const report = reports.add({ type: req.body.type, ...point, road, user: req.user });
      res.json({ report });
    } catch (err) {
      next(err.status && !(err instanceof HttpError) ? new HttpError(err.status, err.message) : err);
    }
  });

  app.get('/api/reports', ...staff, (req, res) => {
    res.json({ reports: reports ? reports.list() : [] });
  });

  // Bildirimi listeden kaldır (yoksay ya da yol kapatıldıktan sonra).
  app.delete('/api/reports/:id', ...staff, (req, res) => {
    const removed = reports?.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Bildirim bulunamadı' });
    res.json({ ok: true });
  });

  // Tüm yolları tek seferde trafiğe açar (gruplar silinmez, yalnızca açılır).
  app.post('/api/closures/open-all', ...staff, (req, res) => {
    res.json({ ...store.openAll(), version: store.version });
  });

  app.delete('/api/closures/:id', ...staff, (req, res) => {
    const closure = store.remove(req.params.id);
    if (!closure) return res.status(404).json({ error: 'Kapatma bulunamadı' });
    res.json({ action: 'opened', closure, version: store.version });
  });

  // --- Kayıtlı kapatma grupları ---
  const parseZoneName = (value) => {
    const name = String(value ?? '').trim().slice(0, 80);
    if (!name) throw new HttpError(400, 'Grup için bir isim girin');
    return name;
  };

  // Şu anki tekil kapatmaları (ya da closureIds ile seçilenleri) isimli bir grup olarak kaydeder.
  app.post('/api/zones', ...staff, (req, res, next) => {
    try {
      const name = parseZoneName(req.body.name);
      const ids = Array.isArray(req.body.closureIds) ? req.body.closureIds.map(String) : undefined;
      const zone = store.createZone(name, ids);
      if (!zone) throw new HttpError(400, 'Kaydedilecek kapalı yol yok. Önce haritada yolları kapatın.');
      res.status(201).json({ zone, version: store.version });
    } catch (err) {
      next(err);
    }
  });

  // { active: true } grubu trafiğe kapatır, { active: false } açar; { name } yeniden adlandırır.
  app.patch('/api/zones/:id', ...staff, (req, res, next) => {
    try {
      const patch = {};
      if (req.body.active !== undefined) patch.active = Boolean(req.body.active);
      if (req.body.name !== undefined) patch.name = parseZoneName(req.body.name);
      const zone = store.updateZone(req.params.id, patch);
      if (!zone) throw new HttpError(404, 'Grup bulunamadı');
      res.json({ zone, version: store.version });
    } catch (err) {
      next(err);
    }
  });

  // Grup düzenleme: dokunulan yol gruptaysa çıkarılır, değilse eklenir.
  app.post('/api/zones/:id/toggle-segment', ...staff, async (req, res, next) => {
    try {
      if (!store.getZone(req.params.id)) throw new HttpError(404, 'Grup bulunamadı');
      const point = parsePoint(req.body, 'Nokta');
      const edge = await valhalla.locateEdge(point);
      if (!edge || edge.distanceMeters > MAX_SNAP_METERS) {
        throw new HttpError(404, 'Dokunulan yere yakın bir araç yolu bulunamadı');
      }
      res.json({ ...store.toggleZoneSegment(req.params.id, edge), version: store.version });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/zones/:id', ...staff, (req, res) => {
    const zone = store.deleteZone(req.params.id);
    if (!zone) return res.status(404).json({ error: 'Grup bulunamadı' });
    res.json({ zone, version: store.version });
  });

  // Rota: kapalı segmentler her istekte exclude_polygons olarak Valhalla'ya gider.
  app.post('/api/route', requireActive, async (req, res, next) => {
    try {
      const from = parsePoint(req.body.from, 'Başlangıç');
      const to = parsePoint(req.body.to, 'Varış');
      const via = Array.isArray(req.body.via) ? req.body.via : [];
      if (via.length > MAX_STOPS) throw new HttpError(400, `En fazla ${MAX_STOPS} ara durak eklenebilir`);
      const stops = via.map((p, i) => parsePoint(p, `${i + 1}. ara durak`));
      const costing = COSTINGS.has(req.body.costing) ? req.body.costing : 'auto';
      const heading = Number(req.body.heading);
      const origin = { ...from, type: 'break' };
      // Seyir sırasında yeniden rota alınırken gidiş yönünü bilmek U dönüşlerini önler.
      if (Number.isFinite(heading) && heading >= 0) {
        origin.heading = Math.round(heading) % 360;
        origin.heading_tolerance = 60;
      }

      const exclude = store.excludePolygons();
      // Valhalla alternatif rotayı yalnızca iki noktalı rotalarda verir.
      const wantAlternatives = Boolean(req.body.alternatives) && stops.length === 0;
      // Ücretli yollardan kaçın: yasaklamaz, mümkünse kaçınır (Boğaz geçişlerinin çoğu ücretli).
      const avoidTolls = Boolean(req.body.avoidTolls);
      const { data, snappedToRoad, body: usedBody } = await routeWithFallback(valhalla, {
        // Ara duraklar "break": orada durulur, rota durak başına ayrı bacaklara bölünür.
        locations: [origin, ...stops.map((p) => ({ ...p, type: 'break' })), { ...to, type: 'break' }],
        costing,
        directions_options: { language: 'tr-TR', units: 'kilometers' },
        // Alternatifler de exclude_polygons'a uyar: hiçbiri kapalı yoldan geçmez.
        ...(wantAlternatives ? { alternates: 2 } : {}),
        ...(avoidTolls ? { costing_options: { [costing]: { use_tolls: 0 } } } : {}),
        ...(exclude.length ? { exclude_polygons: exclude } : {}),
      });

      const departAt = req.body.departAt ? new Date(req.body.departAt) : new Date();
      const traffic = trafficPeriod(Number.isNaN(departAt.getTime()) ? new Date() : departAt);
      const trips = [data.trip, ...(data.alternates ?? []).map((a) => a.trip)];
      const [limits, lanes] = await Promise.all([
        Promise.all(trips.map((trip) => Promise.all(trip.legs.map((leg) => legSpeedLimits(valhalla, leg, costing))))),
        routeLanes(valhalla, usedBody, trips),
      ]);
      // Yoğun saat tahminine göre en hızlıdan yavaşa sırala.
      const routes = trips
        .map((trip, i) => buildRoute(trip, traffic.key, limits[i], lanes[i]))
        .sort((a, b) => a.durationSec - b.durationSec);
      res.json({ closuresVersion: store.version, costing, avoidTolls, snappedToRoad, traffic, ...routes[0], routes });
    } catch (err) {
      next(err);
    }
  });

  // Adres arama: yalnızca HERE (HERE_API_KEY), İstanbul kutusuyla sınırlı.
  app.get('/api/search', requireActive, async (req, res, next) => {
    try {
      const q = String(req.query.q ?? '').trim();
      if (q.length < 2) return res.json({ results: [] });
      const { results } = await searchPlaces(q, {
        hereApiKey,
        bbox: ISTANBUL_BBOX,
        fetchImpl,
      }).catch((err) => {
        throw new HttpError(hereApiKey ? 502 : 503, err.message);
      });
      res.json({ results });
    } catch (err) {
      next(err);
    }
  });

  app.use('/admin/vendor/leaflet', express.static(fileURLToPath(new URL('../node_modules/leaflet/dist', import.meta.url))));
  app.use('/admin', express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.get('/', (req, res) => res.redirect('/admin/'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof UserError) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz istek' });
    const status = err.status ?? (err instanceof ValhallaError ? 502 : 500);
    if (status >= 500) console.error(err);
    let message = err.message;
    if (err instanceof ValhallaError && NO_ROUTE_CODES.has(err.details?.error_code)) {
      message = store.effectiveClosures().length
        ? 'Rota bulunamadı. Kapalı yollar hedefe giden yolu kesiyor olabilir.'
        : 'Bu noktaya araçla gidilebilen bir yol bulunamadı. Hedefe yakın başka bir nokta seçin.';
    }
    res.status(status).json({ error: message });
  });

  return app;
}
