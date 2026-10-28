/**
 * Home Channel HLS - API del programador por reglas (requiere sesión de administrador: se
 * monta bajo /api/admin, protegido en routes/admin.js).
 *
 *   GET    /api/admin/schedule/week            vista semanal (celdas, reglas, conflictos, series)
 *   POST   /api/admin/schedule/rules           crear regla manual
 *   PUT    /api/admin/schedule/rules/:id       editar (una sugerencia editada pasa a manual)
 *   DELETE /api/admin/schedule/rules/:id       borrar
 *   POST   /api/admin/schedule/rules/batch     varios cambios con un solo recálculo (arrastrar)
 *   POST   /api/admin/schedule/rules/resolve-conflicts  quita lo que quedó tapado por otra regla
 *   GET    /api/admin/schedule/airings         historial de emisiones (?from&to)
 *   GET    /api/admin/programming              series: estado y preferencias
 *   PUT    /api/admin/programming/sagas/:key   preferencias de una serie
 *   GET    /api/admin/programming/proposal     propuesta pendiente con vista previa
 *   POST   /api/admin/programming/propose | accept | discard
 *   GET/PUT /api/admin/programming/groups…     agrupación de temporadas
 *   GET    /api/admin/programming/upcoming     capítulo de cada bloque de las próximas horas (?hours)
 */

const { upcomingAirings } = require('../programming/UpcomingEpisodes');

module.exports = function registerProgrammerRoutes(app, ctx) {
  const { schedule, programming, scheduler, playout } = ctx;

  const handle = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  };

  /* ---------- Próximos capítulos ---------- */

  app.get('/api/admin/programming/upcoming', handle((req) => {
    const hours = Math.min(72, Math.max(1, parseInt(req.query.hours, 10) || 24));
    const now = new Date();
    return {
      hours,
      pendingResyncAt: playout.resyncAt || null,
      airings: upcomingAirings({
        onAir: playout.getOnAirBlocks(),
        projected: scheduler.planGuide(now, Math.ceil(hours * 2) + 2),
        now,
        hours,
        getShow: (id) => ctx.db.getShow(id)
      })
    };
  }));

  /* ---------- Reglas y vista semanal ---------- */
  app.get('/api/admin/schedule/week', handle(() => schedule.weekView()));

  app.post('/api/admin/schedule/rules', handle((req) => ({ success: true, ...schedule.create(req.body || {}) })));

  app.post('/api/admin/schedule/rules/resolve-conflicts', handle(() => ({ success: true, ...schedule.resolveConflicts() })));

  app.post('/api/admin/schedule/rules/batch', handle((req) => ({ success: true, ...schedule.batch((req.body || {}).ops || []) })));

  app.put('/api/admin/schedule/rules/:id', handle((req) => ({ success: true, ...schedule.update(req.params.id, req.body || {}) })));

  app.delete('/api/admin/schedule/rules/:id', handle((req) => ({ success: true, ...schedule.remove(req.params.id) })));

  app.get('/api/admin/schedule/airings', handle(async (req) => {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 7 * 24 * 3600 * 1000);
    if (isNaN(from) || isNaN(to)) throw new Error('Fechas inválidas');
    return { from: from.toISOString(), to: to.toISOString(), airings: await ctx.db.programming.airings.range(from.toISOString(), to.toISOString()) };
  }));

  // Compatibilidad: la grilla compilada (la usa la vista anterior y herramientas externas)
  app.get('/api/admin/schedule-config', (req, res) => res.json(ctx.db.getScheduleConfig()));

  /* ---------- Series y propuestas ---------- */
  app.get('/api/admin/programming', handle(() => programming.overview()));

  app.put('/api/admin/programming/sagas/:key', handle((req) => {
    const prefs = programming.setSagaOptions(req.params.key, req.body || {});
    // Orden, frecuencia o maratón cambian qué capítulos salen: recalcular la emisión
    scheduler.invalidateGuide();
    return { success: true, prefs, resyncAt: playout.requestResync('Preferencias de la serie cambiadas') };
  }));

  app.get('/api/admin/programming/proposal', handle(() => programming.getProposal()));

  app.post('/api/admin/programming/propose', handle(() => programming.propose('Generada manualmente')));

  app.post('/api/admin/programming/accept', handle((req) => ({ success: true, resyncAt: programming.accept((req.body || {}).id) })));

  app.post('/api/admin/programming/discard', handle(() => {
    programming.discard();
    return { success: true };
  }));

  /* ---------- Agrupación de temporadas ---------- */
  app.get('/api/admin/programming/groups', handle(() => programming.groupsOverview()));

  app.put('/api/admin/programming/shows/:id/group', handle(async (req) => {
    const result = await programming.setShowGroup(req.params.id, req.body || {});
    scheduler.invalidateGuide();
    return { success: true, ...result };
  }));
};
