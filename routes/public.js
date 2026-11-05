/**
 * CrHe X-99 - Rutas públicas: estado de emisión, guía, videoteca, IPTV (M3U/EPG) y HLS.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const Scheduler = require('../scheduler');
const { buildWeekGuide } = require('../guide/WeekGuide');
const { renderGuidePdf } = require('../guide/GuidePdf');

const IPTV_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept'
};

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

module.exports = function registerPublicRoutes(app, ctx) {
  const { db, scheduler, playout, auth, power, getBaseUrl, port } = ctx;

  // Segmentos HLS. Los nombres son únicos (numeración epoch), así que pueden cachearse
  // en Cloudflare sin riesgo de servir un segmento viejo; la playlist nunca se cachea.
  // Solo se sirven playlists y segmentos: las listas internas de FFmpeg (playlist.txt)
  // viven en la misma carpeta y contienen rutas del servidor.
  app.use('/live', (req, res, next) => {
    res.set(IPTV_CORS);
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if (!/\.(m3u8|ts)$/.test(req.path)) return res.sendStatus(404);

    if (req.path.endsWith('.m3u8')) {
      // Cada reproductor pide la lista cada ~4 s: así se cuenta la audiencia
      if (ctx.audience) ctx.audience.hit(req);
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      res.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    } else if (req.path.endsWith('.ts')) {
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      res.set('Content-Type', 'video/mp2t');
    }
    next();
  }, express.static(path.join(__dirname, '..', 'stream'), { etag: false, lastModified: false, cacheControl: false }));

  const waitForPlaylist = async (m3u8Path, maxWaitMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        if (fs.existsSync(m3u8Path)) {
          const content = fs.readFileSync(m3u8Path, 'utf8');
          if (content.includes('#EXTINF')) return true;
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  };

  const createChannelHlsMiddleware = (getEngine, fallbackDir) => {
    return async (req, res, next) => {
      res.set(IPTV_CORS);
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      if (!/\.(m3u8|ts)$/.test(req.path)) return res.sendStatus(404);

      const engine = typeof getEngine === 'function' ? getEngine() : getEngine;
      const dir = (engine && engine.streamDir) || fallbackDir;

      if (engine && typeof engine.touch === 'function') {
        engine.touch();
      }

      if (req.path.endsWith('.m3u8')) {
        if (ctx.audience) ctx.audience.hit(req);
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        res.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');

        const m3u8File = path.join(dir, path.basename(req.path));
        await waitForPlaylist(m3u8File);
      } else if (req.path.endsWith('.ts')) {
        res.set('Cache-Control', 'public, max-age=86400, immutable');
        res.set('Content-Type', 'video/mp2t');
      }
      next();
    };
  };

  // HLS Canales secundarios: Los Simpsons y Futurama se unificaron en Random (redirección 302 transparente)
  app.use(['/simpsons/live', '/futurama/live'], (req, res) => {
    res.redirect(302, '/random/live/channel.m3u8');
  });

  // HLS Canal 101: Random 24/7 (Bajo demanda / On-demand o continuo)
  const randomDir = path.join(__dirname, '..', 'stream_random');
  app.use('/random/live',
    createChannelHlsMiddleware(() => ctx.randomPlayout, randomDir),
    express.static(randomDir, { etag: false, lastModified: false, cacheControl: false })
  );

  /* ---------- IPTV: M3U y EPG ---------- */
  app.options(['/channel.m3u', '/channel.m3u8', '/playlist.m3u', '/playlist.m3u8', '/epg.xml'], (req, res) => {
    res.set(IPTV_CORS).sendStatus(204);
  });

  app.all(['/channel.m3u', '/channel.m3u8', '/playlist.m3u', '/playlist.m3u8'], (req, res) => {
    res.set(IPTV_CORS);
    if (req.method === 'OPTIONS') return res.sendStatus(204);

    const baseUrl = getBaseUrl(req);
    const id = Scheduler.EPG_CHANNEL_ID;
    const isHls = req.path.endsWith('.m3u8');
    console.log(`[IPTV] 📺 Solicitud de lista M3U (${req.method} ${req.path}) desde ${req.ip} (Host: ${req.headers.host || 'desconocido'}, UA: ${req.headers['user-agent'] || 'none'}) -> Base: ${baseUrl}`);

    // Líneas con CRLF (\r\n) y estructura estricta para reproductores Smart TV (TiviMate, SS-IPTV, Smart IPTV, Kodi, etc.)
    const lines = [
      `#EXTM3U url-tvg="${baseUrl}/epg.xml" x-tvg-url="${baseUrl}/epg.xml"`,
      `#EXTINF:-1 tvg-id="${id}" tvg-name="CrHe TV" tvg-logo="${baseUrl}/img/logo.png" group-title="Retro 90s" tvg-chno="100",CrHe TV`,
      `${baseUrl}/live/channel.m3u8`,
      `#EXTINF:-1 tvg-id="random_tv" tvg-name="Random 24/7" tvg-logo="${baseUrl}/img/logo.png" group-title="Variedades" tvg-chno="101",Random 24/7`,
      `${baseUrl}/random/live/channel.m3u8`
    ];
    const m3uContent = lines.join('\r\n') + '\r\n';

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    // Para reproductores IPTV de Smart TV, application/x-mpegurl o audio/x-mpegurl es el MIME universal para listas completas .m3u
    res.set('Content-Type', isHls ? 'application/vnd.apple.mpegurl; charset=utf-8' : 'application/x-mpegurl; charset=utf-8');
    res.set('Content-Disposition', `inline; filename="${isHls ? 'channel.m3u8' : 'channel.m3u'}"`);
    if (req.method === 'HEAD') return res.status(200).end();
    res.send(m3uContent);
  });

  // EPG de 3 días: las primeras 24 h son lo que realmente está al aire; el resto se
  // proyecta con el mismo planificador. Se cachea 60 s.
  let epgCache = { key: '', xml: '', at: 0 };
  app.all('/epg.xml', (req, res) => {
    res.set(IPTV_CORS);
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if (req.method === 'HEAD') {
      res.set('Content-Type', 'application/xml; charset=utf-8');
      return res.status(200).end();
    }
    const baseUrl = getBaseUrl(req);
    const onAir = playout.getOnAirBlocks();
    const lastEnd = onAir.length ? new Date(onAir[onAir.length - 1].endTime).getTime() : Date.now();
    const projected = scheduler.planGuide(new Date(), 48 * 3).filter(b => new Date(b.startTime).getTime() >= lastEnd);
    const blocks = [...onAir, ...projected];
    const key = `${baseUrl}|${blocks.length ? blocks[0].startTime : ''}|${blocks.length}`;
    if (epgCache.key !== key || Date.now() - epgCache.at > 60000) {
      const extraChannels = `  <channel id="random_tv">
    <display-name>Random 24/7</display-name>
    <icon src="${baseUrl}/img/logo.png" />
  </channel>`;
      const extraProgrammes = ctx.randomPlayout ? ctx.randomPlayout.getXmltvProgrammes(baseUrl, new Date(), 36) : '';
      epgCache = { key, xml: scheduler.generateXmltv(baseUrl, blocks, { extraChannels, extraProgrammes }), at: Date.now() };
    }
    res.set(IPTV_CORS);
    res.set('Cache-Control', 'public, max-age=60');
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(epgCache.xml);
  });

  /* ---------- TeleGuía semanal en PDF ---------- */
  // La revista de la semana (portada + un día por página). Se arma con el mismo
  // planificador que la emisión y se guarda 10 minutos para no recalcularla en cada descarga.
  const PDF_CACHE_MS = 10 * 60 * 1000;
  let pdfCache = { key: '', buffer: null, at: 0, filename: '' };
  app.get('/guia-semanal.pdf', async (req, res) => {
    try {
      const week = buildWeekGuide(scheduler, new Date());
      const key = week.from.toISOString();
      if (pdfCache.key !== key || !pdfCache.buffer || Date.now() - pdfCache.at > PDF_CACHE_MS) {
        const chunks = [];
        const { PassThrough } = require('stream');
        const sink = new PassThrough();
        sink.on('data', (c) => chunks.push(c));
        const done = new Promise((resolve, reject) => { sink.on('end', resolve); sink.on('error', reject); });
        renderGuidePdf(week, sink);
        await done;
        const d = week.from;
        const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        pdfCache = { key, buffer: Buffer.concat(chunks), at: Date.now(), filename: `TeleGuia-X99-semana-${stamp}.pdf` };
      }
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `${req.query.ver ? 'inline' : 'attachment'}; filename="${pdfCache.filename}"`);
      res.set('Cache-Control', 'public, max-age=300');
      res.send(pdfCache.buffer);
    } catch (e) {
      console.error('[TeleGuía PDF] Error generando la revista:', e);
      res.status(500).send('No se pudo generar la guía en PDF.');
    }
  });

  /* ---------- Estado de emisión ---------- */
  // Liviano: lo consulta cada espectador cada pocos segundos. La telemetría eléctrica y
  // los datos del sistema solo se incluyen para el Master Control.
  app.get('/api/status', async (req, res) => {
    const baseUrl = getBaseUrl(req);
    const isAdmin = auth.hasSession(req);
    const body = {
      ...playout.getStatus(),
      simpsons: ctx.simpsonsPlayout ? ctx.simpsonsPlayout.getStatus() : null,
      futurama: ctx.futuramaPlayout ? ctx.futuramaPlayout.getStatus() : null,
      random: ctx.randomPlayout ? ctx.randomPlayout.getStatus() : null,
      urls: {
        hls: `${baseUrl}/live/channel.m3u8`,
        simpsonsHls: `${baseUrl}/simpsons/live/channel.m3u8`,
        futuramaHls: `${baseUrl}/futurama/live/channel.m3u8`,
        randomHls: `${baseUrl}/random/live/channel.m3u8`,
        ...(isAdmin ? { m3u: `${baseUrl}/channel.m3u`, epg: `${baseUrl}/epg.xml` } : {})
      }
    };

    if (isAdmin) {
      body.power = await power.get();
      body.system = { platform: process.platform, nodeVersion: process.version, port };
    }

    res.set('Cache-Control', 'no-store');
    res.json(body);
  });

  app.get('/api/system/power', async (req, res) => {
    if (!auth.isAuthorized(req)) return res.status(401).json({ error: 'No autorizado' });
    res.json(await power.get());
  });

  /* ---------- Videoteca pública ---------- */
  app.get('/api/media', (req, res) => {
    if (auth.hasSession(req)) {
      if (req.query.rescan === 'true') scheduler.scanMedia();
      return res.json(scheduler.mediaCache);
    }

    // Visitantes: solo series que están en la parrilla (sin capítulos ni rutas físicas)
    const config = db.getScheduleConfig() || {};
    const weeklyGrid = config.weeklyGrid || {};
    const scheduledShowIds = new Set();

    for (const day of Object.keys(weeklyGrid)) {
      for (const slot of Object.values(weeklyGrid[day] || {})) {
        if (slot && slot !== 'off_air') scheduledShowIds.add(slot);
      }
    }
    for (const block of playout.getOnAirBlocks()) {
      if (block.mainShow && block.mainShow.showId) scheduledShowIds.add(block.mainShow.showId);
    }

    const publicPrograms = (db.getShows() || [])
      .filter(s => scheduledShowIds.size === 0 || scheduledShowIds.has(s.id))
      .map(s => ({
        id: s.id,
        title: s.title,
        description: s.description || '',
        category: s.category || 'Animación',
        color: s.color || '#00f0ff',
        totalEpisodes: (s.episodes ? s.episodes.length : 0)
      }));

    res.json({ programs: publicPrograms, shows: publicPrograms });
  });

  /* ---------- Guía de programación ---------- */
  app.get('/api/schedule', (req, res) => {
    const reqDay = req.query.day ? String(req.query.day).toLowerCase().trim() : 'today';

    // Otros días: proyección con el mismo planificador que la emisión (coincide con lo
    // que realmente saldrá al aire según la grilla, las sagas y el avance de cada serie)
    if (DAY_KEYS.includes(reqDay)) {
      const jsDay = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }[reqDay];
      const now = new Date();
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() + ((jsDay - now.getDay() + 7) % 7));
      const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

      const slotStart = new Date(now);
      slotStart.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0);
      const slotsNeeded = Math.min(48 * 8, Math.ceil((dayEnd - slotStart) / 1800000));
      const pad = (n) => String(n).padStart(2, '0');
      const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

      const dayBlocks = scheduler.planGuide(now, slotsNeeded)
        .filter(b => new Date(b.startTime) >= dayStart && new Date(b.startTime) < dayEnd)
        .map((b, i) => {
          const start = new Date(b.startTime);
          const end = new Date(b.endTime);
          const isSpecial = (b.durationSeconds || 1800) > 1800;
          let cleanTitle = b.isOffAir ? 'CrHe X-99 // Cierre de Emisión' : b.title.replace(/\s*\(Doble Episodio\)/i, '').trim();
          if (isSpecial && !cleanTitle.includes('Especial') && !b.isOffAir) {
            cleanTitle += ' (Especial 1 Hora)';
          }
          return {
            slotNumber: i + 1,
            time: hhmm(start),
            endTime: hhmm(end),
            title: cleanTitle,
            category: b.isOffAir ? 'Cierre Nocturno' : (b.category || 'Animación'),
            durationSeconds: b.durationSeconds || 1800,
            isOffAir: !!b.isOffAir,
            isRepeat: !!b.isRepeat
          };
        });

      return res.json({ day: reqDay, date: dayStart.toISOString(), blocks: dayBlocks, totalBlocks: dayBlocks.length });
    }

    // Hoy: lo que realmente está al aire (sin bumpers, comerciales ni números de capítulo)
    const publicBlocks = playout.getOnAirBlocks().map(b => {
      const isOffAir = b.isOffAir || (b.title && b.title.toLowerCase().includes('cierre'));
      const isSpecial = (b.durationSeconds || 1800) > 1800;
      let cleanTitle = 'CrHe X-99 // Transmisión Especial';
      if (isOffAir) {
        cleanTitle = 'CrHe X-99 // Cierre de Emisión';
      } else if (b.title) {
        cleanTitle = b.title.replace(/\s*\(Doble Episodio\)/i, '').trim();
      } else if (b.mainShow) {
        cleanTitle = b.mainShow.showTitle || scheduler.cleanShowTitle(b.mainShow.name);
      }
      if (isSpecial && !cleanTitle.includes('Especial') && !isOffAir) {
        cleanTitle += ' (Especial 1 Hora)';
      }

      return {
        slotNumber: b.slotNumber,
        startTime: b.startTime,
        endTime: b.endTime,
        title: cleanTitle,
        category: b.category,
        durationSeconds: b.durationSeconds || 1800,
        isOffAir: !!isOffAir,
        isRepeat: !!b.isRepeat
      };
    });

    res.json({
      day: 'today',
      blocks: publicBlocks,
      totalBlocks: publicBlocks.length,
      clockSync: scheduler.getCurrentSlotInfo(),
      pendingResyncAt: playout.resyncAt || null
    });
  });

  app.get('/api/schedule/clock-status', (req, res) => {
    res.json(scheduler.getCurrentSlotInfo());
  });

  /* ---------- Radio FM ----------
   * Cada emisora es un stream HLS de audio (/live/radio/<id>/radio.m3u8) igual para
   * todos los oyentes; aquí solo se publica qué suena y la línea de tiempo.
   */
  app.get('/api/radio/status', (req, res) => {
    if (!ctx.radio) return res.status(503).json({ error: 'Módulo de radio no disponible' });
    res.set('Cache-Control', 'no-store');
    res.json(ctx.radio.status());
  });
};
