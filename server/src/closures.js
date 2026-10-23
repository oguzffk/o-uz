import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import { lineLengthMeters, midpointAlong, tinySquareRing } from './geo.js';

/**
 * Kapalı yol segmentleri. Her kayıt Valhalla'daki bir kenarın (iki kavşak
 * arasındaki sokak parçası) geometrisini tutar; rota isteğinde bu geometrinin
 * orta noktasına konan minik bir poligon exclude_polygons ile gönderilir.
 *
 * Kayıtlar JSON dosyasında saklanır (prototip için yeterli). Her değişiklikte
 * `version` artar ve "change" olayı yayılır; istemciler buna göre yeniler.
 */
export class ClosureStore extends EventEmitter {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.version = 0;
    this.closures = new Map();
    this.#load();
  }

  #load() {
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
      this.version = data.version ?? 0;
      for (const c of data.closures ?? []) this.closures.set(c.id, c);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  #save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: this.version, closures: this.list() }, null, 2));
    renameSync(tmp, this.filePath);
  }

  #changed(type, closure) {
    this.version += 1;
    this.#save();
    this.emit('change', { type, closure, version: this.version });
  }

  /** Aynı kenar iki yönde de aynı geometriye sahip olduğu için kimlik geometriden türetilir. */
  static idForShape(shapeEncoded) {
    return createHash('sha1').update(shapeEncoded).digest('hex').slice(0, 16);
  }

  list() {
    return [...this.closures.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id) {
    return this.closures.get(id);
  }

  add(edge, { reason = '' } = {}) {
    const id = ClosureStore.idForShape(edge.shapeEncoded);
    const existing = this.closures.get(id);
    if (existing) return existing;
    const closure = {
      id,
      wayId: edge.wayId,
      name: edge.names.join(' / ') || 'İsimsiz yol',
      reason,
      coordinates: edge.coordinates,
      midpoint: midpointAlong(edge.coordinates),
      lengthMeters: Math.round(lineLengthMeters(edge.coordinates)),
      createdAt: new Date().toISOString(),
    };
    this.closures.set(id, closure);
    this.#changed('closed', closure);
    return closure;
  }

  remove(id) {
    const closure = this.closures.get(id);
    if (!closure) return null;
    this.closures.delete(id);
    this.#changed('opened', closure);
    return closure;
  }

  /** Valhalla rota isteğine eklenecek exclude_polygons listesi. */
  excludePolygons() {
    return this.list().map((c) => tinySquareRing(c.midpoint));
  }
}
