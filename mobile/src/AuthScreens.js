import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import HermapLogo from './HermapLogo';

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
      <View style={{ position: 'absolute', left: 25, top: 228, backgroundColor: '#fff' }}>
        <Stripes length={113} />
      </View>
      <Sign x={81} y={233} />
      <View style={{ position: 'absolute', left: 200, top: 239, backgroundColor: '#fff' }}>
        <Stripes vertical length={59} />
      </View>
      <Sign x={205} y={268} />
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
            <HermapLogo size={46} tagline={logoTagline} />
          </View>
          <View style={styles.card}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * Giriş: e-postaya gelen 6 haneli kodla (herkes). Sahip ve yöneticiler için telefon + şifre
 * yedek olarak "Telefon ve şifreyle giriş" bağlantısının arkasındadır. Uygulama role göre açılır.
 */
export function LoginScreen({ onRequestCode, onEmailLogin, onLogin, demoHint, backendLabel, onOpenSettings }) {
  const [mode, setMode] = useState('email'); // 'email' | 'password'
  const [email, setEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [demoCode, setDemoCode] = useState(null);
  const [cooldown, setCooldown] = useState(0); // yeni kod için kalan saniye
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [forgot, setForgot] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

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

  const sendCode = () =>
    run(async () => {
      if (!email.trim()) throw new Error('E-posta adresinizi girin.');
      const r = await onRequestCode(email.trim());
      setDemoCode(r?.demoCode ?? null);
      setCodeSent(true);
      setCode('');
      setCooldown(60);
    });

  const submitCode = () =>
    run(async () => {
      if (!/^\d{6}$/.test(code.trim())) throw new Error('E-postanıza gelen 6 haneli kodu girin.');
      await onEmailLogin(email.trim(), code.trim());
    });

  const submitPassword = () =>
    run(async () => {
      if (!phone.trim() || !password) throw new Error('Telefon numaranızı ve şifrenizi girin.');
      await onLogin(phone, password);
    });

  const switchMode = (m) => {
    setMode(m);
    setError(null);
  };

  return (
    <Shell>
      <Text style={styles.title}>Hoş geldiniz</Text>
      {mode === 'email' && !codeSent && (
        <>
          <Text style={styles.subtitle}>E-posta adresinizi yazın, size bir giriş kodu gönderelim.</Text>
          <Field
            label="E-POSTA"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            placeholder="ornek@mail.com"
            onSubmitEditing={sendCode}
            returnKeyType="send"
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={[styles.button, busy && styles.buttonBusy]} onPress={sendCode} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Kod gönder</Text>}
          </Pressable>
        </>
      )}
      {mode === 'email' && codeSent && (
        <>
          <Text style={styles.subtitle}>
            <Text style={{ fontWeight: '700', color: '#1c1c1e' }}>{email.trim().toLowerCase()}</Text> adresine 6 haneli bir kod gönderdik. Kod 10 dakika
            geçerlidir.
          </Text>
          <Field
            label="GİRİŞ KODU"
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            placeholder="••••••"
            maxLength={6}
            onSubmitEditing={submitCode}
            style={[styles.input, styles.codeInput]}
          />
          {!!demoCode && <Text style={styles.demoHint}>Demo modu: e-posta gönderilmez. Kodunuz: {demoCode}</Text>}
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={[styles.button, busy && styles.buttonBusy]} onPress={submitCode} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Giriş yap</Text>}
          </Pressable>
          <Text style={styles.note}>Kod gelmediyse e-postanızın spam (gereksiz) klasörüne bakın.</Text>
          <View style={styles.linkRow}>
            <Pressable onPress={sendCode} disabled={cooldown > 0 || busy} hitSlop={8}>
              <Text style={[styles.linkSmall, cooldown > 0 && styles.linkDisabled]}>
                {cooldown > 0 ? `Tekrar gönder (${cooldown} sn)` : 'Kodu tekrar gönder'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setCodeSent(false);
                setError(null);
              }}
              hitSlop={8}
            >
              <Text style={styles.linkSmall}>E-postayı değiştir</Text>
            </Pressable>
          </View>
        </>
      )}
      {mode === 'password' && (
        <>
          <Text style={styles.subtitle}>Sahip ve yöneticiler için yedek giriş.</Text>
          <Field label="TELEFON" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="0532 123 45 67" autoComplete="tel" />
          <Field
            label="ŞİFRE"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Şifreniz"
            autoCapitalize="none"
            onSubmitEditing={submitPassword}
            returnKeyType="go"
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={[styles.button, busy && styles.buttonBusy]} onPress={submitPassword} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Giriş yap</Text>}
          </Pressable>
          <Pressable onPress={() => setForgot((f) => !f)} hitSlop={8}>
            <Text style={styles.link}>Şifremi unuttum</Text>
          </Pressable>
          {forgot && <Text style={styles.note}>E-posta koduyla girebilirsiniz; ya da sahip size yeni bir geçici şifre verir.</Text>}
        </>
      )}
      <Pressable onPress={() => switchMode(mode === 'email' ? 'password' : 'email')} hitSlop={8}>
        <Text style={styles.link}>{mode === 'email' ? 'Yönetici misiniz? Telefon ve şifreyle girin' : 'E-posta koduyla giriş'}</Text>
      </Pressable>
      {!!demoHint && <Text style={styles.demoHint}>{demoHint}</Text>}
      <Pressable onPress={onOpenSettings} hitSlop={8} style={{ marginTop: 10 }}>
        <Text style={styles.server}>Sunucu: {backendLabel} · değiştir</Text>
      </Pressable>
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

