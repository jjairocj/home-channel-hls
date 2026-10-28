/**
 * Home Channel HLS - 24/7 Linear Playout & Master Control Server
 * Arranque del servidor: emisión HLS, guía IPTV/EPG, panel de administración y
 * transcodificador. Las rutas viven en routes/ y la lógica compartida en lib/.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const Database = require('./database');
const { logAiring, recordEpisodicAiring } = require('./scheduling/DailyEpisodes');
const Scheduler = require('./scheduler');
const { COMMERCIAL_STATS_KEY } = require('./scheduling/Scheduler');
const Transcoder = require('./transcoder');
const PlayoutEngine = require('./playout');
const { AdminAuth } = require('./lib/auth');
const { ProgrammingManager, ScheduleService } = require('./programming');

const registerPublicRoutes = require('./routes/public');
const registerAdminRoutes = require('./routes/admin');
const registerImportRoutes = require('./routes/imports');

const PORT = process.env.PORT || 3000;
const app = express();

// Solo se confía en proxies de red privada (cloudflared llega por la red de Docker).
// Así req.ip es la IP real del visitante y una cabecera X-Forwarded-For falsa no sirve
// para hacerse pasar por 127.0.0.1.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
app.disable('x-powered-by');

// Bloqueo total de indexación para Google y motores de búsqueda (cabecera HTTP global)
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
  // CORS abierto únicamente para las rutas públicas de emisión, guía y estado (Smart TVs, IPTV, reproductores web)
  if (!req.path.startsWith('/api/admin') && !req.path.startsWith('/api/auth') && !req.path.startsWith('/admin')) {
    cors()(req, res, next);
    return;
  }
  next();
});

app.use(express.json({ limit: '2mb' }));

/* ---------- Directorios ---------- */
const mediaRoot = path.resolve(__dirname, 'media');
const uploadsTempDir = path.join(mediaRoot, 'uploads_temp');
const ingestDir = path.resolve(mediaRoot, 'ingest');
for (const dir of [uploadsTempDir, ingestDir]) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
}

/* ---------- Módulos del sistema ---------- */
const db = new Database();
const scheduler = new Scheduler(db);
const transcoder = new Transcoder(db, scheduler);
const playout = new PlayoutEngine(scheduler);

// Cortinillas "A continuación" y carteleras nuevas: la cola de 24 h se arma con los clips
// que ya existían, así que al terminar una tanda se reprograma en el próximo :00/:30
// (sin cortar el programa en curso). Como mucho una vez cada 30 minutos (un cambio de bloque).
const CLIPS_RESYNC_COOLDOWN_MS = 30 * 60 * 1000;
let lastClipsResync = 0;
scheduler.onClipsReady = (count) => {
  if (Date.now() - lastClipsResync < CLIPS_RESYNC_COOLDOWN_MS || !playout.isRunning) return;
  lastClipsResync = Date.now();
  const at = playout.requestResync(`${count} cortinillas/carteleras nuevas listas`);
  console.log(`[Señal] 🗓️ ${count} clips de "lo que sigue" listos; se aplican en el próximo bloque (${at || 'pendiente'}).`);
};
// Un comercial o bumper nuevo entra a la emisión en el próximo bloque (:00/:30)
transcoder.on('jobCompleted', (job) => {
  if (job.type === 'commercial' || job.type === 'bumper') {
    playout.requestResync(job.type === 'commercial' ? 'Comercial nuevo' : 'Bumper nuevo');
  }
});
// Cada estreno emitido (o saltado) avanza el puntero de su serie y queda registrado
// como el capítulo del día (las repeticiones de hoy no llegan aquí: son noAdvance)
playout.on('episodeFinished', (item) => {
  try {
    db.advanceShowProgress(item.showId);
  } catch (e) {
    console.warn('[Playout] No se pudo avanzar progreso del show:', e.message);
  }
});
// Historial de emisiones: estrenos (repetidos el resto del día y en el maratón del fin
// de semana), repeticiones, maratones y capítulos al azar
playout.on('showAired', (item) => {
  try {
    logAiring(db, item);
  } catch (e) {
    console.warn('[Playout] No se pudo registrar la emisión:', e.message);
  }
  try {
    if (item.episodic) {
      const media = scheduler && scheduler.planner ? scheduler.planner.getMedia() : { programs: db.getShows() };
      const programs = media.programs || db.getShows() || [];
      const { loadProfiles } = require('./programming/profiles');
      const { detectSagas } = require('./programming/sagas');
      const profiles = loadProfiles(db);
      const sagas = detectSagas(programs, profiles);
      recordEpisodicAiring(db, item, { sagas, programs });
    }
  } catch (e) {
    console.warn('[Playout] No se pudo registrar progreso episódico:', e.message);
  }
});
playout.on('commercialAired', (item) => {
  try {
    if (scheduler && scheduler.rotation) {
      scheduler.rotation.recordLiveAiring(item);
      const stats = scheduler.rotation.exportStats();
      db.setJsonSetting(COMMERCIAL_STATS_KEY, stats).catch((err) => {
        console.warn('[Commercials] No se pudo guardar stats de rotación:', err.message);
      });
    }
  } catch (e) {
    console.warn('[Playout] No se pudo registrar la emisión del comercial:', e.message);
  }
});
const auth = new AdminAuth(db);
// Programador por reglas: la grilla sale de reglas manuales y sugeridas (ver programming/)
const schedule = new ScheduleService({ db, scheduler, playout });
const programming = new ProgrammingManager({ db, schedule });
auth.ready().catch((e) => console.error('[Auth] Error inicializando autenticación:', e.message));

