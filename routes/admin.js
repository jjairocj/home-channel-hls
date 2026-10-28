/**
 * Home Channel HLS - Rutas protegidas del Master Control: control de emisión, series,
 * episodios, comerciales, parrilla y estado de transcodificación.
 *
 * Los cambios que afectan la parrilla NO reinician la emisión de inmediato: se aplican
 * en el siguiente cambio de bloque (:00/:30) mediante playout.requestResync().
 */

const fs = require('fs');
const path = require('path');
const { COMMERCIAL_ROTATION_KEY, COMMERCIAL_STATS_KEY, COMMERCIAL_CONFIG_KEY } = require('../scheduling/Scheduler');
const { getEpisodicOverview, resetEpisodicCycle } = require('../scheduling/DailyEpisodes');
const { detectSagas } = require('../programming/sagas');
const { loadProfiles } = require('../programming/profiles');


module.exports = function registerAdminRoutes(app, ctx) {
  const { db, scheduler, transcoder, playout, auth, mediaRoot, programming } = ctx;

  const requireAdmin = async (req, res, next) => {
    await auth.ready();
    if (!auth.isAuthorized(req)) {
      return res.status(401).json({ error: 'ACCESO NO AUTORIZADO. INGRESE CLAVE EN /admin' });
    }
    next();
  };

  /** Re-escanea la mediateca y programa la actualización de la emisión. */
  const applyScheduleChange = (reason) => {
    scheduler.scanMedia();
    scheduler.invalidateGuide();
    return playout.requestResync(reason);
  };

  /** Borra un archivo solo si está dentro de la carpeta de medios. */
  const removeMediaFile = (filePath) => {
    if (!filePath) return;
    const full = path.resolve(filePath);
    if (!full.startsWith(path.resolve(mediaRoot) + path.sep)) return;
    fs.unlink(full, (err) => {
      if (err && err.code !== 'ENOENT') console.warn('[Admin] No se pudo borrar', full, err.message);
    });
  };

  /* ========================================================
     CONTROL DE EMISIÓN
  ======================================================== */
  app.use(['/api/playout', '/api/schedule/generate'], requireAdmin);

  app.post('/api/schedule/generate', (req, res) => {
    const resyncAt = applyScheduleChange('Regeneración manual de parrilla');
    res.json({
      success: true,
      resyncAt,
      message: 'Parrilla regenerada: se aplicará en el próximo bloque (:00 o :30).',
      blocks: playout.getOnAirBlocks(),
      clockSync: scheduler.getCurrentSlotInfo()
    });
  });

  app.post('/api/playout/sync-clock', (req, res) => {
    try {
      const forceImmediate = req.body && req.body.forceImmediate !== undefined ? req.body.forceImmediate : true;
      scheduler.scanMedia();
      res.json(playout.syncToClock({ forceImmediate }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/playout/start', (req, res) => {
    try {
      res.json(playout.isRunning ? playout.start() : playout.syncToClock({ forceImmediate: true }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/playout/stop', (req, res) => {
    res.json(playout.stop());
  });

  app.post('/api/playout/restart', (req, res) => {
    try {
      scheduler.scanMedia();
      const result = playout.syncToClock({ forceImmediate: true });
      res.json({ success: true, message: 'Playout reiniciado y parrilla regenerada', result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/playout/next-program', (req, res) => {
    try {
      res.json(playout.skipToNextProgram());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/playout/next-segment', (req, res) => {
    try {
      res.json(playout.skipToNextSegment());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/playout/play-show-now', (req, res) => {
    try {
      const { showId, episodeId } = req.body || {};
      if (!showId) return res.status(400).json({ error: 'showId requerido' });
      res.json(playout.playShowNow(showId, episodeId));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ========================================================
     PANEL DE ADMINISTRACIÓN
  ======================================================== */
  app.use('/api/admin', requireAdmin);

  // Series / programas
  app.get('/api/admin/shows', (req, res) => {
    res.json(db.getShows());
  });

  app.post('/api/admin/shows', (req, res) => {
    try {
      const show = db.createShow(req.body || {});
      scheduler.scanMedia();
      res.json({ success: true, show });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/admin/shows/:id', (req, res) => {
    const updated = db.updateShow(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Show no encontrado' });
    scheduler.scanMedia();
    res.json({ success: true, show: updated });
  });

  app.delete('/api/admin/shows/:id', (req, res) => {
    const show = db.getShow(req.params.id);
    if (!show) return res.status(404).json({ error: 'Show no encontrado' });

    for (const ep of show.episodes || []) removeMediaFile(ep.path);

    const removed = db.deleteShow(req.params.id);
    const resyncAt = applyScheduleChange(`Serie eliminada: ${show.title}`);
    res.json({ success: true, removed, resyncAt });
  });

  // Puntero de progreso (próximo episodio a emitir)
  app.post('/api/admin/shows/:id/progress', (req, res) => {
    const { episodeIndex } = req.body || {};
    const updated = db.updateShowProgress(req.params.id, episodeIndex);
    if (!updated) return res.status(404).json({ error: 'Show no encontrado' });
    const resyncAt = applyScheduleChange(`Próximo episodio cambiado: ${updated.title}`);
    res.json({ success: true, show: updated, resyncAt });
  });

  // Progreso y rotación de series episódicas (aleatorias)
  app.get('/api/admin/shows/episodic-progress', (req, res) => {
    try {
      const media = scheduler && scheduler.planner ? scheduler.planner.getMedia() : { programs: db.getShows() };
      const programs = media.programs || db.getShows() || [];
      const profiles = loadProfiles(db);
      const sagas = detectSagas(programs, profiles);
      const progress = getEpisodicOverview(db, { sagas, programs, profiles });
      res.json(progress);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/shows/episodic-progress/:key/reset', (req, res) => {
    try {
      const key = decodeURIComponent(req.params.key);
      let currentAiring = null;
      if (scheduler && scheduler.planner) {
        const pCtx = scheduler.planner.createContext();
        const ref = pCtx.refForValue(key);
        if (ref) currentAiring = pCtx.airingNumber(ref, new Date());
      }
      const updated = resetEpisodicCycle(db, key, currentAiring);
      const resyncAt = applyScheduleChange(`Reinicio de ciclo aleatorio para ${key}`);
      res.json({ success: true, updated, resyncAt });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Episodios
  app.put('/api/admin/shows/:showId/episodes/:epId', (req, res) => {
    const updated = db.updateEpisode(req.params.showId, req.params.epId, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Episodio no encontrado' });
    const resyncAt = applyScheduleChange('Episodio editado');
    res.json({ success: true, episode: updated, resyncAt });
  });

  app.post('/api/admin/shows/:showId/reorder', (req, res) => {
    const { episodeIds } = req.body || {};
    const updated = db.reorderEpisodes(req.params.showId, episodeIds);
    if (!updated) return res.status(404).json({ error: 'Show no encontrado' });
    const resyncAt = applyScheduleChange('Episodios reordenados');
    res.json({ success: true, show: updated, resyncAt });
  });

  app.delete('/api/admin/shows/:showId/episodes/:epId', (req, res) => {
    const removed = db.deleteEpisode(req.params.showId, req.params.epId);
    if (!removed) return res.status(404).json({ error: 'Episodio no encontrado' });
    removeMediaFile(removed.path);
    scheduler.scanMedia();
    res.json({ success: true, removed });
  });

  app.post('/api/admin/shows/batch-update-episodes', (req, res) => {
    try {
      const { updates, deletes, reorders } = req.body || {};
      if (Array.isArray(deletes)) {
        for (const d of deletes) {
          const removed = db.deleteEpisode(d.showId, d.epId);
          if (removed) removeMediaFile(removed.path);
        }
      }
      if (Array.isArray(updates)) {
        for (const u of updates) db.updateEpisode(u.showId, u.epId, u.data || {});
      }
      if (Array.isArray(reorders)) {
        for (const r of reorders) db.reorderEpisodes(r.showId, r.episodeIds);
      }
      const resyncAt = applyScheduleChange('Edición masiva de episodios');
      res.json({ success: true, resyncAt });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Comerciales y cortinillas
  /** Rotación de cada comercial: 'high', 'normal', 'low', 'very_low' o 'paused'. */
  const ROTATIONS = ['high', 'normal', 'low', 'very_low', 'paused'];
  const rotationChoices = () => db.getJsonSetting(COMMERCIAL_ROTATION_KEY, {});

  app.get('/api/admin/commercials', async (req, res) => {
    await db.refresh().catch(() => {});
    const choices = rotationChoices();
    const stats = (scheduler.rotation && scheduler.rotation.exportStats()) || (await db.getJsonSetting(COMMERCIAL_STATS_KEY, {}));
    const minBlocks = (scheduler.rotation && scheduler.rotation.getMinSeparationBlocks()) || 6;
    const cooldownMs = minBlocks * 30 * 60 * 1000;
    const now = Date.now();

    res.json(db.getCommercials().map(c => {
      const isBumper = c.type === 'bumper';
      const s = stats[c.id] || {};
      const airCount = s.airCount || 0;
      const lastAiredAt = s.lastAiredAt || null;
      const elapsedMs = lastAiredAt ? (now - new Date(lastAiredAt).getTime()) : Infinity;
      const isCoolingDown = !isBumper && airCount > 0 && elapsedMs >= 0 && elapsedMs < cooldownMs;
      const remainingCooldownBlocks = isCoolingDown ? Math.max(1, Math.ceil((cooldownMs - elapsedMs) / (30 * 60 * 1000))) : 0;

      return {
        ...c,
        rotation: choices[c.id] || 'normal',
        videoUrl: `/api/admin/commercials/${encodeURIComponent(c.id)}/video`,
        airCount,
        lastAiredAt,
        lastBlock: s.lastBlock != null ? s.lastBlock : null,
        isCoolingDown,
        remainingCooldownBlocks
      };
    }));
  });

  app.get('/api/admin/commercials/rotation', async (req, res) => {
    try {
      const config = (scheduler.rotation && scheduler.rotation.exportConfig()) || (await db.getJsonSetting(COMMERCIAL_CONFIG_KEY, { minSeparationBlocks: 6, maxSpotsPerBreak: 0 }));
      const stats = (scheduler.rotation && scheduler.rotation.exportStats()) || (await db.getJsonSetting(COMMERCIAL_STATS_KEY, {}));
      const comms = db.getCommercials().filter(c => c.type === 'commercial');
      const choices = rotationChoices();

      const activeCount = comms.filter(c => (choices[c.id] || 'normal') !== 'paused').length;
      const pausedCount = comms.length - activeCount;
      let totalAirings = 0;
      let mostAired = null;
      let leastAired = null;

      for (const c of comms) {
        const cnt = (stats[c.id] && stats[c.id].airCount) || 0;
        totalAirings += cnt;
        if (!mostAired || cnt > mostAired.count) mostAired = { id: c.id, title: c.title, count: cnt };
        if (!leastAired || cnt < leastAired.count) leastAired = { id: c.id, title: c.title, count: cnt };
      }

      res.json({
        success: true,
        config: {
          minSeparationBlocks: config.minSeparationBlocks != null ? config.minSeparationBlocks : 6,
          maxSpotsPerBreak: config.maxSpotsPerBreak != null ? config.maxSpotsPerBreak : 0,
          rotationMode: config.rotationMode || 'smart_balanced'
        },
        summary: {
          totalCommercials: comms.length,
          activeCommercials: activeCount,
          pausedCommercials: pausedCount,
          totalAirings,
          mostAired,
          leastAired
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/admin/commercials/rotation/config', async (req, res) => {
    try {
      const body = req.body || {};
      const current = (scheduler.rotation && scheduler.rotation.exportConfig()) || {};
      const updated = {
        ...current,
        minSeparationBlocks: Math.max(1, parseInt(body.minSeparationBlocks, 10) || 6),
        maxSpotsPerBreak: Math.max(0, parseInt(body.maxSpotsPerBreak, 10) || 0),
        rotationMode: body.rotationMode || 'smart_balanced'
      };

      if (scheduler.rotation) scheduler.rotation.loadConfig(updated);
      await db.setJsonSetting(COMMERCIAL_CONFIG_KEY, updated);

      const resyncAt = applyScheduleChange('Configuración de rotación de comerciales actualizada');
      res.json({ success: true, config: updated, resyncAt });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/commercials/rotation/reset', async (req, res) => {
    try {
      if (scheduler.rotation) scheduler.rotation.resetStats();
      await db.setJsonSetting(COMMERCIAL_STATS_KEY, {});
      const resyncAt = applyScheduleChange('Contadores e historial de comerciales reiniciados');
      res.json({ success: true, message: 'Historial de rotación reiniciado.', resyncAt });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/commercials/:id/video', async (req, res) => {
    try {
      const commId = req.params.id;
      const comm = (db.getCommercials() || []).find(c => c.id === commId);
      if (!comm) {
        return res.status(404).json({ error: 'Comercial o bumper no encontrado.' });
      }

      let filePath = comm.path;
      if (!filePath || !fs.existsSync(filePath)) {
        if (comm.filename) {
          const inComm = path.join(mediaRoot, 'commercials', comm.filename);
          const inBump = path.join(mediaRoot, 'bumpers', comm.filename);
          if (fs.existsSync(inComm)) filePath = inComm;
          else if (fs.existsSync(inBump)) filePath = inBump;
        }
      }

      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Archivo de video no encontrado en disco.' });
      }

      const fullPath = path.resolve(filePath);
      const rootPath = path.resolve(mediaRoot);
      if (!fullPath.startsWith(rootPath + path.sep) && fullPath !== rootPath) {
        return res.status(403).json({ error: 'Ruta no autorizada fuera de la mediateca.' });
      }

      const contentType = fullPath.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      return res.sendFile(fullPath);
    } catch (err) {
      console.error('[Commercials] Error en GET /api/admin/commercials/:id/video:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/admin/commercials/:id', async (req, res) => {
    const body = req.body || {};
    const updated = db.updateCommercial(req.params.id, body);
    if (!updated) return res.status(404).json({ error: 'Comercial o bumper no encontrado.' });
    if (body.rotation !== undefined) {
      if (!ROTATIONS.includes(body.rotation)) return res.status(400).json({ error: 'Rotación inválida.' });
      const choices = rotationChoices();
      if (body.rotation === 'normal') delete choices[updated.id];
      else choices[updated.id] = body.rotation;
      await db.setJsonSetting(COMMERCIAL_ROTATION_KEY, choices);
    }
    // La emisión se recalcula en el próximo bloque para que el cambio salga al aire
    const resyncAt = applyScheduleChange('Comerciales actualizados');
    res.json({ success: true, commercial: { ...updated, rotation: rotationChoices()[updated.id] || 'normal' }, resyncAt });
  });

  app.delete('/api/admin/commercials/:id', async (req, res) => {
    try {
      const commId = req.params.id;
      const findItem = () => db.getCommercials().find(c => c.id === commId);
      let item = findItem();
      if (!item) {
        await db.refresh();
        item = findItem();
      }
      if (!item) return res.status(404).json({ error: 'Comercial o bumper no encontrado.' });

      const removed = db.deleteCommercial(commId) || item;
      removeMediaFile(item.path || (removed && removed.path));

      await db.refresh();
      const choices = rotationChoices();
      if (choices[commId]) {
        delete choices[commId];
        await db.setJsonSetting(COMMERCIAL_ROTATION_KEY, choices);
      }
      const resyncAt = applyScheduleChange('Comercial eliminado');
      res.json({ success: true, removed: item, resyncAt });
    } catch (err) {
      console.error('[Commercials] Error en DELETE /api/admin/commercials/:id:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Estado de la cola de transcodificación
  app.get('/api/admin/transcode/status', (req, res) => {
    res.json({
      isProcessing: transcoder.isProcessing,
      activeJob: transcoder.activeJob,
      activeJobs: transcoder.activeJobs || [],
      concurrency: transcoder.concurrency || 2,
      queue: transcoder.queue,
      metrics: transcoder.getMetrics(),
      allJobs: db.getTranscodeJobs()
    });
  });

  app.post('/api/admin/transcode/update-job-titles', (req, res) => {
    const { titleMap } = req.body || {};
    if (!titleMap || typeof titleMap !== 'object') {
      return res.status(400).json({ error: 'titleMap requerido' });
    }
    let count = 0;
    for (const job of [...transcoder.queue, ...(transcoder.activeJobs || [])]) {
      const newTitle = titleMap[job.id] || titleMap[job.originalFilename];
      if (newTitle) {
        job.title = newTitle;
        db.updateTranscodeJob(job.id, { title: newTitle });
        count++;
      }
    }
    res.json({ success: true, updatedCount: count });
  });

  /* ---------- Programador por reglas (ver routes/programmer.js) ---------- */
  require('./programmer')(app, ctx);
  require('./audience')(app, ctx);

  const handle = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  };

  app.post('/api/admin/media/rescan', (req, res) => {
    const resyncAt = applyScheduleChange('Biblioteca re-escaneada');
    res.json({ success: true, mediaCache: scheduler.mediaCache, resyncAt });
  });

  /* ---------- Radio FM ---------- */
  const radio = ctx.radio;

  app.get('/api/admin/radio', handle(() => ({
    ...radio.status(),
    tracks: radio.library.tracks.map(t => ({
      id: t.id, folder: t.folder, artist: t.artist, title: t.title, album: t.album, year: t.year,
      duration: Math.round(t.duration), ready: !!t.ready,
      dj: t.dj ? { by: t.dj.dj, source: t.dj.source, script: t.dj.script } : null
    }))
  })));

  app.post('/api/admin/radio/rescan', handle(async () => {
    await radio.rescan();
    return { success: true, ...radio.status() };
  }));

  // Vuelve a escribir y grabar la presentación del DJ de una canción
  app.post('/api/admin/radio/tracks/:id/dj', handle(async (req) => {
    await radio.regenerateDj(req.params.id);
    return { success: true };
  }));

  /* ---------- Locución y Cortinillas Dinámicas (ElevenLabs & Audio8) ---------- */
  function getBumpersDir(root) {
    const candidates = [
      path.join(root, 'bumpers'),
      path.resolve(__dirname, '../media/bumpers'),
      path.resolve(__dirname, '../../media/bumpers')
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return path.join(root, 'bumpers');
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  app.get('/api/admin/bumpers', requireAdmin, (req, res) => {
    try {
      const bumpersDir = getBumpersDir(mediaRoot);
      const voiceCacheDir = path.join(bumpersDir, 'voice_cache');
      const dynamicDir = path.join(bumpersDir, 'dynamic');

      const voiceFiles = [];
      let totalVoiceBytes = 0;
      if (fs.existsSync(voiceCacheDir)) {
        const files = fs.readdirSync(voiceCacheDir);
        for (const file of files) {
          if (!file.endsWith('.mp3') && !file.endsWith('.wav')) continue;
          const fullPath = path.join(voiceCacheDir, file);
          const stat = fs.statSync(fullPath);
          totalVoiceBytes += stat.size;
          voiceFiles.push({
            filename: file,
            type: 'voice',
            sizeBytes: stat.size,
            sizeFormatted: formatBytes(stat.size),
            mtime: stat.mtime.toISOString(),
            provider: file.startsWith('eleven_') ? 'ElevenLabs (Eleven v4)' : 'Audio8_TTS',
            url: `/api/admin/bumpers/file/voice/${encodeURIComponent(file)}`
          });
        }
      }
      voiceFiles.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

      const dynamicFiles = [];
      let totalDynamicBytes = 0;
      if (fs.existsSync(dynamicDir)) {
        const files = fs.readdirSync(dynamicDir);
        for (const file of files) {
          if (!file.endsWith('.mp4') || file.includes('.tmp.')) continue;
          const fullPath = path.join(dynamicDir, file);
          const stat = fs.statSync(fullPath);
          totalDynamicBytes += stat.size;

          let kind = 'Cortinilla';
          let showTitle = file;
          let time = '';

          if (file.includes('_board_')) {
            kind = 'Cartelera de hoy';
            showTitle = 'Cartelera de programación';
          } else {
            const m = file.match(/^bumper_next_(.+?)_([0-9]+_[0-9]+_(?:am|pm))_/i);
            if (m) {
              kind = 'A continuación';
              showTitle = m[1].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
              time = m[2].replace(/_([a-z]+)$/i, ' $1').replace(/_/g, ':').toUpperCase();
            } else {
              kind = 'A continuación';
              showTitle = file.replace(/^bumper_next_/, '').replace(/\.mp4$/, '').replace(/_/g, ' ');
            }
          }

          dynamicFiles.push({
            filename: file,
            type: 'dynamic',
            kind,
            showTitle,
            time,
            sizeBytes: stat.size,
            sizeFormatted: formatBytes(stat.size),
            mtime: stat.mtime.toISOString(),
            url: `/api/admin/bumpers/file/dynamic/${encodeURIComponent(file)}`
          });
        }
      }
      dynamicFiles.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

      res.json({
        success: true,
        stats: {
          voiceCount: voiceFiles.length,
          voiceSize: formatBytes(totalVoiceBytes),
          dynamicCount: dynamicFiles.length,
          dynamicSize: formatBytes(totalDynamicBytes)
        },
        config: {
          provider: 'ElevenLabs',
          voiceName: process.env.ELEVENLABS_VOICE_NAME || 'El Faraón',
          voiceId: process.env.ELEVENLABS_VOICE_ID || 'QpDQJR3frbDwOhTIo8nW',
          modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_v4',
          backupUrl: process.env.AUDIO8_TTS_URL || 'http://192.168.68.201:8024',
          backupVoice: process.env.AUDIO8_VOICE || 'Mario'
        },
        voiceCache: voiceFiles,
        dynamicBumpers: dynamicFiles
      });
    } catch (err) {
      console.error('[Admin] Error en /api/admin/bumpers:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/admin/bumpers/file/:type/:filename', requireAdmin, (req, res) => {
    const { type, filename } = req.params;
    const safeName = path.basename(filename);
    if (!safeName || safeName !== filename || safeName.includes('..')) {
      return res.status(400).json({ error: 'Nombre de archivo inválido' });
    }

    const bumpersDir = getBumpersDir(mediaRoot);
    const targetDir = type === 'voice'
      ? path.join(bumpersDir, 'voice_cache')
      : path.join(bumpersDir, 'dynamic');

    const filePath = path.join(targetDir, safeName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const contentType = safeName.endsWith('.mp3')
      ? 'audio/mpeg'
      : safeName.endsWith('.wav')
        ? 'audio/wav'
        : 'video/mp4';

    res.setHeader('Content-Type', contentType);
    res.sendFile(filePath);
  });
};
