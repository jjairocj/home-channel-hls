/**
 * Home Channel HLS - Próximos capítulos: qué episodio sale en cada bloque de las próximas
 * horas, para revisarlo (y cambiarlo) desde el Master Control.
 *
 * El bloque al aire sale de la cola real de la emisión; los siguientes, de la
 * proyección del planificador con los punteros actuales de cada serie (así un cambio
 * de capítulo se ve enseguida, aunque entre al aire en el próximo :00/:30).
 */

/** Tipo de emisión de un episodio del bloque. */
function kindOf(ep) {
  if (ep.marathon) return 'marathon';
  if (ep.episodic) return 'random';
  if (ep.isRepeat) return 'repeat';
  if (ep.noAdvance) return 'override';
  return 'premiere';
}

/**
 * @param {Object} opts
 * @param {Object[]} opts.onAir - bloques de la cola de emisión (getOnAirBlocks)
 * @param {Object[]} opts.projected - bloques proyectados (planGuide)
 * @param {Date} [opts.now]
 * @param {number} [opts.hours] - horizonte
 * @param {(id) => Object} opts.getShow - serie de la base (para posición y total)
 * @returns {Object[]} una fila por episodio, en orden de emisión
 */
function upcomingAirings({ onAir = [], projected = [], now = new Date(), hours = 24, getShow }) {
  const t = now.getTime();
  const until = t + hours * 3600 * 1000;
  const current = onAir.filter(b => new Date(b.startTime).getTime() <= t && new Date(b.endTime).getTime() > t);
  const currentEnd = current.length ? Math.max(...current.map(b => new Date(b.endTime).getTime())) : t;
  const later = projected.filter(b => {
    const start = new Date(b.startTime).getTime();
    return start >= currentEnd && start < until;
  });

  const rows = [];
  for (const block of [...current, ...later]) {
    const onAirNow = current.includes(block);
    [block.mainShow, block.secondShow].filter(Boolean).forEach((ep, part) => {
      const show = ep.showId && getShow ? getShow(ep.showId) : null;
      const episodes = (show && show.episodes) || [];
      const index = episodes.findIndex(e => e.id === ep.id);
      rows.push({
        startTime: block.startTime,
        endTime: block.endTime,
        onAir: onAirNow,
        part,
        blockTitle: block.title,
        series: ep.showTitle || (show && show.title) || block.title,
        showId: ep.showId || null,
        showTitle: show ? show.title : null,
        episodeId: ep.id || null,
        episodeTitle: ep.title || ep.name || '',
        season: ep.season || null,
        episode: ep.episode || null,
        index,
        total: episodes.length,
        pointer: show ? (show.currentEpisodeIndex || 0) : null,
        kind: kindOf(ep)
      });
    });
  }
  return rows;
}

module.exports = { upcomingAirings, kindOf };