const VALID_HOST_RE = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/;
const getBaseUrl = (req) => {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const rawHost = String((req && req.headers && req.headers.host) || '').trim();
  const host = VALID_HOST_RE.test(rawHost) ? rawHost : process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).host : 'localhost:3000';
  const rawProto = String((req && req.headers && req.headers['x-forwarded-proto']) || (req && req.secure ? 'https' : (req && req.protocol)) || 'http').split(',')[0].trim().toLowerCase();
  const proto = rawProto === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
};

// Radio FM: emisoras con stream de audio en vivo y locutor (ver radio/)
const RadioService = require('./radio');
const radio = new RadioService({ radioDir: path.join(mediaRoot, 'radio'), streamDir: path.join(__dirname, 'stream') });

// Audiencia: espectadores por los pedidos de la lista HLS (ver audience/)
const { AudienceTracker } = require('./audience/AudienceTracker');
const { programName } = require('./audience/AudienceStats');
const audience = AudienceTracker.fromDb(db, {
  getProgram: () => programName(playout.currentTrack && playout.currentTrack.blockTitle)
});

const ctx = { db, scheduler, transcoder, playout, auth, programming, schedule, radio, audience, getBaseUrl, port: PORT, mediaRoot, uploadsTempDir, ingestDir };

/* ---------- Autenticación ---------- */
auth.registerRoutes(app);

// Panel /admin: sin sesión válida se sirve siempre la pantalla de login.
// Debe registrarse ANTES del express.static general para proteger la carpeta.
app.use('/admin', async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  await auth.ready();
  if (auth.hasSession(req)) return next();
  return res.sendFile(path.join(__dirname, 'public/admin/login.html'));
}, express.static(path.join(__dirname, 'public/admin')));

// Sitio público (televisor). Revalidación en cada carga para que los cambios se vean
// sin vaciar caché (Safari incluido); con ETag la respuesta suele ser un 304 vacío.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (/\.(png|svg|jpg|ico|woff2?)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

/* ---------- Rutas ---------- */
registerPublicRoutes(app, ctx);
registerAdminRoutes(app, ctx);
registerImportRoutes(app, ctx);

// Errores de Express (p. ej. subidas abortadas por el cliente) sin tumbar el servidor
app.use((err, req, res, next) => {
  if (err.code === 'ECONNABORTED' || err.message === 'Request aborted') {
    console.warn('[Server] Cliente abortó la subida o la conexión fue interrumpida.');
    if (!res.headersSent) return res.status(400).json({ error: 'La subida fue interrumpida por el cliente o proxy.' });
    return;
  }
  console.error('[Server] Error capturado en middleware:', err);
  if (!res.headersSent) res.status(500).json({ error: 'Error interno del servidor' });
});

