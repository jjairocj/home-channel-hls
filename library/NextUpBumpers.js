/**
 * Home Channel HLS - Dynamic Bumper Generator (Panel lateral dividido estilo cable 1999)
 * Genera clips MP4 en 1080p con gráficas quemadas directamente en el video para que
 * Smart TVs, enlaces M3U e IPTV muestren la información automáticamente en pantalla:
 *   - "A Continuación": el siguiente programa (reemplaza el bumper genérico de salida).
 *   - "Cartelera de hoy": lo que sigue y los próximos programas (en el relleno
 *     sincronizador, como la cartelera que la web dibuja sobre el televisor).
 *   - Cuadro "lo que sigue" durante el capítulo: PNG con transparencia que la emisión
 *     superpone a la mitad y al final del episodio (ver playout/LowerThirds.js).
 *
 * El render se hace SIEMPRE en segundo plano con spawn (antes usaba execSync y
 * congelaba el servidor HLS hasta 20 s). Mientras un clip no existe, el scheduler
 * mantiene el bumper "A continuación" genérico.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { hasNvenc } = require('../lib/ffmpeg');
const { renderNextUpSvg } = require('./nextUpTemplate');
const { renderBillboardSvg } = require('./billboardTemplate');
const { renderLowerThirdSvg, LOWER_THIRD_SIZE } = require('./lowerThirdTemplate');
const { synthesizeVoice, buildBillboardScript, buildNextUpScript } = require('./audio8Client');

const CLIP_SECONDS = 12;
/** La cartelera se renderiza con este largo y se recorta al hueco de cada bloque. */
const BILLBOARD_SECONDS = 20;
const MAX_CLIP_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function findDir(rel) {
  const root = path.resolve(__dirname, '..');
  const p1 = path.resolve(root, rel);
  const p2 = path.resolve(root, '..', rel);
  if (fs.existsSync(path.resolve(p2, 'artwork')) || fs.existsSync(path.resolve(p2, 'bumper_02_a_continuacion.mp4'))) return p2;
  if (fs.existsSync(p1)) return p1;
  return p2;
}

class DynamicBumperManager {
  constructor(config = {}) {
    this.mediaDir = config.mediaDir || findDir('media');
    this.bumpersDir = config.bumpersDir || findDir('media/bumpers');
    this.artworkDir = path.resolve(this.bumpersDir, 'artwork');
    this.dynamicDir = path.resolve(this.bumpersDir, 'dynamic');
    this.tempAudioDir = path.resolve(this.bumpersDir, 'temp_audio');

    if (!fs.existsSync(this.dynamicDir)) {
      try { fs.mkdirSync(this.dynamicDir, { recursive: true }); } catch (e) {}
    }
    if (!fs.existsSync(this.tempAudioDir)) {
      try { fs.mkdirSync(this.tempAudioDir, { recursive: true }); } catch (e) {}
    }

    this.baseArtPath = path.resolve(this.artworkDir, 'crhe_x99_a_continuacion_1792013246219.jpg');
    this.baseAudioSource = path.resolve(this.bumpersDir, 'bumper_02_a_continuacion.mp4');

    this.syncAudioSource = this.findBumper('sincronizador');
    // Aviso cuando termina una tanda de renders con clips nuevos (para que la emisión
    // los use: la cola de 24 h se arma con los clips que existían al planificar)
    this.onBatchReady = typeof config.onBatchReady === 'function' ? config.onBatchReady : null;
    this.renderedInBatch = 0;
    this.cache = new Map();
    this.readyClips = new Set();
    this.readyImages = new Set();
    this.lastTouched = new Map();
    this.generationQueue = [];
    this.queueSet = new Set();
    this.isProcessingQueue = false;

    this.enableVoice = config.enableVoice !== undefined
      ? config.enableVoice
      : (process.env.NODE_ENV !== 'test' && process.env.AUDIO8_TTS_ENABLED !== 'false');
    this.voiceName = config.voiceName
      || process.env.ELEVENLABS_VOICE_NAME
      || process.env.AUDIO8_VOICE
      || 'El Faraón';
  }

  generateSvg(data) {
    return renderNextUpSvg(data);
  }

  /** Primer bumper cuyo nombre de archivo contiene `keyword` (para tomar su audio). */
  findBumper(keyword) {
    try {
      const file = fs.readdirSync(this.bumpersDir).find(f => f.toLowerCase().includes(keyword) && f.endsWith('.mp4'));
      return file ? path.resolve(this.bumpersDir, file) : null;
    } catch (e) {
      return null;
    }
  }