const PLANS = [
  ['day1', '1 gün'],
  ['day3', '3 gün'],
  ['week1', '1 hafta'],
];

/** Üyenin süresi bitince haritanın üstünde açılır; rota alınamaz. */
export function ExpiredScreen({ user, settings, onRefresh, onLogout }) {
  const [checking, setChecking] = useState(false);
  const s = settings ?? {};
  const prices = s.prices ?? {};
  const whatsapp = s.whatsapp ? `90${s.whatsapp.slice(1)}` : null;
  const message = `Merhaba, HERMAP kullanım sürem doldu. Süre yenilemek istiyorum. (${[user.name, user.email, user.phone].filter(Boolean).join(' · ')})`;

  const refresh = async () => {
    setChecking(true);
    try {
      await onRefresh();
    } finally {
      setChecking(false);
    }
  };

  return (
    <View style={styles.expiredBackdrop}>
      <View style={[styles.card, styles.expiredCard]}>
        <View style={styles.expiredIcon}>
          <Text style={{ fontSize: 24 }}>⏱️</Text>
        </View>
        <Text style={styles.title}>Kullanım süreniz doldu</Text>
        <Text style={styles.subtitle}>Navigasyona devam etmek için süre yenileyin. Ödemenizden sonra süreniz tanımlanır.</Text>
        <View style={styles.plans}>
          {PLANS.map(([key, label], i) => (
            <View key={key} style={[styles.plan, i === 2 && styles.planBest]}>
              <Text style={[styles.planLabel, i === 2 && styles.planLabelBest]}>{label}</Text>
              <Text style={styles.planPrice}>{prices[key]}</Text>
            </View>
          ))}
        </View>
        {!!(s.iban || s.accountName) && (
          <View style={styles.payBox}>
            {!!s.accountName && <Text style={styles.payText}>Alıcı: {s.accountName}</Text>}
            {!!s.iban && <Text style={styles.payText} selectable>IBAN: {s.iban}</Text>}
            <Text style={styles.payText}>Açıklamaya e-posta adresinizi yazın.</Text>
          </View>
        )}
        {whatsapp && (
          <Pressable
            style={[styles.button, { backgroundColor: '#25d366' }]}
            onPress={() => Linking.openURL(`https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`)}
          >
            <Text style={styles.buttonText}>WhatsApp ile yaz</Text>
          </Pressable>
        )}
        <Pressable style={[styles.button, styles.secondary]} onPress={refresh} disabled={checking}>
          {checking ? <ActivityIndicator /> : <Text style={styles.secondaryText}>Ödedim, tekrar kontrol et</Text>}
        </Pressable>
        <Pressable onPress={onLogout} hitSlop={8}>
          <Text style={styles.link}>Çıkış yap</Text>
        </Pressable>
      </View>
    </View>
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
  scroll: { flexGrow: 1, justifyContent: 'space-between', paddingTop: 96, paddingBottom: 16, paddingHorizontal: 12 },
  logo: { alignItems: 'center', marginBottom: 150 },
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
  expiredBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', padding: 12, paddingBottom: 28 },
  expiredCard: { gap: 2 },
  expiredIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fde7e9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  plans: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  plan: { flex: 1, borderWidth: 1.5, borderColor: '#d1d1d6', borderRadius: 12, paddingVertical: 9, alignItems: 'center' },
  planBest: { borderColor: '#0a66d8', backgroundColor: '#eef4fd' },
  planLabel: { fontWeight: '800', fontSize: 15, color: '#1c1c1e' },
  planLabelBest: { color: '#0a66d8' },
  planPrice: { fontSize: 12, color: '#3a3a3c', marginTop: 2 },
  payBox: { backgroundColor: '#f2f2f7', borderRadius: 10, padding: 10, marginBottom: 4, gap: 2 },
  payText: { fontSize: 13, color: '#3a3a3c' },
});
