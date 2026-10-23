// Yoğun saat tahmini: gerçek trafik verisi olmadan, İstanbul'un saate ve güne göre
// tipik yoğunluğuna dayanarak Valhalla'nın sürelerini uzatır. Tıkanıklık en çok ana
// yollarda olduğu için hızlı yollar daha çok, ara sokaklar daha az etkilenir.
//
// Not: mobile/src/traffic.js bu dosyanın demo modu için kopyasıdır; ikisini birlikte güncelleyin.

const PERIODS = {
  peak: { label: 'Yoğun saat', factors: { fast: 2.0, medium: 1.6, slow: 1.3 } },
  busy: { label: 'Gündüz trafiği', factors: { fast: 1.4, medium: 1.3, slow: 1.15 } },
  normal: { label: 'Normal trafik', factors: { fast: 1.15, medium: 1.1, slow: 1.05 } },
  night: { label: 'Gece, trafik yok', factors: { fast: 1, medium: 1, slow: 1 } },
};

/** İstanbul yerel saati (UTC+3; Türkiye 2016'dan beri yaz saati uygulamıyor). */
export function istanbulClock(date = new Date()) {
  const t = new Date(date.getTime() + 3 * 3600 * 1000);
  return { day: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

export function trafficPeriod(date = new Date()) {
  const { day, minutes } = istanbulClock(date);
  const h = (hh, mm = 0) => hh * 60 + mm;
  const weekday = day >= 1 && day <= 5;
  let key;
  if (minutes >= h(23) || minutes < h(6)) key = 'night';
  else if (weekday && ((minutes >= h(7) && minutes < h(10)) || (minutes >= h(17) && minutes < h(20, 30)))) key = 'peak';
  else if (weekday ? minutes >= h(10) && minutes < h(22) : minutes >= h(10) && minutes < h(21)) key = 'busy';
  else key = 'normal';
  return { key, label: PERIODS[key].label };
}

/** Manevranın ortalama hızına göre yol sınıfı: hızlı yol (≥60), ana cadde (≥35), sokak. */
function speedClass(lengthKm, timeSec) {
  const kmh = timeSec > 0 ? lengthKm / (timeSec / 3600) : 0;
  if (kmh >= 60) return 'fast';
  if (kmh >= 35) return 'medium';
  return 'slow';
}

/** Valhalla manevra süresine yoğun saat çarpanını uygular (saniye). */
export function adjustedTime(lengthKm, timeSec, periodKey) {
  const factor = PERIODS[periodKey].factors[speedClass(lengthKm, timeSec)];
  return timeSec * factor;
}
