/**
 * Home Channel Radio - Estudio del locutor.
 *
 * Para cada canción lista sin locución:
 *   1. guion       DjScriptWriter (Ollama o plantillas)
 *   2. voz         edge-tts con la voz neuronal del DJ de la emisora
 *                  (o la locución grabada a mano en dj_cache/, si existe)
 *   3. mezcla      la canción con la voz "pisando la intro": la música baja sola bajo
 *                  la voz (sidechain) y vuelve a subir cuando el DJ termina
 *
 * El resultado (dj_mixes/<id>.m4a) es una versión alternativa de la canción que la
 * emisora usa de vez en cuando. Trabaja de a una pista, con baja prioridad.
 */

const path = require('path');
const fs = require('fs');
const { run } = require('../lib/ffmpeg');
const { STATIONS } = require('./stations');

/** El DJ entra medio segundo después del primer compás. */
const VOICE_DELAY_MS = 500;
/**
 * La voz se normaliza al nivel de la música y la música baja ~10 dB mientras el DJ
 * habla (sidechain), así la voz queda unos 7-8 dB por encima, como en la radio; al
 * terminar la locución la música vuelve sola a su nivel.
 */
const MIX_FILTER = [
  `[1:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-14:TP=-1.5:LRA=7,adelay=${VOICE_DELAY_MS}|${VOICE_DELAY_MS},apad,asplit=2[sc][voice]`,
  '[0:a][sc]sidechaincompress=threshold=0.01:ratio=20:attack=15:release=700:makeup=1[ducked]',
  '[ducked][voice]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[out]'
].join(';');

class DjStudio {
  /**
   * @param {Object} deps
   * @param {import('./RadioLibrary')} deps.library
   * @param {{ write: Function }} deps.scriptWriter
   * @param {string} [deps.ttsCommand] - intérprete de Python con edge-tts
   */
  constructor({ library, scriptWriter, ttsCommand = process.env.EDGE_TTS_PYTHON || 'python3' }) {
    this.library = library;
    this.scriptWriter = scriptWriter;
    this.ttsCommand = ttsCommand;
    this.ttsAvailable = null;
    this.running = false;
  }

  async checkTts() {
    if (this.ttsAvailable === null) {
      try {
        await run(this.ttsCommand, ['-m', 'edge_tts', '--version'], { timeoutMs: 15000 });
        this.ttsAvailable = true;
      } catch (e) {
        this.ttsAvailable = false;
        console.warn('[Radio/DJ] edge-tts no está instalado: solo se usarán locuciones grabadas en dj_cache/.');
      }
    }
    return this.ttsAvailable;
  }

  /** Emisora cuyo locutor presenta la canción (la de su carpeta; las generales, la primera). */
  stationFor(track) {
    return STATIONS.find(s => s.folder === track.folder) || STATIONS[0];
  }

  async synthesize(script, voice, out) {
    await run(this.ttsCommand, ['-m', 'edge_tts', `--voice=${voice}`, '--rate=+4%', `--text=${script}`, `--write-media=${out}`],
      { timeoutMs: 60000 });
  }

  async mix(track, voicePath) {
    const out = path.join(this.library.dirs.mixes, `${track.id}.m4a`);
    await run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-i', track.ready, '-i', voicePath,
      '-filter_complex', MIX_FILTER, '-map', '[out]',
      '-ac', '2', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', out],
    { timeoutMs: 5 * 60 * 1000, lowPriority: true });
    return out;
  }

  /** Locución completa de una canción. */
  async produce(track) {
    const station = this.stationFor(track);
    let voicePath = track.manualVoice;
    let script = null;
    let source = 'manual';
    if (!voicePath) {
      if (!(await this.checkTts())) return false;
      script = await this.scriptWriter.write(track, station);
      voicePath = path.join(this.library.dirs.voices, `${track.id}.mp3`);
      await this.synthesize(script, station.voice, voicePath);
      source = 'tts';
    }
    const mix = await this.mix(track, voicePath);
    this.library.setDj(track, { mix, voice: voicePath, script, source, dj: station.dj, createdAt: new Date().toISOString() });
    console.log(`[Radio/DJ] 🎙️ ${station.dj} presenta "${track.title}" (${track.artist})${script ? `: ${script}` : ' (locución grabada)'}`);
    return true;
  }

  /** Procesa en segundo plano las canciones listas que aún no tienen locución. */
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      for (const track of this.library.tracks) {
        if (!track.ready || track.dj) continue;
        try {
          await this.produce(track);
        } catch (e) {
          console.warn(`[Radio/DJ] No se pudo preparar la locución de "${track.title}":`, e.message.split('\n')[0]);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Vuelve a generar la locución de una canción (desde el panel). */
  async regenerate(trackId) {
    const track = this.library.findTrack(trackId);
    if (!track || !track.ready) throw new Error('Canción no encontrada o aún sin procesar');
    if (track.dj && track.dj.voice && track.dj.source === 'tts') await fs.promises.unlink(track.dj.voice).catch(() => {});
    track.dj = null;
    return this.produce(track);
  }
}

module.exports = DjStudio;
