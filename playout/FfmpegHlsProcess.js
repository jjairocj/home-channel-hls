/**
 * Home Channel HLS - Proceso FFmpeg de la emisión HLS.
 *
 * Lee una lista ffconcat en tiempo real (-re), quema la marca de agua, el cuadro
 * "lo que sigue" (pista de imágenes de playout/LowerThirds.js) y la marquesina de la
 * tanda (filtros de playout/Ticker.js), normaliza
 * imagen (1080p, 30 fps) y audio (48 kHz estéreo) y escribe segmentos HLS de 4 s con
 * numeración única (epoch). Emite:
 *   'progress' (outTimeSec)  posición real de salida, según -progress de FFmpeg
 *   'exit'     (code)        el proceso terminó
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');

const VIDEO_FILTER = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,eq=contrast=1.03:saturation=1.10';
// async=1: rellena con silencio los huecos de audio entre archivos (o recorta), sin
// estirar; mantiene el audio de cada archivo sincronizado con su video.
const AUDIO_FILTER = '[0:a]aformat=sample_rates=48000:channel_layouts=stereo,aresample=48000:async=1[aout]';

/** Cuadro "lo que sigue": esquina inferior izquierda, dentro del área segura del TV. */
const LOWER_THIRD_POSITION = 'x=80:y=H-h-100';

const HLS_ARGS = [
  '-f', 'hls',
  '-hls_time', '4',
  '-hls_list_size', '12',
  '-hls_delete_threshold', '4',
  '-hls_start_number_source', 'epoch',
  '-hls_flags', 'delete_segments+independent_segments+discont_start'
];

class FfmpegHlsProcess extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string} opts.streamDir
   * @param {string} opts.playlistFile - lista ffconcat
   * @param {{name, args}} opts.encoder
   * @param {string|null} opts.watermarkFile
   * @param {string|null} [opts.lowerThirdTrack] - pista ffconcat de imágenes con transparencia
   * @param {string|null} [opts.tickerFilter] - filtros de la marquesina de la tanda
   */
  constructor({ streamDir, playlistFile, encoder, watermarkFile, lowerThirdTrack = null, tickerFilter = null }) {
    super();
    this.streamDir = streamDir;
    this.playlistFile = playlistFile;
    this.encoder = encoder;
    this.watermarkFile = watermarkFile && fs.existsSync(watermarkFile) ? watermarkFile : null;
    this.lowerThirdTrack = lowerThirdTrack && fs.existsSync(lowerThirdTrack) ? lowerThirdTrack : null;
    this.tickerFilter = tickerFilter || null;
    this.proc = null;
  }

  get hlsPlaylist() {
    return path.join(this.streamDir, 'channel.m3u8');
  }

  buildArgs(seekOffset = 0) {
    const input = [...(seekOffset > 0 ? ['-ss', seekOffset.toFixed(2)] : []), '-re', '-f', 'concat', '-safe', '0', '-i', this.playlistFile];
    const chain = [`[0:v]${VIDEO_FILTER}[base]`];
    let last = '[base]';
    let next = 1;
    if (this.watermarkFile) {
      input.push('-loop', '1', '-i', this.watermarkFile);
      chain.push(`${last}[${next}:v]overlay=W-w-50:50:shortest=1:format=auto[wm]`);
      last = '[wm]';
      next++;
    }
    if (this.lowerThirdTrack) {
      // La pista arranca en 0 junto con la emisión (sus tiempos ya descuentan el seek)
      input.push('-f', 'concat', '-safe', '0', '-i', this.lowerThirdTrack);
      chain.push(`${last}[${next}:v]overlay=${LOWER_THIRD_POSITION}:eof_action=pass:format=auto[lt]`);
      last = '[lt]';
      next++;
    }
    if (this.tickerFilter) {
      chain.push(`${last}${this.tickerFilter}[tk]`);
      last = '[tk]';
    }
    chain.push(`${last}format=yuv420p[vout]`);
    const filter = `${chain.join(';')};${AUDIO_FILTER}`;
    return [
      '-hide_banner', '-loglevel', 'warning',
      '-progress', 'pipe:1', '-stats_period', '1',
      ...input,
      '-filter_complex', filter,
      '-map', '[vout]', '-map', '[aout]',
      ...this.encoder.args,
      '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000',
      ...HLS_ARGS,
      '-hls_segment_filename', path.join(this.streamDir, 'seg_%d.ts'),
      this.hlsPlaylist
    ];
  }

  start(seekOffset = 0) {
    fs.mkdirSync(this.streamDir, { recursive: true });
    const proc = spawn('ffmpeg', this.buildArgs(seekOffset), { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;

    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      // Un proceso ya reemplazado (kill) aún puede vaciar su último reporte: se ignora,
      // si no la posición del nuevo saltaría a la del viejo (~1800 s tras un bloque)
      if (this.proc !== proc) return;
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        // out_time_ms también viene en microsegundos
        if (line.startsWith('out_time_us=') || line.startsWith('out_time_ms=')) {
          const us = parseInt(line.split('=')[1], 10);
          if (!isNaN(us) && us >= 0) this.emit('progress', us / 1e6);
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('fatal')) console.error(`[Playout FFmpeg Error]: ${msg.trim().slice(0, 500)}`);
    });

    proc.on('close', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.emit('exit', code);
    });
    return this;
  }

  get running() {
    return !!this.proc;
  }

  /** Detiene el proceso sin emitir 'exit' (cierre intencional). */
  kill() {
    if (!this.proc) return;
    const proc = this.proc;
    this.proc = null;
    try {
      proc.removeAllListeners('close');
      proc.kill('SIGKILL');
    } catch (e) {}
  }
}

module.exports = FfmpegHlsProcess;
