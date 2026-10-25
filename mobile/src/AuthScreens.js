import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import PrivacyScreen from './PrivacyScreen';

export const LOGO = require('../assets/logo.png');

// Giriş ekranının arkasındaki çizim harita: sokak ızgarası, mavi rota ve iki kapalı yol
// (kırmızı-beyaz şerit + girilmez levhası). Gerçek harita değil; ağ ya da harita anahtarı gerektirmez.
const STREET_ROWS = [18, 88, 158, 228, 298, 368, 438, 508, 578, 648, 718, 788];
const STREET_COLS = [14, 76, 138, 200, 262, 324, 386];

function Stripes({ vertical, length }) {
  const count = Math.ceil(length / 16);
  return (
    <View style={[{ flexDirection: vertical ? 'column' : 'row', overflow: 'hidden' }, vertical ? { height: length } : { width: length }]}>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[
            { backgroundColor: '#d70015' },
            vertical ? { width: 11, height: 9, marginBottom: 7 } : { height: 11, width: 9, marginRight: 7 },
          ]}
        />
      ))}
    </View>
  );
}

function Sign({ x, y }) {
  return (
    <View style={[styles.sign, { left: x - 13, top: y - 13 }]}>
      <View style={styles.signBar} />
    </View>
  );
}

export function MapBackdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#ebe7df' }]} />
      {STREET_ROWS.map((top) => (
        <View key={`r${top}`} style={[styles.street, { left: 0, right: 0, top, height: 11 }]} />
      ))}
      {STREET_COLS.map((left) => (
        <View key={`c${left}`} style={[styles.street, { top: 0, bottom: 0, left, width: 11 }]} />
      ))}
      <View style={[styles.park, { left: 25, top: 99, width: 51, height: 59 }]} />
      <View style={[styles.park, { left: 211, top: 29, width: 51, height: 59 }]} />
      <View style={[styles.park, { left: 149, top: 309, width: 51, height: 59 }]} />
      {/* rota */}
      <View style={[styles.route, { left: 19, top: 366, width: 130, height: 6 }]} />
      <View style={[styles.route, { left: 143, top: 86, width: 6, height: 286 }]} />
      <View style={[styles.route, { left: 143, top: 86, width: 130, height: 6 }]} />
      {/* iki kapalı yol */}
      <View style={{ position: 'absolute', left: 25, top: 298, backgroundColor: '#fff' }}>
        <Stripes length={113} />
      </View>
      <Sign x={81} y={303} />
      <View style={{ position: 'absolute', left: 200, top: 309, backgroundColor: '#fff' }}>
        <Stripes vertical length={59} />
      </View>
      <Sign x={205} y={338} />
      {/* bir tık koyu */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,14,22,0.45)' }]} />
    </View>
  );
}

function Field({ label, ...props }) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor="#8e8e93" autoCorrect={false} {...props} />
    </>
  );
}

function Shell({ children, logoTagline = 'Kapalı yolları bilen navigasyon' }) {
  return (
    <View style={styles.container}>
      <MapBackdrop />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bounces={false}>
          <View style={styles.logo}>
            <Image source={LOGO} style={styles.logoImage} accessibilityLabel="HERMAPS" />
            {!!logoTagline && <Text style={styles.tagline}>{logoTagline}</Text>}
          </View>
          <View style={styles.card}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function useCooldown() {
  const [cooldown, setCooldown] = useState(0); // yeni kod için kalan saniye
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  return [cooldown, () => setCooldown(60)];
}

function Button({ busy, onPress, children }) {
  return (
    <Pressable style={[styles.button, busy && styles.buttonBusy]} onPress={onPress} disabled={busy}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{children}</Text>}
    </Pressable>
  );
}

/** E-postaya gönderilen 6 haneli kodun girildiği adım (kayıt, kodla giriş, şifre yenileme). */
function CodeStep({ email, code, setCode, demoCode, cooldown, busy, onResend, onBack, backLabel, onSubmit, children }) {
  return (
    <>
      <Text style={styles.subtitle}>
        <Text style={{ fontWeight: '700', color: '#1c1c1e' }}>{email}</Text> adresine 6 haneli bir kod gönderdik. Kod 10 dakika
        geçerlidir.
      </Text>
      <Field
        label="E-POSTADAKİ KOD"
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        placeholder="••••••"
        maxLength={6}
        onSubmitEditing={onSubmit}
        style={[styles.input, styles.codeInput]}
      />
      {!!demoCode && <Text style={styles.demoHint}>Demo modu: e-posta gönderilmez. Kodunuz: {demoCode}</Text>}
      {children}
      <View style={styles.linkRow}>
        <Pressable onPress={onResend} disabled={cooldown > 0 || busy} hitSlop={8}>
          <Text style={[styles.linkSmall, cooldown > 0 && styles.linkDisabled]}>
            {cooldown > 0 ? `Tekrar gönder (${cooldown} sn)` : 'Kodu tekrar gönder'}
          </Text>
        </Pressable>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.linkSmall}>{backLabel}</Text>
        </Pressable>
      </View>
      <Text style={styles.note}>Kod gelmediyse e-postanızın spam (gereksiz) klasörüne bakın.</Text>
    </>
  );
}

