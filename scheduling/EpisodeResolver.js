/**
 * Home Channel HLS - Resolución de "qué episodio toca".
 *
 * Una referencia de la grilla apunta a una serie suelta o a un grupo de temporadas
 * (saga). El resolvedor devuelve el episodio n-ésimo a partir del puntero de avance de
 * cada serie, sin modificarlo (el puntero solo avanza cuando el episodio se emite).
 */

class EpisodeResolver {
  /** @param {Function} hasPendingJobs - (showId) => ¿quedan capítulos codificándose? */
  constructor(hasPendingJobs = () => false) {
    this.hasPendingJobs = hasPendingJobs;
  }

  /** Episodio n de una serie suelta; null si emitió todo y espera capítulos nuevos. */
  showEpisode(prog, offset) {
    const len = prog.episodes.length;
    if (!len) return null;
    const ptr = prog.currentEpisodeIndex || 0;
    if (ptr >= len) return null;
    return { prog, episode: prog.episodes[(ptr + offset) % len] };
  }

  /**
   * Episodio n de una saga (temporadas en orden).
   * - Se continúa con la temporada en curso; las anteriores que lleguen tarde van después.
   * - Mientras una temporada tenga capítulos codificándose, la saga no salta a la
   *   siguiente: devuelve null y el bloque usa otra serie.
   * - Si se agotan todas, la saga vuelve a empezar.
   */
  sagaEpisode(saga, offset, flags = {}) {
    const members = saga.members.filter(m => m.episodes.length);
    if (!members.length) return null;

    let active = members.filter(m => !(flags[m.id] && flags[m.id].completed));
    if (!active.length) active = members;
    const inProgress = active.findIndex(m => (m.currentEpisodeIndex || 0) > 0);
    if (inProgress > 0) active = [...active.slice(inProgress), ...active.slice(0, inProgress)];

    let k = offset;
    for (const m of active) {
      const len = m.episodes.length;
      const ptr = Math.min(m.currentEpisodeIndex || 0, len);
      const remaining = len - ptr;
      if (k < remaining) return { prog: m, episode: m.episodes[ptr + k] };
      k -= remaining;
      if (this.hasPendingJobs(m.id)) return null;
    }

    const total = members.reduce((acc, m) => acc + m.episodes.length, 0);
    k %= total;
    for (const m of members) {
      if (k < m.episodes.length) return { prog: m, episode: m.episodes[k] };
      k -= m.episodes.length;
    }
    return null;
  }

  /** Episodio para una referencia { key, saga?, prog? }. */
  resolve(ref, offset, flags) {
    return ref.saga ? this.sagaEpisode(ref.saga, offset, flags) : this.showEpisode(ref.prog, offset);
  }
}

module.exports = EpisodeResolver;
