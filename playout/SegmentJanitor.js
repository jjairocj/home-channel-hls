/**
 * Home Channel HLS - Limpieza de segmentos HLS de procesos anteriores.
 * FFmpeg borra sus propios segmentos viejos; los de procesos ya terminados (reinicios)
 * los borra este conserje cuando superan la edad máxima.
 */

const fs = require('fs');
const path = require('path');

const MAX_AGE_MS = 5 * 60 * 1000;
const INTERVAL_MS = 60 * 1000;

function startSegmentJanitor(streamDir, { maxAgeMs = MAX_AGE_MS } = {}) {
  const clean = () => {
    fs.readdir(streamDir, (err, files) => {
      if (err) return;
      const now = Date.now();
      for (const f of files) {
        if (!f.endsWith('.ts')) continue;
        const full = path.join(streamDir, f);
        fs.stat(full, (e, st) => {
          if (!e && now - st.mtimeMs > maxAgeMs) fs.unlink(full, () => {});
        });
      }
    });
  };
  const timer = setInterval(clean, INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { startSegmentJanitor };