// La emisión es prioritaria: se registran los errores inesperados sin detener el proceso
process.on('uncaughtException', (err) => {
  console.error('[Process] Excepción no capturada:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Promesa rechazada no capturada:', reason);
});

/* ---------- Arranque ---------- */
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log('================================================================');
  console.log('📺 Home Channel HLS - PLAYOUT ENGINE & MASTER CONTROL');
  console.log('================================================================');
  console.log(`🚀 Televisor retro 90s:   http://localhost:${PORT}`);
  console.log(`🎛️  Master Control (admin): http://localhost:${PORT}/admin`);
  console.log(`📡 Stream HLS 1080p:       http://localhost:${PORT}/live/channel.m3u8`);
  console.log(`📋 Lista IPTV (M3U):       http://localhost:${PORT}/channel.m3u`);
  console.log(`📅 Guía EPG (XMLTV):       http://localhost:${PORT}/epg.xml`);
  console.log('================================================================');

  // Esperar a que la base de datos cargue (o falle y use el respaldo local) antes de
  // armar la parrilla, para no emitir con una mediateca vacía
  try { await db.ready; } catch (e) {}
  audience.begin();

  // Programador: migración única de la configuración anterior a reglas y grilla
  // compilada desde las reglas (antes del primer armado de la emisión)
  try {
    schedule.migrateLegacy();
    if (db.programming.rules.all().length) db.updateScheduleConfig({ mode: 'weekly', weeklyGrid: schedule.compile().calendarGrid });
  } catch (e) {
    console.error('[Programador] Error preparando la parrilla por reglas:', e.message);
  }

  try {
    scheduler.scanMedia();
    playout.syncToClock({ forceImmediate: true });
  } catch (e) {
    console.log(`[Playout]: Esperando inicio manual (${e.message})`);
  }

  // Revisión automática de la programación (propone; nunca aplica sin aprobación)
  programming.start();

  // Radio: escanea la música y pone al aire las emisoras que tengan temas
  radio.start().catch(e => console.warn('[Radio] Error al iniciar:', e.message));

  // Auditoría de duraciones: si alguna estaba mal registrada, la emisión se recalcula
  setTimeout(auditDurations, DURATION_AUDIT_FIRST_MS);
  setInterval(auditDurations, DURATION_AUDIT_EVERY_MS);
});

/* ---------- Auditoría de duraciones ----------
 * Duraciones heredadas inexactas (p. ej. 1380 s copiados de la base) hacen que el P100 y
 * la guía se adelanten al video. Se re-miden con ffprobe en baja prioridad.
 */
const DURATION_AUDIT_FIRST_MS = 2 * 60 * 1000;
const DURATION_AUDIT_EVERY_MS = 24 * 60 * 60 * 1000;
async function auditDurations() {
  try {
    const fixes = await scheduler.auditDurations();
    if (!fixes.length) return;
    const total = fixes.reduce((sum, f) => sum + Math.abs(f.after - f.before), 0);
    console.log(`[Duraciones] 🔧 ${fixes.length} duraciones corregidas (diferencia total ${Math.round(total)} s).`);
    if (playout.isRunning) playout.requestResync('Duraciones corregidas');
  } catch (e) {
    console.warn('[Duraciones] Error en la auditoría:', e.message);
  }
}

/* ---------- Apagado ordenado ----------
 * Al detener el contenedor: se deja de tomar trabajos de transcodificación, se espera a
 * que terminen los capítulos en curso (la emisión sigue mientras tanto) y luego se cierra.
 * Requiere stop_grace_period en docker-compose mayor que TRANSCODER_DRAIN_MS.
 */
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} recibido: apagado ordenado...`);

  const drainMs = parseInt(process.env.TRANSCODER_DRAIN_MS || '280000', 10);
  try { await transcoder.drain(drainMs); } catch (e) {}

  audience.stop();
  playout.stop();
  radio.stop();
  db.flushLocalJsonSync();
  server.close();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
