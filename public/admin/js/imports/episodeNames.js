/**
 * Home Channel Master Control - Deducir temporada, capítulo y título desde el nombre de
 * un archivo (funciones puras).
 */

export const titleFromFilename = (name) => name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');

const EPISODE_TAG = /(?:audio|ep|cap|sesi[oó]n|_)[_\s-]*0*(\d+)/i;

/** "…_05.mkv", "Cap 05", "Audio 05" → 5 (o null). */
export function episodeFromFilename(name) {
  const m = name.match(EPISODE_TAG);
  return m ? parseInt(m[1], 10) : null;
}

/** Detecta { season, episode, title } de "Serie/01 - Nombre.mkv", "S01E05", "Cap 05"… */
export function parseEpisodeInfo(filename) {
  const parts = filename.split('/');
  const base = parts.pop();
  const folder = parts.join('/');

  const clean = base
    .replace(/\.[^/.]+$/, '')
    .replace(/^Copia de\s+/i, '')
    .replace(/-\s*bix-.*$/i, '') // etiquetas de ripeo
    .replace(/\[[^\]]+\]/g, ''); // [tags]

  let season = 1;
  if (/(?:adventure|temporada|season|s)\s*0*2\b/i.test(folder)) season = 2;

  let episode = null;
  let title = clean;

  const leading = clean.match(/^0*(\d{1,3})[\s_.-]+(.+)$/); // "01 Nombre" / "01 - Nombre"
  if (leading) {
    episode = parseInt(leading[1], 10);
    title = leading[2].trim();
  }
  if (!episode) {
    const se = clean.match(/S(\d+)E(\d+)/i);
    if (se) {
      season = parseInt(se[1], 10);
      episode = parseInt(se[2], 10);
    } else {
      const e = clean.match(/\bE(\d+)\b/i);
      if (e) episode = parseInt(e[1], 10);
    }
  }
  if (!episode) episode = episodeFromFilename(clean);

  title = title.replace(/_/g, ' ').trim();
  return { episode: episode || 1, title: title || clean, season };
}
