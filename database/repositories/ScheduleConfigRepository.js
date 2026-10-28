/**
 * Home Channel HLS - Configuración de la parrilla (modo, frecuencia de comerciales, grilla semanal).
 */

const SQL = require('../sql');

class ScheduleConfigRepository {
  constructor({ store, pg }) {
    this.store = store;
    this.pg = pg;
  }

  get() {
    return this.store.data.scheduleConfig;
  }

  update(config) {
    const cfg = { ...this.store.data.scheduleConfig, ...config };
    this.store.data.scheduleConfig = cfg;
    this.store.save();
    this.pg.write('updateScheduleConfig', SQL.UPSERT_SCHEDULE_CONFIG, [
      cfg.mode || 'random', cfg.commercialsFrequency || 'medium', JSON.stringify(cfg.weeklyGrid || {})
    ]);
    return cfg;
  }
}

module.exports = ScheduleConfigRepository;
