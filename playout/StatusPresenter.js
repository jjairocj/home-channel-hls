/**
 * Home Channel HLS - Estado de emisión para el P100, el admin y las apps.
 *
 * Arma el JSON de /api/status a partir del estado del motor. Durante una pausa
 * comercial, "el programa" es el del BLOQUE EN CURSO (antes se buscaba por título en
 * toda la cola y podía mostrar el episodio de un bloque posterior).
 */

const PlayoutQueue = require('./PlayoutQueue');

class StatusPresenter {
  /**
   * @param {Object} deps
   * @param {Function} deps.cleanTitle
   * @param {Function} deps.blockFor - (item) => bloque de la parrilla al que pertenece
   */
  constructor({ cleanTitle, blockFor }) {
    this.cleanTitle = cleanTitle;
    this.blockFor = blockFor;
  }

  programTitle(item) {
    return item.showTitle || this.cleanTitle(item.name);
  }

  /** Programa al que pertenece el elemento actual (episodio, o el del bloque en la pausa). */
  currentProgram(queue, index, track, timing) {
    if (!track) return null;
    if (track.role === 'main_show') {
      return { name: track.name, showTitle: this.programTitle(track), isCommercialBreak: false, blockTitle: track.blockTitle, ...timing };
    }

    // Pausa comercial: episodio del mismo bloque (por su hora de inicio, no por título)
    const sameBlock = (it) => it.role === 'main_show' && it.slotStartTime === track.slotStartTime;
    let show = null;
    for (let i = index; i >= 0 && !show; i--) if (sameBlock(queue.at(i))) show = queue.at(i);
    for (let i = index + 1; i < queue.length && !show; i++) {
      if (queue.at(i).slotStartTime !== track.slotStartTime) break;
      if (sameBlock(queue.at(i))) show = queue.at(i);
    }
    if (!show) {
      const block = this.blockFor(track);
      show = block && block.mainShow ? block.mainShow : null;
    }

    return {
      name: show ? show.name : (track.blockTitle || 'Home Channel'),
      showTitle: show ? this.programTitle(show) : 'Home Channel',
      isCommercialBreak: true,
      breakRole: track.role,
      segmentName: track.name,
      blockTitle: track.blockTitle,
      ...timing
    };
  }

  /** Próximo programa (siguiente episodio distinto del actual). */
  nextProgram(queue, index, track) {
    const currentIsShow = track && track.role === 'main_show';
    for (let i = index + 1; i < queue.length; i++) {
      const item = queue.at(i);
      if (item.role === 'main_show' && (!currentIsShow || item.id !== track.id)) {
        return { name: item.name, showTitle: this.programTitle(item), blockTitle: item.blockTitle, duration: Math.round(item.duration), index: i };
      }
    }
    return null;
  }

  /**
   * @param {Object} s - estado del motor: { queue, index, position, running, startedAt, encoderName, resyncAt, override, clock }
   */
  present(s) {
    const track = s.queue.at(s.index);
    const duration = track ? Math.round(PlayoutQueue.durationOf(track)) : 0;
    const elapsed = track && s.running
      ? Math.min(Math.max(0, Math.round(s.position - s.queue.offsets[s.index])), duration || Infinity)
      : 0;
    const progressPercent = duration > 0 ? Math.min(100, Math.round((elapsed / duration) * 100)) : 0;
    const timing = { duration, elapsed, progressPercent };
    const next = s.queue.at(s.index + 1);

    return {
      isRunning: s.running,
      startedAt: s.startedAt,
      encoder: s.encoderName,
      uptimeSeconds: s.startedAt ? Math.round((Date.now() - s.startedAt) / 1000) : 0,
      currentProgram: this.currentProgram(s.queue, s.index, track, timing),
      currentTrack: track ? { id: track.id, name: track.name, role: track.role, type: track.type, blockTitle: track.blockTitle, ...timing } : null,
      nextTrack: next ? { name: next.name, role: next.role, type: next.type, duration: Math.round(PlayoutQueue.durationOf(next)) } : null,
      nextProgram: this.nextProgram(s.queue, s.index, track),
      pendingResyncAt: s.resyncAt || null,
      pendingOverride: s.override || null,
      clockSync: s.clock,
      queueTotal: s.queue.length
    };
  }
}

module.exports = StatusPresenter;
