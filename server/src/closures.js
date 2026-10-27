import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import { lineLengthMeters, midpointAlong, tinySquareRing, distanceToLineMeters } from './geo.js';

/**
 * Kapalı yol segmentleri ve kayıtlı kapatma grupları.
 *
 * - Tekil kapatma: yöneticinin haritada dokunarak kapattığı bir kenar (iki kavşak
 *   arası sokak parçası).
 * - Kayıtlı grup: isim verilmiş bir segment listesi ("Maraton güzergâhı" gibi).
 *   Tek hamlede trafiğe kapatılır (active) ya da açılır.
 *
 * Rotadan çıkarılan yollar = tekil kapatmalar ∪ aktif grupların segmentleri.
 * Her segmentin orta noktasına konan minik poligon exclude_polygons ile Valhalla'ya
 * gönderilir. Her değişiklikte `version` artar ve "change" olayı yayılır.
 */
export class ClosureStore extends EventEmitter {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.version = 0;
    this.closures = new Map();
    this.zones = new Map();
    this.#load();
  }

  #load() {
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
      this.version = data.version ?? 0;
      for (const c of data.closures ?? []) this.closures.set(c.id, c);
      for (const z of data.zones ?? []) this.zones.set(z.id, z);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  #save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    const data = { version: this.version, closures: this.list(), zones: this.listZones() };
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.filePath);
  }

  #changed(type, payload) {
    this.version += 1;
    this.#save();
    this.emit('change', { type, ...payload, version: this.version });
  }

  /** Aynı kenar iki yönde de aynı geometriye sahip olduğu için kimlik geometriden türetilir. */
  static idForShape(shapeEncoded) {
    return createHash('sha1').update(shapeEncoded).digest('hex').slice(0, 16);
  }

  // --- Tekil kapatmalar ---

  list() {
    return [...this.closures.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id) {
    return this.closures.get(id);
  }

  /** Valhalla kenarından saklanacak segment kaydı. */
  static segmentFromEdge(edge) {
    return {
      id: ClosureStore.idForShape(edge.shapeEncoded),
      wayId: edge.wayId,
      name: edge.names.join(' / ') || 'İsimsiz yol',
      coordinates: edge.coordinates,
      midpoint: midpointAlong(edge.coordinates),
      lengthMeters: Math.round(lineLengthMeters(edge.coordinates)),
      createdAt: new Date().toISOString(),
    };
  }

  add(edge, { reason = '' } = {}) {
    const id = ClosureStore.idForShape(edge.shapeEncoded);
    const existing = this.closures.get(id);
    if (existing) return existing;
    const closure = { ...ClosureStore.segmentFromEdge(edge), reason };
    this.closures.set(id, closure);
    this.#changed('closed', { closure });
    return closure;
  }

  remove(id) {
    const closure = this.closures.get(id);
    if (!closure) return null;
    this.closures.delete(id);
    this.#changed('opened', { closure });
    return closure;
  }

  // --- Kayıtlı gruplar ---

  listZones() {
    return [...this.zones.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getZone(id) {
    return this.zones.get(id);
  }

  /** Bu segment şu an trafiğe kapalı olan bir gruba mı ait? */
  activeZoneOf(segmentId) {
    return this.listZones().find((z) => z.active && z.segments.some((s) => s.id === segmentId)) ?? null;
  }

  /**
   * Şu anki tekil kapatmalardan (veya verilen kimliklerden) isimli bir grup oluşturur.
   * Segmentler gruba taşınır; grup kapalı (active) olarak başlar, yani hiçbir yol açılmaz.
   */
  createZone(name, closureIds) {
    const ids = closureIds?.length ? closureIds : [...this.closures.keys()];
    const segments = ids.map((id) => this.closures.get(id)).filter(Boolean);
    if (!segments.length) return null;
    const zone = {
      id: randomUUID().slice(0, 8),
      name,
      active: true,
      segments: segments.map(({ reason, ...s }) => s),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    for (const s of segments) this.closures.delete(s.id);
    this.zones.set(zone.id, zone);
    this.#changed('zone-created', { zone });
    return zone;
  }

  updateZone(id, { active, name }) {
    const zone = this.zones.get(id);
    if (!zone) return null;
    if (typeof active === 'boolean') zone.active = active;
    if (name) zone.name = name;
    zone.updatedAt = new Date().toISOString();
    this.#changed('zone-updated', { zone });
    return zone;
  }

  /** Düzenleme: segment gruptaysa çıkarır, değilse ekler. */
  toggleZoneSegment(zoneId, edge) {
    const zone = this.zones.get(zoneId);
    if (!zone) return null;
    const segment = ClosureStore.segmentFromEdge(edge);
    const index = zone.segments.findIndex((s) => s.id === segment.id);
    let action;
    if (index >= 0) {
      segment.name = zone.segments[index].name;
      zone.segments.splice(index, 1);
      action = 'removed';
    } else {
      zone.segments.push(segment);
      // Aynı yol kaydedilmemiş bir kapatma olarak da duruyorsa artık grubun parçası.
      this.closures.delete(segment.id);
      action = 'added';
    }
    zone.updatedAt = new Date().toISOString();
    this.#changed('zone-updated', { zone });
    return { action, zone, segment };
  }

  deleteZone(id) {
    const zone = this.zones.get(id);
    if (!zone) return null;
    this.zones.delete(id);
    this.#changed('zone-deleted', { zone });
    return zone;
  }

  /**
   * Bütün yolları trafiğe açar: kaydedilmemiş kapatmalar silinir, kayıtlı gruplar
   * silinmez ama hepsi pasif yapılır. Tek bir sürüm artışıyla yapılır.
   */
  openAll() {
    const removed = this.closures.size;
    let zonesOpened = 0;
    this.closures.clear();
    for (const z of this.zones.values()) {
      if (!z.active) continue;
      z.active = false;
      z.updatedAt = new Date().toISOString();
      zonesOpened += 1;
    }
    if (removed || zonesOpened) this.#changed('opened-all', { removed, zonesOpened });
    return { removed, zonesOpened };
  }

  // --- Rota motoruna giden birleşik liste ---

  /** Şu an trafiğe kapalı tüm segmentler; gruptan gelenler zoneId/zoneName taşır. */
  effectiveClosures() {
    const byId = new Map();
    for (const z of this.listZones()) {
      if (!z.active) continue;
      for (const s of z.segments) if (!byId.has(s.id)) byId.set(s.id, { ...s, zoneId: z.id, zoneName: z.name });
    }
    for (const c of this.list()) if (!byId.has(c.id)) byId.set(c.id, { ...c, zoneId: null, zoneName: null });
    return [...byId.values()];
  }

  /** Noktaya en yakın kapalı segment ve uzaklığı (metre); `maxMeters` içinde yoksa null. */
  nearestClosed(point, maxMeters) {
    let best = null;
    for (const c of this.effectiveClosures()) {
      const distance = distanceToLineMeters(point, c.coordinates);
      if (distance <= maxMeters && (!best || distance < best.distance)) best = { closure: c, distance };
    }
    return best;
  }

  /** Valhalla rota isteğine eklenecek exclude_polygons listesi. */
  excludePolygons() {
    return this.effectiveClosures().map((c) => tinySquareRing(c.midpoint));
  }
}