  slugify(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 32);
  }

  /**
   * Clave del clip: serie + hora + episodio. Incluir el episodio evita mostrar
   * "Próximo en pantalla" con un capítulo viejo.
   */
  clipKey({ showTitle, episodeTitle, startTime, duration }) {
    const epHash = crypto.createHash('md5').update(String(episodeTitle || '')).digest('hex').slice(0, 8);
    const dur = Math.round(this.clipSeconds(duration) * 10);
    return `${this.slugify(showTitle || 'serie')}_${this.slugify(startTime || '1900')}_${epHash}_${dur}`;
  }

  /** Duración del clip: la misma del bumper genérico al que reemplaza (cuadra el bloque). */
  clipSeconds(duration) {
    const d = parseFloat(duration);
    return d > 1 && d < 60 ? d : CLIP_SECONDS;
  }

  clipPath(key) {
    return path.resolve(this.dynamicDir, `bumper_next_${key}.mp4`);
  }

  clipItem(key, showTitle, outputPath, duration) {
    return {
      id: `dyn_${key}`,
      name: `Home Channel HLS // A Continuación: ${showTitle}`,
      showTitle: 'A Continuación',
      path: outputPath,
      duration: this.clipSeconds(duration),
      targetDuration: this.clipSeconds(duration),
      role: 'outro_bumper',
      type: 'bumper'
    };
  }

  isClipReady(outputPath) {
    if (this.readyClips.has(outputPath)) return true;
    try {
      if (fs.statSync(outputPath).size > 200000) {
        this.readyClips.add(outputPath);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /** Actualiza mtime de forma asíncrona y espaciada (máx. una vez por hora) sin bloquear el event loop. */
  touchFileAsync(filePath) {
    const nowMs = Date.now();
    const prev = this.lastTouched.get(filePath) || 0;
    if (nowMs - prev < 3600000) return;
    this.lastTouched.set(filePath, nowMs);
    const d = new Date(nowMs);
    fs.promises.utimes(filePath, d, d).catch(() => {});
  }

  /** Arte de fondo de las cortinillas (con alternativa si falta el principal). */
  backgroundArt() {
    if (fs.existsSync(this.baseArtPath)) return this.baseArtPath;
    const alt = path.resolve(this.artworkDir, 'bumper_a_continuacion_1792009041392.jpg');
    return fs.existsSync(alt) ? alt : this.baseArtPath;
  }

  /**
   * Renderiza un clip MP4: arte de fondo + gráfica SVG encima + audio de un bumper (o
   * silencio). Corre en un proceso hijo (no bloquea el event loop).
   * @returns {Promise<boolean>} true si el clip quedó listo en outputPath
   */
  renderClip({ key, svg, seconds, audioSource, voiceWav = null, outputPath, label }) {
    const secs = Number(seconds).toFixed(3);
    const tmpOutput = path.resolve(this.dynamicDir, `bumper_next_${key}.tmp.mp4`);
    const tempSvgPath = path.resolve(this.dynamicDir, `temp_${key}.svg`);
    let tempPngPath = null;
    let overlayInputPath = tempSvgPath;

    try {
      const { Resvg } = require('@resvg/resvg-js');
      const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1920 } });
      const pngBuffer = resvg.render().asPng();
      tempPngPath = path.resolve(this.dynamicDir, `temp_${key}.png`);
      fs.writeFileSync(tempPngPath, pngBuffer);
      overlayInputPath = tempPngPath;
    } catch (e) {
      fs.writeFileSync(tempSvgPath, svg, 'utf8');
      overlayInputPath = tempSvgPath;
    }

    const videoArgs = hasNvenc()
      ? ['-c:v', 'h264_nvenc', '-preset', 'fast', '-b:v', '3000k']
      : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20'];

    const hasAudioSource = !!audioSource && fs.existsSync(audioSource);
    const hasVoice = !!voiceWav && fs.existsSync(voiceWav);

    const audioInput = hasAudioSource
      ? ['-ss', '0', '-t', secs, '-i', audioSource]
      : ['-f', 'lavfi', '-t', secs, '-i', 'anullsrc=r=48000:cl=stereo'];

    if (hasVoice) {
      audioInput.push('-i', voiceWav);
    }

    let filterComplex = '[0:v]scale=1920:1080[bg];[1:v]scale=1920:1080[ov];[bg][ov]overlay=0:0,format=yuv420p[v]';
    let audioOut = [];
    let mapAudio = ['-map', '2:a'];

    if (hasVoice) {
      const fadeOutSec = Math.max(1, parseFloat(secs) - 1.2).toFixed(1);
      filterComplex += `;[2:a]volume=0.28,afade=t=in:ss=0:d=0.3,afade=t=out:st=${fadeOutSec}:d=1.0[bgm];[3:a]adelay=300|300,volume=1.45,afade=t=in:ss=0:d=0.1[vox];[bgm][vox]amix=inputs=2:duration=first:dropout_transition=2,aformat=sample_rates=48000:channel_layouts=stereo[a]`;
      mapAudio = ['-map', '[a]'];
      audioOut = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];
    } else {
      filterComplex += ';[2:a]aformat=sample_rates=48000:channel_layouts=stereo[a]';
      mapAudio = ['-map', '[a]'];
      audioOut = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];
    }

    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-loop', '1', '-framerate', '30', '-t', secs, '-i', this.backgroundArt(),
      '-loop', '1', '-framerate', '30', '-t', secs, '-i', overlayInputPath,
      ...audioInput,
      '-filter_complex', filterComplex,
      '-map', '[v]',
      ...mapAudio,
      ...videoArgs,
      ...audioOut,
      '-shortest',
      '-f', 'mp4',
      tmpOutput
    ];

    console.log(`[DynamicBumpers] 🎬 Generando ${label}${hasVoice ? ` (con voz ${this.voiceName})` : ''}...`);

    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', d => { if (stderr.length < 4000) stderr += d.toString(); });

      const timer = setTimeout(() => proc.kill('SIGKILL'), 35000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        try { fs.unlinkSync(tempSvgPath); } catch (e) {}
        try { if (tempPngPath) fs.unlinkSync(tempPngPath); } catch (e) {}
        if (code === 0 && this.isClipReady(tmpOutput)) {
          try {
            fs.renameSync(tmpOutput, outputPath);
            console.log(`[DynamicBumpers] ✅ Lista: ${path.basename(outputPath)}`);
            return resolve(true);
          } catch (e) {}
        }
        try { fs.unlinkSync(tmpOutput); } catch (e) {}
        console.error(`[DynamicBumpers] ⚠️ Fallo renderizando ${label} (código ${code}): ${stderr.trim().slice(0, 300)}`);
        resolve(false);
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        try { fs.unlinkSync(tempSvgPath); } catch (e) {}
        try { if (tempPngPath) fs.unlinkSync(tempPngPath); } catch (e) {}
        console.error('[DynamicBumpers] ⚠️ No se pudo lanzar FFmpeg:', err.message);
        resolve(false);
      });
    });
  }

  /** Convierte un SVG en PNG con transparencia (FFmpeg + librsvg, en un proceso hijo). */
  renderPng({ key, svg, outputPath, lavfi = null }) {
    if (!lavfi && svg) {
      try {
        const { Resvg } = require('@resvg/resvg-js');
        const resvg = new Resvg(svg);
        const pngBuffer = resvg.render().asPng();
        fs.writeFileSync(outputPath, pngBuffer);
        return Promise.resolve(true);
      } catch (e) {}
    }
    const tmpOutput = `${outputPath}.tmp.png`;
    const tempSvgPath = path.resolve(this.dynamicDir, `temp_${key}.svg`);
    const input = lavfi ? ['-f', 'lavfi', '-i', lavfi] : ['-i', tempSvgPath];
    if (!lavfi) fs.writeFileSync(tempSvgPath, svg, 'utf8');
    const args = ['-hide_banner', '-loglevel', 'error', '-y', ...input, '-frames:v', '1', '-vf', 'format=rgba', '-f', 'image2', '-c:v', 'png', tmpOutput];
    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', d => { if (stderr.length < 2000) stderr += d.toString(); });
      const timer = setTimeout(() => proc.kill('SIGKILL'), 20000);
      const done = (ok) => {
        clearTimeout(timer);
        if (!lavfi) { try { fs.unlinkSync(tempSvgPath); } catch (e) {} }
        if (ok) {
          try { fs.renameSync(tmpOutput, outputPath); return resolve(true); } catch (e) {}
        }
        try { fs.unlinkSync(tmpOutput); } catch (e) {}
        console.error(`[DynamicBumpers] ⚠️ Fallo renderizando ${path.basename(outputPath)}: ${stderr.trim().slice(0, 300)}`);
        resolve(false);
      };
      proc.on('close', (code) => done(code === 0 && this.isImageReady(tmpOutput)));
      proc.on('error', () => done(false));
    });
  }

  isImageReady(file) {
    if (this.readyImages.has(file)) return true;
    try {
      if (fs.statSync(file).size > 300) {
        this.readyImages.add(file);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /* ---------- Cuadro "lo que sigue" durante el capítulo ---------- */

  /** PNG transparente del tamaño del cuadro (los momentos sin cuadro). */
  lowerThirdBlank() {
    const outputPath = path.resolve(this.dynamicDir, 'lower_third_blank.png');
    if (this.isImageReady(outputPath)) return outputPath;
    const { width, height } = LOWER_THIRD_SIZE;
    this.enqueue({
      key: 'lower_third_blank',
      outputPath,
      ready: (f) => this.isImageReady(f),
      run: () => this.renderPng({ key: 'lower_third_blank', outputPath, lavfi: `color=c=black@0.0:s=${width}x${height},format=rgba` })
    });
    return null;
  }

  /**
   * El cuadro y su versión semitransparente (fundido) si ya existen; si no, encola el
   * render y devuelve null (ese momento queda sin cuadro hasta la próxima resincronización).
   */
  getOrCreateLowerThird(card) {
    const hash = crypto.createHash('md5').update(JSON.stringify(card)).digest('hex').slice(0, 12);
    const key = `lt_${hash}`;
    const png = path.resolve(this.dynamicDir, `bumper_next_${key}.png`);
    const half = path.resolve(this.dynamicDir, `bumper_next_${key}_half.png`);
    if (this.isImageReady(png) && this.isImageReady(half)) {
      this.touchFileAsync(png);
      this.touchFileAsync(half);
      return { png, half };
    }
    this.enqueue({
      key,
      outputPath: half,
      ready: (f) => this.isImageReady(f) && this.isImageReady(png),
      run: async () => {
        await this.renderPng({ key, svg: renderLowerThirdSvg(card, 1), outputPath: png });
        await this.renderPng({ key: `${key}_half`, svg: renderLowerThirdSvg(card, 0.5), outputPath: half });
      }
    });
    return null;
  }

  /** Cortinilla "A continuación" del siguiente programa. */
  async renderBumper({ showTitle, episodeTitle, startTime, duration, channelBrand = 'Home Channel' }) {
    const key = this.clipKey({ showTitle, episodeTitle, startTime, duration });
    const outputPath = this.clipPath(key);
    let voiceWav = null;

    if (this.enableVoice) {
      const voicePath = path.resolve(this.tempAudioDir, `vox_${key}.wav`);
      const script = buildNextUpScript({ showTitle, startTime, channelBrand: 'Home Channel' });
      const ok = await synthesizeVoice({ text: script, voiceName: this.voiceName, outputPath: voicePath });
      if (ok) voiceWav = voicePath;
    }

    const ok = await this.renderClip({
      key,
      svg: this.generateSvg({ showTitle, episodeTitle, startTime, channelBrand }),
      seconds: this.clipSeconds(duration),
      audioSource: this.baseAudioSource,
      voiceWav,
      outputPath,
      label: `cortinilla: ${showTitle} (${startTime} HS)`
    });

    if (voiceWav) {
      try { fs.unlinkSync(voiceWav); } catch (e) {}
    }

    return ok ? this.clipItem(key, showTitle, outputPath, duration) : null;
  }

  /**
   * Procesa la cola en segundo plano, un clip a la vez.
   */
  async processQueue() {
    if (this.isProcessingQueue || this.generationQueue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.generationQueue.length > 0) {
      const job = this.generationQueue.shift();
      this.queueSet.delete(job.key);

      const isReady = job.ready || ((f) => this.isClipReady(f));
      if (!isReady(job.outputPath)) {
        try {
          await job.run();
          if (isReady(job.outputPath)) this.renderedInBatch++;
        } catch (e) {
          console.warn('[DynamicBumpers] Error procesando item en cola:', e.message);
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }

    this.isProcessingQueue = false;
    this.cleanupOldClips();
    if (this.renderedInBatch > 0 && this.onBatchReady) {
      const count = this.renderedInBatch;
      this.renderedInBatch = 0;
      try { this.onBatchReady(count); } catch (e) { console.warn('[DynamicBumpers] Aviso de clips listos falló:', e.message); }
    }
  }

  /** Borra clips de más de 3 días para no llenar el disco (hay uno por bloque y episodio). */
  cleanupOldClips() {
    fs.readdir(this.dynamicDir, (err, files) => {
      if (err) return;
      const now = Date.now();
      for (const f of files) {
        if (!f.startsWith('bumper_next_') && !f.startsWith('temp_')) continue;
        const full = path.join(this.dynamicDir, f);
        fs.stat(full, (e, st) => {
          if (!e && now - st.mtimeMs > MAX_CLIP_AGE_MS) {
            this.readyClips.delete(full);
            this.readyImages.delete(full);
            this.lastTouched.delete(full);
            fs.unlink(full, () => {});
          }
        });
      }
    });
  }

  /** Encola un render (una sola vez por clave) y arranca la cola en segundo plano. */
  enqueue(job) {
    const isReady = job.ready || ((f) => this.isClipReady(f));
    if (isReady(job.outputPath) || this.queueSet.has(job.key)) return;
    this.queueSet.add(job.key);
    this.generationQueue.push(job);
    this.processQueue();
  }

  enqueueBumper(options) {
    const key = this.clipKey(options);
    this.enqueue({ key, outputPath: this.clipPath(key), run: () => this.renderBumper(options) });
  }

  /* ---------- Cartelera de hoy ---------- */

  /** Clave de la cartelera: depende solo de lo que muestra (horas y títulos). */
  billboardKey(entries, dateLabel) {
    const text = JSON.stringify([dateLabel, entries.map(e => [e.time, e.title, !!e.offAir])]);
    return `board_${crypto.createHash('md5').update(text).digest('hex').slice(0, 12)}`;
  }

  /**
   * Clip "Cartelera de hoy" (BILLBOARD_SECONDS) si ya está renderizado; si no, lo encola
   * y devuelve null (el relleno sigue con sus bumpers de siempre).
   * @param {Array<{ time, title, offAir }>} entries - lo que sigue primero
   */
  getOrCreateBillboard(entries, { dateLabel = '', channelBrand = 'Home Channel' } = {}) {
    if (!entries || !entries.length) return null;
    const key = this.billboardKey(entries, dateLabel);
    const outputPath = this.clipPath(key);
    if (this.isClipReady(outputPath)) {
      this.touchFileAsync(outputPath);
      return {
        id: `dyn_${key}`,
        name: 'Home Channel HLS // Cartelera de hoy',
        showTitle: 'Cartelera de hoy',
        path: outputPath,
        duration: BILLBOARD_SECONDS,
        type: 'bumper'
      };
    }
    this.enqueue({
      key,
      outputPath,
      run: async () => {
        let voiceWav = null;
        if (this.enableVoice) {
          const voicePath = path.resolve(this.tempAudioDir, `vox_${key}.wav`);
          const script = buildBillboardScript(entries, 'Home Channel');
          if (script) {
            const ok = await synthesizeVoice({ text: script, voiceName: this.voiceName, outputPath: voicePath });
            if (ok) voiceWav = voicePath;
          }
        }

        const ok = await this.renderClip({
          key,
          svg: renderBillboardSvg({ entries, dateLabel, channelBrand }),
          seconds: BILLBOARD_SECONDS,
          audioSource: this.syncAudioSource || this.baseAudioSource,
          voiceWav,
          outputPath,
          label: `cartelera (${entries[0].time} ${entries[0].title})`
        });

        if (voiceWav) {
          try { fs.unlinkSync(voiceWav); } catch (e) {}
        }
        return ok;
      }
    });
    return null;
  }

  /**
   * Devuelve el clip "A continuación" si ya está renderizado. Si no existe, lo encola
   * en segundo plano y devuelve null: el scheduler mantiene el bumper genérico (con su
   * duración real, así la cuenta del bloque de 30 min no se desfasa).
   */
  getOrCreateNextBumper({ showTitle, episodeTitle, startTime = '19:00', duration, channelBrand = 'Home Channel' }) {
    const key = this.clipKey({ showTitle, episodeTitle, startTime, duration });
    const outputPath = this.clipPath(key);
    if (this.isClipReady(outputPath)) {
      this.touchFileAsync(outputPath);
      return this.clipItem(key, showTitle, outputPath, duration);
    }
    this.enqueueBumper({ showTitle, episodeTitle, startTime, duration, channelBrand });
    return null;
  }
}

module.exports = DynamicBumperManager;
module.exports.BILLBOARD_SECONDS = BILLBOARD_SECONDS;
