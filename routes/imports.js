/**
 * Home Channel HLS - Media Ingestion Routes (protegidas por /api/admin):
 * subida por bloques, importación desde grabaciones / descargas_mkv, importación en lote
 * y descargas de Google Drive con rclone.
 *
 * Todo nombre de archivo recibido se valida con safeJoin para que no pueda salir de su
 * carpeta (el transcodificador borra el archivo de origen al terminar).
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const multer = require('multer');
const { safeJoin, safeId } = require('../lib/paths');
const { formatDuration } = require('../core/time');

const MAX_CHUNKS = 20000;
const ORPHAN_UPLOAD_TTL_MS = 6 * 3600 * 1000; // 6 horas para bloques huérfanos
const FOLDER_STATS_CACHE_MS = 20 * 1000; // 20s de caché para no escanear el disco 2TB cada 3s

/** Copia un archivo al final de un stream de escritura abierto. */
function appendFileToStream(filePath, out) {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(filePath);
    rs.on('error', reject);
    rs.on('end', resolve);
    rs.pipe(out, { end: false });
  });
}

module.exports = function registerImportRoutes(app, ctx) {
  const { db, scheduler, transcoder, auth, uploadsTempDir, ingestDir } = ctx;

  // Defensa en profundidad: asegurar que todas las rutas de importación exijan sesión de admin
  // incluso si el orden de registro de rutas cambiara en server.js
  if (auth) {
    app.use('/api/admin', async (req, res, next) => {
      await auth.ready();
      if (!auth.isAuthorized(req)) {
        return res.status(401).json({ error: 'ACCESO NO AUTORIZADO. INGRESE CLAVE EN /admin' });
      }
      next();
    });
  }

  // Limpieza periódica de bloques huérfanos en uploads_temp (> 6 h sin modificarse)
  const cleanOrphanUploads = async () => {
    try {
      const files = await fs.promises.readdir(uploadsTempDir);
      const now = Date.now();
      for (const f of files) {
        if (!f.includes('_part_')) continue;
        const full = path.join(uploadsTempDir, f);
        try {
          const st = await fs.promises.stat(full);
          if (now - st.mtimeMs > ORPHAN_UPLOAD_TTL_MS) {
            await fs.promises.unlink(full).catch(() => {});
          }
        } catch (e) {}
      }
    } catch (e) {}
  };
  setInterval(cleanOrphanUploads, 30 * 60 * 1000).unref();

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsTempDir),
    filename: (req, file, cb) => {
      const ext = (path.extname(path.basename(file.originalname || '')).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || [''])[0];
      cb(null, `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`);
    }
  });
  const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 * 1024 } });

  const assembling = new Set();

  const queueFromBody = (inputPath, filename, body) => transcoder.queueJob({
    inputPath,
    originalFilename: filename,
    type: ['show', 'commercial', 'bumper'].includes(body.type) ? body.type : 'show',
    showId: body.showId || null,
    title: body.title || path.parse(filename).name,
    season: body.season || 1,
    episode: body.episode || 1
  });

  /* ---------- Subida por bloques (evita el límite de 100 MB de Cloudflare) ---------- */
  app.post('/api/admin/upload-chunk', upload.single('chunk'), async (req, res) => {
    const cleanupTemp = () => { if (req.file) fs.unlink(req.file.path, () => {}); };
    try {
      const { originalFilename, title } = req.body;
      const uploadId = safeId(req.body.uploadId);
      const cIndex = parseInt(req.body.chunkIndex, 10);
      const tChunks = parseInt(req.body.totalChunks, 10);

      if (!req.file || !uploadId || !(cIndex >= 0) || !(tChunks > 0) || tChunks > MAX_CHUNKS || cIndex >= tChunks) {
        cleanupTemp();
        return res.status(400).json({ error: 'Faltan parámetros del bloque o son inválidos.' });
      }

      const partPath = (i) => path.join(uploadsTempDir, `${uploadId}_part_${i}`);
      await fs.promises.rename(req.file.path, partPath(cIndex));

      for (let i = 0; i < tChunks; i++) {
        try {
          await fs.promises.access(partPath(i));
        } catch (e) {
          return res.json({ success: true, chunkIndex: cIndex, completed: false });
        }
      }

      // Evitar que dos peticiones simultáneas ensamblen el mismo archivo
      if (assembling.has(uploadId)) {
        return res.json({ success: true, chunkIndex: cIndex, completed: false });
      }
      assembling.add(uploadId);

      // Todos los bloques recibidos: ensamblar en streaming (sin cargar bloques en memoria)
      const ext = (path.extname(path.basename(originalFilename || '')).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || ['.mp4'])[0];
      const cleanBase = (title || 'video').toLowerCase().replace(/[^a-z0-9_-]/g, '_').substring(0, 30);
      const finalFilename = `${uploadId}_${cleanBase}${ext}`;
      const finalFilePath = path.join(uploadsTempDir, finalFilename);

      const out = fs.createWriteStream(finalFilePath);
      try {
        for (let i = 0; i < tChunks; i++) {
          await appendFileToStream(partPath(i), out);
        }
      } finally {
        out.end();
        await new Promise((resolve) => out.on('close', resolve));
        assembling.delete(uploadId);
      }
      await Promise.all(Array.from({ length: tChunks }, (_, i) => fs.promises.unlink(partPath(i)).catch(() => {})));

      const job = queueFromBody(finalFilePath, path.basename(originalFilename || finalFilename), req.body);
      res.json({
        success: true,
        completed: true,
        message: 'Todos los bloques recibidos y ensamblados. Video enviado a transcodificación.',
        job
      });
    } catch (err) {
      cleanupTemp();
      console.error('[Upload-Chunk] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Subida clásica de un solo archivo (archivos pequeños)
  app.post('/api/admin/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo de video.' });
    }
    const job = queueFromBody(req.file.path, path.basename(req.file.originalname || req.file.filename), req.body);
    res.json({ success: true, message: 'Video recibido y enviado a la cola de transcodificación.', job });
  });

  /* ---------- Grabaciones del servidor ---------- */
  app.get('/api/admin/recordings', async (req, res) => {
    try {
      const dir = scheduler.config.recordingsDir;
      let names = [];
      try { names = await fs.promises.readdir(dir); } catch (e) { return res.json([]); }

      const files = (await Promise.all(names
        .filter(f => (f.endsWith('.mp4') || f.endsWith('.mkv')) && !f.startsWith('.'))
        .map(async (file) => {
          try {
            const stats = await fs.promises.stat(path.join(dir, file));
            return { filename: file, sizeMB: (stats.size / (1024 * 1024)).toFixed(1), mtime: stats.mtime };
          } catch (e) { return null; }
        })))
        .filter(Boolean)
        .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
      res.json(files);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/import-recording', (req, res) => {
    try {
      const { filename } = req.body || {};
      const sourcePath = safeJoin(scheduler.config.recordingsDir, filename);
      if (!sourcePath) return res.status(400).json({ error: 'Nombre de archivo inválido.' });
      if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Archivo no encontrado en grabaciones.' });

      const job = queueFromBody(sourcePath, filename, req.body);
      res.json({ success: true, message: 'Grabación enviada a la cola de procesamiento.', job });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /* ---------- descargas_mkv (disco 2TB) ---------- */
  const scanVideos = async (dir, rel = '') => {
    let results = [];
    let entries = [];
    try { entries = await fs.promises.readdir(path.join(dir, rel), { withFileTypes: true }); } catch (e) { return results; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const itemRel = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        results = results.concat(await scanVideos(dir, itemRel));
      } else if (/\.(mkv|mp4|avi|mov)$/i.test(e.name)) {
        try {
          const stats = await fs.promises.stat(path.join(dir, itemRel));
          results.push({ filename: itemRel, baseFilename: e.name, sizeMB: (stats.size / (1024 * 1024)).toFixed(1), mtime: stats.mtime });
        } catch (err) {}
      }
    }
    return results;
  };

  let folderStatsCache = { at: 0, data: {} };

  app.get('/api/admin/downloads/status', async (req, res) => {
    try {
      const statusDir = path.join(ingestDir, '.status');
      const downloads = [];
      let statusFiles = [];
      try { statusFiles = (await fs.promises.readdir(statusDir)).filter(f => f.endsWith('.json')); } catch (e) {}
      for (const f of statusFiles) {
        try {
          const parsed = JSON.parse(await fs.promises.readFile(path.join(statusDir, f), 'utf-8'));
          const updatedDate = parsed.updatedAt ? new Date(parsed.updatedAt) : null;
          const isFresh = updatedDate && (Date.now() - updatedDate.getTime() < 180000);
          parsed.isLive = !!isFresh && parsed.active !== false;
          downloads.push(parsed);
        } catch (err) {}
      }

      if (Date.now() - folderStatsCache.at > FOLDER_STATS_CACHE_MS) {
        const folderStats = {};
        let entries = [];
        try { entries = await fs.promises.readdir(ingestDir, { withFileTypes: true }); } catch (e) {}
        for (const ent of entries) {
          if (ent.isDirectory() && !ent.name.startsWith('.')) {
            folderStats[ent.name] = (await scanVideos(path.join(ingestDir, ent.name))).length;
          }
        }
        folderStatsCache = { at: Date.now(), data: folderStats };
      }
      const folderStats = folderStatsCache.data;

      const readyShows = {};
      for (const s of db.getShows() || []) {
        const epCount = (s.episodes || []).length;
        if (epCount > 0) {
          readyShows[s.title.toLowerCase()] = epCount;
          readyShows[s.id.toLowerCase()] = epCount;
        }
      }

      const queueStats = {};
      for (const j of db.getTranscodeJobs() || []) {
        if (j.status === 'pending' || j.status === 'processing') {
          const sId = j.showId || 'other';
          queueStats[sId] = (queueStats[sId] || 0) + 1;
        }
      }

      res.json({ success: true, downloads, folders: folderStats, readyShows, queueStats, timestamp: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/downloads/trigger-drive', async (req, res) => {
    try {
      const statusDir = path.join(ingestDir, '.status');
      await fs.promises.mkdir(statusDir, { recursive: true });
      await fs.promises.writeFile(path.join(statusDir, 'trigger_drive.flag'), Date.now().toString());
      res.json({ success: true, message: 'Señal de inicio de Google Drive enviada' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/mkv-downloads', async (req, res) => {
    try {
      const files = (await scanVideos(ingestDir)).sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
      res.json(files);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/import-mkv', (req, res) => {
    try {
      const { filename } = req.body || {};
      const sourcePath = safeJoin(ingestDir, filename);
      if (!sourcePath) return res.status(400).json({ error: 'Nombre de archivo inválido.' });
      if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Archivo no encontrado en descargas_mkv.' });

      const job = queueFromBody(sourcePath, filename, req.body);
      res.json({ success: true, message: 'Archivo MKV enviado a transcodificación.', job });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Importación y codificación masiva (serie completa)
  app.post('/api/admin/batch-import', (req, res) => {
    try {
      let { showId, newShowTitle, newShowCategory, newShowColor, season, items } = req.body || {};

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'No se seleccionaron archivos para importar.' });
      }

      if (showId && showId !== '__new__') {
        if (!db.getShow(showId)) {
          showId = db.createShow({
            id: showId,
            title: newShowTitle ? newShowTitle.trim() : showId,
            category: newShowCategory || 'Anime',
            color: newShowColor || '#00f0ff',
            description: 'Serie completa importada desde almacenamiento local.'
          }).id;
        }
      } else if (newShowTitle) {
        showId = db.createShow({
          title: newShowTitle.trim(),
          category: newShowCategory || 'Anime',
          color: newShowColor || '#00f0ff',
          description: 'Serie completa importada desde almacenamiento local.'
        }).id;
      }

      if (!showId) {
        const shows = db.getShows();
        showId = shows.length > 0 ? shows[0].id : db.createShow({ title: 'Nueva Serie', category: 'Anime' }).id;
      }

      const queuedJobs = [];
      let skipped = 0;
      for (const item of items) {
        const filename = typeof item === 'string' ? item : item && item.filename;
        const filePath = safeJoin(ingestDir, filename);
        if (!filePath || !fs.existsSync(filePath)) {
          skipped++;
          continue;
        }

        queuedJobs.push(transcoder.queueJob({
          inputPath: filePath,
          originalFilename: filename,
          type: 'show',
          showId,
          title: (typeof item === 'object' && item.title) ? item.title : path.parse(filename).name,
          season: (typeof item === 'object' && item.season) ? parseInt(item.season, 10) : (parseInt(season, 10) || 1),
          episode: (typeof item === 'object' && item.episode) ? parseInt(item.episode, 10) : 1
        }));
      }

      res.json({
        success: true,
        message: `¡Se encolaron ${queuedJobs.length} capítulos para codificación automática!${skipped ? ` (${skipped} omitidos)` : ''}`,
        showId,
        queuedCount: queuedJobs.length,
        jobs: queuedJobs
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/enqueue-upload', (req, res) => {
    try {
      const { filename } = req.body || {};
      const sourcePath = safeJoin(uploadsTempDir, filename);
      if (!sourcePath) return res.status(400).json({ error: 'Nombre de archivo inválido.' });
      if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Archivo no encontrado en uploads_temp.' });

      const job = queueFromBody(sourcePath, filename, req.body);
      res.json({ success: true, message: 'Archivo encolado para transcodificación.', job });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /* ---------- Google Drive vía rclone ---------- */
  const gdriveJobs = [];

  const extractDriveFolderId = (input) => {
    if (!input || typeof input !== 'string') return null;
    const clean = input.trim();
    const match = clean.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    return /^[a-zA-Z0-9_-]{10,}$/.test(clean) ? clean : null;
  };

  app.post('/api/admin/gdrive/inspect', (req, res) => {
    const folderId = extractDriveFolderId((req.body || {}).url);
    if (!folderId) return res.status(400).json({ error: 'URL o ID de Google Drive no válido.' });

    execFile('rclone', ['lsjson', 'Drive:', '--drive-root-folder-id', folderId, '-R'], { maxBuffer: 15 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[GDrive Inspect Error]:', stderr || err.message);
        return res.status(500).json({ error: 'Error accediendo a Google Drive: ' + (stderr || err.message) });
      }
      try {
        const files = JSON.parse(stdout)
          .filter(item => !item.IsDir)
          .map(item => ({
            name: item.Name,
            size: item.Size,
            sizeMB: (item.Size / (1024 * 1024)).toFixed(1),
            sizeGB: (item.Size / (1024 * 1024 * 1024)).toFixed(2),
            isDir: false
          }));
        const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
        res.json({ success: true, folderId, fileCount: files.length, totalGB: (totalBytes / (1024 ** 3)).toFixed(2), files });
      } catch (parseErr) {
        res.status(500).json({ error: 'Respuesta inválida de Google Drive: ' + parseErr.message });
      }
    });
  });

  app.post('/api/admin/gdrive/download', (req, res) => {
    try {
      const { url, folderId: providedId, seriesName } = req.body || {};
      const folderId = extractDriveFolderId(providedId) || extractDriveFolderId(url);
      if (!folderId) return res.status(400).json({ error: 'Falta ID de carpeta de Google Drive.' });

      const job = {
        id: `gdrive_${Date.now()}`,
        folderId,
        seriesName: seriesName || 'Serie',
        status: 'downloading',
        progress: 0,
        transferred: '0 MB',
        total: 'Calculando...',
        eta: 'Iniciando...',
        speed: '0 MB/s',
        log: [],
        error: null,
        createdAt: new Date().toISOString()
      };
      gdriveJobs.unshift(job);
      if (gdriveJobs.length > 20) gdriveJobs.pop();

      const proc = spawn('rclone', [
        'copy', 'Drive:', ingestDir,
        '--drive-root-folder-id', folderId,
        '--transfers', '4', '--checkers', '8', '--stats', '2s', '-v'
      ]);

      proc.stderr.on('data', (d) => {
        const text = d.toString();
        job.log.push(text);
        if (job.log.length > 50) job.log.shift();
        const m = text.match(/Transferred:\s+([\d.]+\s+[A-Za-z]+)\s+\/\s+([\d.]+\s+[A-Za-z]+),\s+(\d+)%,\s+([\d.]+\s+[A-Za-z]+\/s),\s+ETA\s+([^\n]+)/);
        if (m) {
          job.transferred = m[1];
          job.total = m[2];
          job.progress = parseInt(m[3], 10);
          job.speed = m[4];
          job.eta = m[5].trim();
        }
      });

      proc.on('error', (err) => {
        job.status = 'failed';
        job.error = err.message;
      });

      proc.on('close', (code) => {
        if (code === 0) {
          job.status = 'completed';
          job.progress = 100;
          job.eta = 'Completado';
        } else {
          job.status = 'failed';
          job.error = job.error || `Rclone finalizó con código ${code}`;
        }
      });

      res.json({ success: true, message: 'Descarga iniciada en segundo plano.', job });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/gdrive/jobs', (req, res) => {
    res.json(gdriveJobs);
  });

  };
