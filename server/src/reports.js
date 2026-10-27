import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Kullanıcı bildirimleri (yol çalışması, kaza...). Bildirim yolu kapatmaz; yönetici görür,
 * gerekiyorsa yolu kendisi kapatır ya da bildirimi yoksayar. 24 saatten eski bildirimler
 * listede gösterilmez ve dosyadan silinir.
 */
export const REPORT_TYPES = {
  roadwork: 'Yol çalışması',
  accident: 'Kaza',
  closed: 'Yol kapalı',
  breakdown: 'Araç arızası',
  other: 'Diğer',
};
export const REPORT_TTL_MS = 24 * 60 * 60 * 1000;
// Aynı kullanıcı en fazla bu sıklıkla bildirim gönderebilir.
export const REPORT_COOLDOWN_MS = 30 * 1000;

export class ReportStore {
  constructor(filePath, { now = () => Date.now() } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.reports = [];
    try {
      this.reports = JSON.parse(readFileSync(filePath, 'utf8')).reports ?? [];
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  #save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify({ reports: this.reports }, null, 2));
    renameSync(tmp, this.filePath);
  }

  #prune() {
    const cutoff = this.now() - REPORT_TTL_MS;
    const before = this.reports.length;
    this.reports = this.reports.filter((r) => Date.parse(r.createdAt) > cutoff);
    return this.reports.length !== before;
  }

  /** Yeni bildirim. Gönderen kullanıcı 30 sn içinde ikinci bildirimi gönderemez. */
  add({ type, lat, lon, road = null, user }) {
    if (!REPORT_TYPES[type]) throw Object.assign(new Error('Geçersiz bildirim türü'), { status: 400 });
    const last = this.reports.filter((r) => r.userId === user.id).at(-1);
    if (last && this.now() - Date.parse(last.createdAt) < REPORT_COOLDOWN_MS) {
      throw Object.assign(new Error('Az önce bildirim gönderdiniz. Biraz sonra tekrar deneyin.'), { status: 429 });
    }
    this.#prune();
    const report = {
      id: randomUUID(),
      type,
      label: REPORT_TYPES[type],
      lat,
      lon,
      road: road ? String(road).slice(0, 120) : null,
      userId: user.id,
      userName: user.name,
      createdAt: new Date(this.now()).toISOString(),
    };
    this.reports.push(report);
    this.#save();
    return report;
  }

  /** Son 24 saatin bildirimleri, en yenisi başta. */
  list() {
    if (this.#prune()) this.#save();
    return [...this.reports].reverse();
  }

  remove(id) {
    const report = this.reports.find((r) => r.id === id);
    if (!report) return null;
    this.reports = this.reports.filter((r) => r.id !== id);
    this.#save();
    return report;
  }
}
