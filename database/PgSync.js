/**
 * Home Channel HLS - Sincronización memoria ⇄ PostgreSQL.
 *
 *  refresh()  Postgres → memoria (la fuente oficial al conectar y tras ciertos cambios)
 *  push()     memoria → Postgres (cambios hechos mientras no había conexión)
 *
 * Nota: los borrados hechos sin conexión no se propagan (el registro reaparecería);
 * son poco frecuentes y se pueden repetir desde el panel.
 */

const SQL = require('./sql');
const { isConnectionError } = require('./PgConnection');

const now = () => new Date().toISOString();

class PgSync {
  constructor(store, pg) {
    this.store = store;
    this.pg = pg;
  }

  async refresh() {
    if (!this.pg.available) return;
    const data = this.store.data;
    try {
      const [shows, commercials, cfg, jobs] = await Promise.all([
        this.pg.query(SQL.SELECT_SHOWS_WITH_EPISODES),
        this.pg.query(SQL.SELECT_COMMERCIALS),
        this.pg.query(SQL.SELECT_SCHEDULE_CONFIG),
        this.pg.query(SQL.SELECT_JOBS)
      ]);
      data.shows = shows.rows || [];
      data.commercials = commercials.rows || [];
      if (cfg.rows.length) {
        const row = cfg.rows[0];
        data.scheduleConfig = {
          mode: row.mode || 'random',
          commercialsFrequency: row.commercialsFrequency || 'medium',
          weeklyGrid: row.weeklyGrid || {}
        };
      }
      data.transcodeJobs = jobs.rows || [];

      // Programador por reglas (tablas creadas por las migraciones)
      try {
        const [series, rules, airings, proposals] = await Promise.all([
          this.pg.query(SQL.SELECT_PROGRAMMING_SERIES),
          this.pg.query(SQL.SELECT_SCHEDULE_RULES),
          this.pg.query(SQL.SELECT_RECENT_AIRINGS),
          this.pg.query(SQL.SELECT_PROPOSALS)
        ]);
        const iso = (d) => (d instanceof Date ? d.toISOString() : d);
        data.programmingSeries = series.rows.map(r => ({ ...r, updatedAt: iso(r.updatedAt) }));
        data.scheduleRules = rules.rows.map(r => ({ ...r, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) }));
        data.airingLog = airings.rows.map(r => ({ ...r, airedAt: iso(r.airedAt) }));
        data.proposals = proposals.rows.map(r => ({ ...r, createdAt: iso(r.createdAt), decidedAt: iso(r.decidedAt) }));
      } catch (e) {
        console.warn('[DB/Postgres] Tablas del programador no disponibles:', e.message);
      }

      try {
        const settings = await this.pg.query(SQL.SELECT_SETTINGS);
        data.settings = { ...(data.settings || {}) };
        for (const row of settings.rows) data.settings[row.key] = row.value;
      } catch (e) {}

      this.store.save();
      console.log(`[DB/Postgres] 🔄 Memoria sincronizada desde PostgreSQL: ${data.shows.length} shows, ${data.commercials.length} comerciales, ${data.transcodeJobs.length} jobs.`);
    } catch (err) {
      console.error('[DB/Postgres] Error al refrescar datos desde PostgreSQL:', err.message);
      if (isConnectionError(err)) this.pg.handleDisconnect(err.message);
    }
  }

  /**
   * Refresca únicamente la tabla de trabajos de transcodificación desde Postgres,
   * evitando recargar todas las series, episodios, reglas e historial cada 10s.
   */
  async refreshJobs() {
    if (!this.pg.available) return;
    try {
      const jobs = await this.pg.query(SQL.SELECT_JOBS);
      this.store.data.transcodeJobs = jobs.rows || [];
    } catch (err) {
      if (isConnectionError(err)) this.pg.handleDisconnect(err.message);
    }
  }

  async push() {
    console.log('[DB/Postgres] ⬆️ Subiendo cambios realizados sin conexión...');
    const data = this.store.data;
    const q = (sql, params) => this.pg.query(sql, params);
    try {
      for (const sh of data.shows || []) {
        await q(SQL.UPSERT_SHOW_FULL, [sh.id, sh.title, sh.description || '', sh.category || 'Animación',
          sh.color || '#00f0ff', sh.currentEpisodeIndex || 0, sh.createdAt || now()]);
        for (const ep of sh.episodes || []) {
          await q(SQL.UPSERT_EPISODE, [ep.id, sh.id, ep.title, parseInt(ep.season, 10) || 1, parseInt(ep.episode, 10) || 1,
            ep.filename, ep.path, Math.round(ep.duration || 0), ep.durationFormatted || '00:00',
            String(ep.sizeMB || '0'), ep.status || 'ready', ep.createdAt || now()]);
        }
      }
      for (const c of data.commercials || []) {
        await q(SQL.UPSERT_COMMERCIAL, [c.id, c.title, c.type || 'commercial', c.filename, c.path,
          Math.round(c.duration || 0), c.durationFormatted || '00:30', String(c.sizeMB || '0'), c.status || 'ready', c.createdAt || now()]);
      }
      const cfg = data.scheduleConfig || {};
      await q(SQL.UPSERT_SCHEDULE_CONFIG, [cfg.mode || 'random', cfg.commercialsFrequency || 'medium', JSON.stringify(cfg.weeklyGrid || {})]);
      for (const j of data.transcodeJobs || []) {
        await q(SQL.UPSERT_JOB, [j.id, j.inputPath, j.originalFilename, j.type || 'show', j.showId || null, j.title || '',
          parseInt(j.season, 10) || 1, parseInt(j.episode, 10) || 1, parseInt(j.progress, 10) || 0, parseFloat(j.fps) || 0,
          j.status || 'pending', j.error || null, j.createdAt || now()]);
      }
      for (const s of data.programmingSeries || []) {
        await q(SQL.UPSERT_PROGRAMMING_SERIES, [s.sagaKey, s.franja, s.frequency, s.order, s.maxDaily, !!s.marathon, !!s.excluded]);
      }
      for (const r of data.scheduleRules || []) {
        await q(SQL.UPSERT_SCHEDULE_RULE, [r.id, r.kind, r.target, JSON.stringify(r.days), r.startTime, r.slots, r.source,
          r.priority || 0, r.enabled !== false, r.note || null, r.createdAt || now()]);
      }
      for (const [key, value] of Object.entries(data.settings || {})) {
        await q(SQL.INSERT_SETTING_IF_MISSING, [key, value]);
      }
      this.pg.dirtyWhileOffline = false;
      console.log('[DB/Postgres] ✅ Cambios sin conexión sincronizados.');
    } catch (err) {
      console.error('[DB/Postgres] Error subiendo cambios locales:', err.message);
    }
  }
}

module.exports = PgSync;
