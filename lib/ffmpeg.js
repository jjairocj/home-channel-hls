/**
 * Home Channel HLS - Utilidades FFmpeg compartidas
 * Detección de NVENC (una sola vez por proceso) y ffprobe asíncrono para no
 * bloquear el event loop que sirve los segmentos HLS.
 */

const { execFile, execFileSync } = require('child_process');

let nvencAvailable = null;

/**
 * Comprueba UNA vez si h264_nvenc funciona en esta máquina.
 * Es síncrono a propósito: se llama durante el arranque, antes de servir tráfico.
 */
function hasNvenc() {
  if (nvencAvailable !== null) return nvencAvailable;
  if (process.platform === 'darwin') {
    nvencAvailable = false;
    return nvencAvailable;
  }
  try {
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=256x256:rate=30',
      '-c:v', 'h264_nvenc', '-f', 'null', '-'
    ], { timeout: 5000, stdio: 'ignore' });
    nvencAvailable = true;
  } catch (e) {
    nvencAvailable = false;
  }
  return nvencAvailable;
}

function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

/**
 * Duración en segundos (float) o 0 si no se puede leer.
 * @param {boolean} [lowPriority] - ejecutar con `nice` (auditorías masivas)
 */
async function probeDuration(filePath, timeoutMs = 8000, lowPriority = false) {
  try {
    const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath];
    const out = lowPriority && process.platform !== 'win32'
      ? await execFileAsync('nice', ['-n', '19', 'ffprobe', ...args], { timeout: timeoutMs })
      : await execFileAsync('ffprobe', args, { timeout: timeoutMs });
    const sec = parseFloat(String(out).trim());
    return isNaN(sec) || sec <= 0 ? 0 : sec;
  } catch (e) {
    return 0;
  }
}

/** Pistas de audio con idioma y título (para elegir español latino). */
async function probeAudioStreams(filePath, timeoutMs = 8000) {
  try {
    const out = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=index:stream_tags=language,title',
      '-of', 'json',
      filePath
    ], { timeout: timeoutMs });
    const data = JSON.parse(out);
    return Array.isArray(data.streams) ? data.streams : [];
  } catch (e) {
    return [];
  }
}

/** Ejecuta ffprobe/ffmpeg con `nice` si se pide (trabajo en segundo plano). */
function run(cmd, args, { timeoutMs, lowPriority = false } = {}) {
  return lowPriority && process.platform !== 'win32'
    ? execFileAsync('nice', ['-n', '19', cmd, ...args], { timeout: timeoutMs })
    : execFileAsync(cmd, args, { timeout: timeoutMs });
}

/**
 * Metadatos ID3 (artista, título, álbum, año) y duración de un archivo de audio.
 * Asíncrono: el mismo proceso sirve la emisión. Devuelve null si no se puede leer.
 */
async function probeAudioTags(filePath, timeoutMs = 8000, lowPriority = true) {
  try {
    const out = await run('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format_tags=artist,title,album,date:format=duration',
      '-of', 'json',
      filePath
    ], { timeoutMs, lowPriority });
    const data = JSON.parse(out);
    const tags = (data && data.format && data.format.tags) || {};
    const pick = (...keys) => keys.map(k => tags[k]).find(Boolean) || null;
    const duration = parseFloat(data && data.format && data.format.duration) || 0;
    return {
      artist: pick('artist', 'ARTIST', 'Artist'),
      title: pick('title', 'TITLE', 'Title'),
      album: pick('album', 'ALBUM', 'Album'),
      year: pick('date', 'DATE', 'year'),
      duration: duration > 0 ? duration : 0
    };
  } catch (e) {
    return null;
  }
}

module.exports = { hasNvenc, execFileAsync, run, probeDuration, probeAudioStreams, probeAudioTags };
