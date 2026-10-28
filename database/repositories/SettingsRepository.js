/**
 * Home Channel HLS - Ajustes del sistema (tabla app_settings): perfiles de programación,
 * propuestas, candados, grupos de temporadas…
 */

const SQL = require('../sql');

class SettingsRepository {
  constructor({ store, pg }) {
    this.store = store;
    this.pg = pg;
  }

  get settings() {
    if (!this.store.data.settings) this.store.data.settings = {};
    return this.store.data.settings;
  }

  /** Ajuste JSON desde memoria (sincrónico; se carga de Postgres al conectar). */
  getJson(key, defaultValue = null) {
    const raw = this.settings[key];
    if (raw === undefined || raw === null || raw === '') return defaultValue;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return defaultValue;
    }
  }

  setJson(key, value) {
    return this.set(key, JSON.stringify(value));
  }

  async get(key) {
    if (this.pg.available) {
      try {
        const res = await this.pg.query(SQL.SELECT_SETTING, [key]);
        if (res.rows.length) return res.rows[0].value;
      } catch (e) {
        console.warn(`[DB/Settings] Error leyendo setting ${key} en PostgreSQL:`, e.message);
      }
    }
    return this.settings[key] || null;
  }

  async set(key, value) {
    this.settings[key] = value;
    this.store.save();
    await this.pg.write(`guardando setting ${key}`, SQL.UPSERT_SETTING, [key, value]);
  }
}

module.exports = SettingsRepository;
