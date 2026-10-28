/**
 * Home Channel HLS - Comerciales y cortinillas (bumpers).
 */

const SQL = require('../sql');
const { formatDuration } = require('../../core/time');

const newId = () => `comm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

class CommercialRepository {
  constructor({ store, pg }) {
    this.store = store;
    this.pg = pg;
  }

  get items() {
    if (!Array.isArray(this.store.data.commercials)) this.store.data.commercials = [];
    return this.store.data.commercials;
  }

  all() {
    return this.items;
  }

  add(data) {
    const item = {
      id: data.id || newId(),
      title: data.title || 'Comercial Retro',
      type: data.type || 'commercial',
      filename: data.filename,
      path: data.path,
      duration: Math.round(data.duration || 0),
      durationFormatted: data.durationFormatted || '00:30',
      sizeMB: String(data.sizeMB || '0'),
      status: 'ready',
      createdAt: data.createdAt || new Date().toISOString()
    };

    const idx = this.items.findIndex(c => c.id === item.id || (item.path && c.path === item.path));
    if (idx !== -1) this.items[idx] = { ...this.items[idx], ...item };
    else this.items.push(item);
    this.store.save();

    this.pg.write('addCommercial', SQL.UPSERT_COMMERCIAL, [
      item.id, item.title, item.type, item.filename, item.path,
      item.duration, item.durationFormatted, item.sizeMB, item.status, item.createdAt
    ]);
    return item;
  }

  update(id, data = {}) {
    const item = this.items.find(c => c.id === id);
    if (!item) return null;
    if (typeof data.title === 'string' && data.title.trim()) item.title = data.title.trim();
    if (data.type === 'commercial' || data.type === 'bumper') item.type = data.type;
    this.store.save();
    this.pg.write('updateCommercial', SQL.UPDATE_COMMERCIAL, [item.title, item.type, id]);
    return item;
  }

  /** Corrige la duración registrada de un archivo. Devuelve true si existía. */
  updateDurationByPath(filePath, seconds) {
    const item = this.items.find(c => c.path === filePath);
    if (!item) return false;
    item.duration = Math.round(seconds);
    item.durationFormatted = formatDuration(seconds);
    this.store.save();
    this.pg.write('updateCommercialDuration', SQL.UPDATE_COMMERCIAL_DURATION, [item.duration, item.durationFormatted, filePath]);
    return true;
  }

  delete(id) {
    const idx = this.items.findIndex(c => c.id === id);
    let removed = null;
    if (idx !== -1) {
      removed = this.items.splice(idx, 1)[0];
      this.store.save();
    }
    // También en Postgres aunque no estuviera en memoria
    this.pg.write('deleteCommercial', SQL.DELETE_COMMERCIAL, [id]);
    return removed;
  }
}

module.exports = CommercialRepository;
