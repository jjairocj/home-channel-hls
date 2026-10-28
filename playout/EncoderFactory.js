/**
 * Home Channel HLS - Perfiles de codificación de la emisión (patrón Factory).
 *
 * Elige el codificador según la plataforma: VideoToolbox (macOS), NVENC (GPU NVIDIA)
 * o libx264 (CPU). Todos fuerzan un keyframe cada 2 s para cortar segmentos HLS exactos.
 */

const { hasNvenc } = require('../lib/ffmpeg');

const KEYFRAMES = ['-force_key_frames', 'expr:gte(t,n_forced*2)'];
const RATE = ['-b:v', '3000k', '-maxrate', '3500k', '-bufsize', '6000k', '-g', '60', '-keyint_min', '60'];

const PROFILES = {
  videotoolbox: () => ({
    name: 'h264_videotoolbox',
    args: ['-c:v', 'h264_videotoolbox', '-b:v', '3500k', '-pix_fmt', 'yuv420p', '-g', '60', ...KEYFRAMES]
  }),
  nvenc: () => ({
    name: 'h264_nvenc (NVIDIA GPU)',
    args: ['-c:v', 'h264_nvenc', '-preset', 'p2', '-tune', 'll', ...RATE, '-forced-idr', '1', ...KEYFRAMES, '-pix_fmt', 'yuv420p']
  }),
  x264: () => ({
    name: 'libx264',
    args: ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', ...RATE, '-sc_threshold', '0', ...KEYFRAMES, '-flags', '+cgop', '-pix_fmt', 'yuv420p']
  })
};

/** Perfil adecuado para esta máquina. */
function createEncoder({ platform = process.platform, nvenc = null } = {}) {
  if (platform === 'darwin') return PROFILES.videotoolbox();
  const useNvenc = nvenc === null ? hasNvenc() : nvenc;
  if (useNvenc) {
    console.log('[Playout] 🚀 Emisión HLS acelerada por HARDWARE: NVIDIA NVENC');
    return PROFILES.nvenc();
  }
  console.log('[Playout] Usando codificador universal optimizado: libx264 (veryfast)');
  return PROFILES.x264();
}

module.exports = { createEncoder, PROFILES };