/** Onay kutusu; altı çizili metne dokununca ilgili yasal metin açılır. */
function Consent({ checked, onToggle, onOpen, label, link, rest }) {
  return (
    <View style={styles.consent}>
      <Pressable
        onPress={onToggle}
        hitSlop={8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        style={[styles.checkbox, checked && styles.checkboxOn]}
      >
        {checked && <Text style={styles.checkmark}>✓</Text>}
      </Pressable>
      <Text style={styles.consentText} onPress={onToggle}>
        <Text style={styles.consentLink} onPress={onOpen}>
          {link}
        </Text>
        {rest}
      </Text>
    </View>
  );
}

const codeOk = (code) => /^\d{6}$/.test(code.trim());

/**
 * Giriş ve kayıt ekranı.
 * - Giriş yap: e-posta ya da telefon + şifre. "Şifremi unuttum": e-postaya kod gider, kodla yeni
 *   şifre belirlenir. "E-posta koduyla giriş": şifresi olmayan eski üyeler ve yöneticiler için.
 * - Kayıt ol: ad, e-posta, telefon, şifre → e-postaya gelen kod girilince hesap açılır.
 * Uygulama role göre açılır; yeni üyenin süresi yoktur, açılışta paket seçer.
 */
export function LoginScreen({
  onLogin,
  onRegister,
  onVerifyRegistration,
  onRequestCode,
  onEmailLogin,
  onResetPassword,
  demoHint,
  backendLabel,
  onOpenSettings,
  notice, // { text, kind } — ör. "Hesabınız silindi", "Oturumunuz kapandı"
}) {
  // 'login' | 'register' | 'registerCode' | 'forgot' | 'forgotCode' | 'code' | 'codeSent'
  const [step, setStep] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', password2: '' });
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState(''); // kod gönderilen adres
  const [code, setCode] = useState('');
  const [newPw, setNewPw] = useState('');
  const [demoCode, setDemoCode] = useState(null);
  const [cooldown, startCooldown] = useCooldown();
  // Kayıttaki iki onay kutusu: Gizlilik/KVKK ve Kullanım Koşulları/Sorumluluk Reddi.
  const [accepted, setAccepted] = useState({ privacy: false, terms: false });
  const [docOpen, setDocOpen] = useState(null); // null | 'all' | 'gizlilik' | 'kullanim-kosullari'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const toggleAccepted = (key) => {
    setAccepted((a) => ({ ...a, [key]: !a[key] }));
    setError(null);
  };
  const tab = step.startsWith('register') ? 'register' : 'login';

  const go = (next) => {
    setStep(next);
    setError(null);
  };

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const codeSent = (r, to, next) => {
    setEmail(to);
    setDemoCode(r?.demoCode ?? null);
    setCode('');
    startCooldown();
    go(next);
  };

  const submitLogin = () =>
    run(async () => {
      if (!loginId.trim() || !password) throw new Error('E-posta ya da telefon numaranızı ve şifrenizi girin.');
      await onLogin(loginId.trim(), password);
    });

  const submitRegister = () =>
    run(async () => {
      if (!form.name.trim() || !form.email.trim() || !form.phone.trim() || !form.password) throw new Error('Tüm alanları doldurun.');
      if (form.password.length < 6) throw new Error('Şifre en az 6 karakter olmalı.');
      if (form.password !== form.password2) throw new Error('İki şifre aynı değil.');
      if (!accepted.privacy) throw new Error("Devam etmek için Gizlilik Politikası ve KVKK Aydınlatma Metni'ni onaylayın.");
      if (!accepted.terms) throw new Error("Devam etmek için Kullanım Koşulları ve Sorumluluk Reddi'ni kabul edin.");
      const r = await onRegister({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone,
        password: form.password,
        acceptPrivacy: true,
        acceptTerms: true,
      });
      codeSent(r, r?.email ?? form.email.trim().toLowerCase(), 'registerCode');
    });

  const submitRegisterCode = () =>
    run(async () => {
      if (!codeOk(code)) throw new Error('E-postanıza gelen 6 haneli kodu girin.');
      await onVerifyRegistration(email, code.trim());
    });

  const sendCode = (purpose, next) =>
    run(async () => {
      const to = (step === 'forgot' || step === 'code' ? loginId : email).trim();
      if (!to.includes('@')) throw new Error('Geçerli bir e-posta adresi girin.');
      const r = await onRequestCode(to, purpose);
      codeSent(r, to.toLowerCase(), next);
    });

  const submitEmailCode = () =>
    run(async () => {
      if (!codeOk(code)) throw new Error('E-postanıza gelen 6 haneli kodu girin.');
      await onEmailLogin(email, code.trim());
    });

  const submitReset = () =>
    run(async () => {
      if (!codeOk(code)) throw new Error('E-postanıza gelen 6 haneli kodu girin.');
      if (newPw.length < 6) throw new Error('Yeni şifre en az 6 karakter olmalı.');
      await onResetPassword(email, code.trim(), newPw);
    });

  const errorText = !!error && <Text style={styles.error}>{error}</Text>;

  return (
    <Shell>
      {!!notice && <Text style={[styles.notice, notice.kind === 'error' && styles.noticeError]}>{notice.text}</Text>}
      {(step === 'login' || step === 'register') && (
        <View style={styles.tabs}>
          {[
            ['login', 'Giriş yap'],
            ['register', 'Kayıt ol'],
          ].map(([key, label]) => (
            <Pressable key={key} style={[styles.tab, tab === key && styles.tabOn]} onPress={() => go(key)} accessibilityRole="tab">
              <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {step === 'login' && (
        <>
          <Field
            label="E-POSTA YA DA TELEFON"
            value={loginId}
            onChangeText={setLoginId}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="username"
            placeholder="ornek@mail.com ya da 0532..."
          />
          <Field
            label="ŞİFRE"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Şifreniz"
            autoCapitalize="none"
            autoComplete="password"
            onSubmitEditing={submitLogin}
            returnKeyType="go"
          />
          {errorText}
          <Button busy={busy} onPress={submitLogin}>
            Giriş yap
          </Button>
          <View style={styles.linkRow}>
            <Pressable onPress={() => go('forgot')} hitSlop={8}>
              <Text style={styles.linkSmall}>Şifremi unuttum</Text>
            </Pressable>
            <Pressable onPress={() => go('code')} hitSlop={8}>
              <Text style={styles.linkSmall}>E-posta koduyla giriş</Text>
            </Pressable>
          </View>
        </>
      )}

      {step === 'register' && (
        <>
          <Field label="AD SOYAD" value={form.name} onChangeText={set('name')} autoComplete="name" autoCapitalize="words" placeholder="Adınız Soyadınız" />
          <Field
            label="E-POSTA"
            value={form.email}
            onChangeText={set('email')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            placeholder="ornek@mail.com"
          />
          <Field label="CEP TELEFONU" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" placeholder="0532 123 45 67" />
          <Field
            label="ŞİFRE (EN AZ 6 KARAKTER)"
            value={form.password}
            onChangeText={set('password')}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            placeholder="••••••"
          />
          <Field
            label="ŞİFRE (TEKRAR)"
            value={form.password2}
            onChangeText={set('password2')}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            placeholder="••••••"
            onSubmitEditing={submitRegister}
          />
          <Consent
            checked={accepted.privacy}
            onToggle={() => toggleAccepted('privacy')}
            onOpen={() => setDocOpen('gizlilik')}
            label="Gizlilik Politikası onayı"
            link="Gizlilik Politikası ve KVKK Aydınlatma Metni"
            rest="'ni okudum, onaylıyorum."
          />
          <Consent
            checked={accepted.terms}
            onToggle={() => toggleAccepted('terms')}
            onOpen={() => setDocOpen('kullanim-kosullari')}
            label="Kullanım Koşulları onayı"
            link="Kullanım Koşulları ve Sorumluluk Reddi"
            rest="'ni okudum, kabul ediyorum."
          />
          {errorText}
          <Button busy={busy} onPress={submitRegister}>
            Kayıt ol
          </Button>
          <Text style={styles.note}>E-postanıza bir doğrulama kodu göndereceğiz.</Text>
        </>
      )}

      {step === 'registerCode' && (
        <>
          <Text style={styles.title}>E-postanızı doğrulayın</Text>
          <CodeStep
            {...{ email, code, setCode, demoCode, cooldown, busy }}
            onSubmit={submitRegisterCode}
            onResend={submitRegister}
            onBack={() => go('register')}
            backLabel="Bilgileri değiştir"
          >
            {errorText}
            <Button busy={busy} onPress={submitRegisterCode}>
              Hesabı oluştur
            </Button>
          </CodeStep>
        </>
      )}

      {(step === 'forgot' || step === 'code') && (
        <>
          <Text style={styles.title}>{step === 'forgot' ? 'Şifremi unuttum' : 'E-posta koduyla giriş'}</Text>
          <Text style={styles.subtitle}>
            {step === 'forgot'
              ? 'Kayıtlı e-posta adresinizi yazın; yeni şifre belirlemeniz için size bir kod gönderelim.'
              : 'E-posta adresinizi yazın, size bir giriş kodu gönderelim.'}
          </Text>
          <Field
            label="E-POSTA"
            value={loginId}
            onChangeText={setLoginId}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            placeholder="ornek@mail.com"
            onSubmitEditing={() => (step === 'forgot' ? sendCode('reset', 'forgotCode') : sendCode('login', 'codeSent'))}
            returnKeyType="send"
          />
          {errorText}
          <Button busy={busy} onPress={() => (step === 'forgot' ? sendCode('reset', 'forgotCode') : sendCode('login', 'codeSent'))}>
            Kod gönder
          </Button>
          <Pressable onPress={() => go('login')} hitSlop={8}>
            <Text style={styles.link}>Girişe dön</Text>
          </Pressable>
        </>
      )}

      {step === 'forgotCode' && (
        <>
          <Text style={styles.title}>Yeni şifre belirleyin</Text>
          <CodeStep
            {...{ email, code, setCode, demoCode, cooldown, busy }}
            onSubmit={submitReset}
            onResend={() => sendCode('reset', 'forgotCode')}
            onBack={() => go('login')}
            backLabel="Girişe dön"
          >
            <Field
              label="YENİ ŞİFRE (EN AZ 6 KARAKTER)"
              value={newPw}
              onChangeText={setNewPw}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              placeholder="••••••"
              onSubmitEditing={submitReset}
            />
            {errorText}
            <Button busy={busy} onPress={submitReset}>
              Şifreyi kaydet ve giriş yap
            </Button>
          </CodeStep>
        </>
      )}

      {step === 'codeSent' && (
        <>
          <Text style={styles.title}>Giriş kodu</Text>
          <CodeStep
            {...{ email, code, setCode, demoCode, cooldown, busy }}
            onSubmit={submitEmailCode}
            onResend={() => sendCode('login', 'codeSent')}
            onBack={() => go('login')}
            backLabel="Girişe dön"
          >
            {errorText}
            <Button busy={busy} onPress={submitEmailCode}>
              Giriş yap
            </Button>
          </CodeStep>
        </>
      )}

      {!!demoHint && <Text style={styles.demoHint}>{demoHint}</Text>}
      <View style={styles.footer}>
        <Pressable onPress={() => setDocOpen('all')} hitSlop={8}>
          <Text style={styles.server}>Gizlilik ve Kullanım Koşulları</Text>
        </Pressable>
        <Text style={styles.server}>·</Text>
        <Pressable onPress={onOpenSettings} hitSlop={8}>
          <Text style={styles.server}>Sunucu: {backendLabel} · değiştir</Text>
        </Pressable>
      </View>
      <PrivacyScreen visible={!!docOpen} docId={docOpen === 'all' ? null : docOpen} onClose={() => setDocOpen(null)} />
    </Shell>
  );
}

/** Geçici şifreyle giren kişi kendi şifresini belirler. */
export function ChangePasswordScreen({ user, onSubmit, onLogout }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (pw.length < 6) return setError('Şifre en az 6 karakter olmalı.');
    if (pw !== pw2) return setError('İki şifre aynı değil.');
    setBusy(true);
    setError(null);
    try {
      await onSubmit(pw);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Shell logoTagline={null}>
      <Text style={styles.title}>Kendi şifrenizi belirleyin</Text>
      <Text style={styles.subtitle}>
        Merhaba {user.name}. Size verilen geçici şifre yalnızca ilk giriş içindi. En az 6 karakterli yeni bir şifre seçin.
      </Text>
      <Field label="YENİ ŞİFRE" value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none" placeholder="••••••" />
      <Field
        label="YENİ ŞİFRE (TEKRAR)"
        value={pw2}
        onChangeText={setPw2}
        secureTextEntry
        autoCapitalize="none"
        placeholder="••••••"
        onSubmitEditing={submit}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={[styles.button, busy && styles.buttonBusy]} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Kaydet ve devam et</Text>}
      </Pressable>
      <Pressable onPress={onLogout} hitSlop={8}>
        <Text style={styles.link}>Çıkış yap</Text>
      </Pressable>
    </Shell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1c1e' },
  street: { position: 'absolute', backgroundColor: '#fff' },
  park: { position: 'absolute', backgroundColor: '#d7e8cf' },
  route: { position: 'absolute', backgroundColor: '#0a66d8' },
  sign: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#d70015',
    borderWidth: 2.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signBar: { width: 12, height: 4, borderRadius: 1, backgroundColor: '#fff' },
  scroll: { flexGrow: 1, justifyContent: 'space-between', paddingTop: 64, paddingBottom: 16, paddingHorizontal: 12 },
  logo: { alignItems: 'center', marginBottom: 40 },
  logoImage: { width: 150, height: 150 },
  tagline: {
    color: '#fff',
    fontSize: 13,
    marginTop: 8,
    opacity: 0.92,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 20,
    paddingBottom: 18,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  title: { fontSize: 21, fontWeight: '800', color: '#1c1c1e' },
  subtitle: { fontSize: 13.5, color: '#6e6e73', marginTop: 3, marginBottom: 14, lineHeight: 19 },
  label: { fontSize: 11, fontWeight: '700', color: '#6e6e73', letterSpacing: 0.3, marginBottom: 5, marginLeft: 2 },
  input: {
    borderWidth: 1.5,
    borderColor: '#d1d1d6',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1c1c1e',
    marginBottom: 10,
  },
  error: { color: '#d70015', fontSize: 13.5, marginBottom: 8, fontWeight: '600' },
  button: { backgroundColor: '#0a66d8', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  buttonBusy: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { backgroundColor: '#f2f2f7' },
  secondaryText: { color: '#1c1c1e', fontSize: 15, fontWeight: '600' },
  link: { color: '#0a66d8', fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 14 },
  note: { color: '#3a3a3c', fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 18 },
  demoHint: { color: '#6e6e73', fontSize: 12, textAlign: 'center', marginTop: 12, backgroundColor: '#f2f2f7', borderRadius: 8, padding: 8 },
  server: { color: '#8e8e93', fontSize: 12, textAlign: 'center' },
  codeInput: { fontSize: 24, letterSpacing: 8, fontWeight: '700', textAlign: 'center' },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  linkSmall: { color: '#0a66d8', fontSize: 13.5, fontWeight: '600' },
  linkDisabled: { color: '#8e8e93' },
  notice: { backgroundColor: '#e8f5ec', color: '#1f6b3a', borderRadius: 10, padding: 10, fontSize: 13.5, fontWeight: '600', marginBottom: 12 },
  noticeError: { backgroundColor: '#fdecee', color: '#b0000f' },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 4, marginBottom: 10 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#aeaeb2',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: '#0a66d8', borderColor: '#0a66d8' },
  checkmark: { color: '#fff', fontSize: 15, fontWeight: '900', lineHeight: 18 },
  consentText: { flex: 1, fontSize: 13.5, color: '#3a3a3c', lineHeight: 19 },
  consentLink: { color: '#0a66d8', fontWeight: '700', textDecorationLine: 'underline' },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  tabs: { flexDirection: 'row', backgroundColor: '#f2f2f7', borderRadius: 12, padding: 3, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  tabOn: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabText: { fontSize: 15, fontWeight: '600', color: '#6e6e73' },
  tabTextOn: { color: '#1c1c1e', fontWeight: '800' },
});
