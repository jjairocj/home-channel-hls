/**
 * Home Channel HLS - API de audiencia (requiere sesión de administrador: se monta bajo
 * /api/admin, protegido en routes/admin.js).
 *
 *   GET /api/admin/audience                 ahora + resumen de hoy (para el gadget)
 *   GET /api/admin/audience/history?range=  24h | 7d | 30d: gráfica, totales y programas
 */

const { summarize, RANGES } = require('../audience/AudienceStats');

const TODAY_CACHE_MS = 20 * 1000;

module.exports = function registerAudienceRoutes(app, ctx) {
  const { db, audience } = ctx;

  const handle = (fn) => async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await fn(req));
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  };

  /** Muestras y sesiones del periodo, incluidas las sesiones aún abiertas. */
  async function periodData(from, to) {
    const [samples, sessions] = await Promise.all([
      db.audience.samplesRange(from.toISOString(), to.toISOString()),
      db.audience.sessionsRange(from.toISOString(), to.toISOString())
    ]);
    return { samples, sessions: [...sessions, ...audience.openSessions()] };
  }

  let todayCache = { at: 0, data: null };
  app.get('/api/admin/audience', handle(async () => {
    const now = audience.current();
    if (!todayCache.data || Date.now() - todayCache.at > TODAY_CACHE_MS) {
      const to = new Date();
      const from = new Date(to);
      from.setHours(0, 0, 0, 0);
      const { stats } = summarize({ ...(await periodData(from, to)), from, to, bucketMinutes: 60 });
      todayCache = { at: Date.now(), data: stats };
    }
    return { now, today: todayCache.data };
  }));

  app.get('/api/admin/audience/history', handle(async (req) => {
    const range = RANGES[req.query.range] ? req.query.range : '24h';
    const { hours, bucketMinutes } = RANGES[range];
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600 * 1000);
    const data = await periodData(from, to);
    return { range, bucketMinutes, from: from.toISOString(), to: to.toISOString(), now: audience.current(), ...summarize({ ...data, from, to, bucketMinutes }) };
  }));
};
