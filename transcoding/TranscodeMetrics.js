/**
 * Home Channel HLS - Métricas de la cola de transcodificación (ETA, capítulos por hora, fps).
 */

const SAMPLE_SIZE = 40;
const DEFAULT_AVG_SECONDS = 88;

class TranscodeMetrics {
  constructor() {
    this.recent = [];
    this.completedInSession = 0;
  }

  record(durationSec, job) {
    this.recent.push({ durationSec, completedAt: Date.now(), title: job.title || job.originalFilename, type: job.type });
    if (this.recent.length > SAMPLE_SIZE) this.recent.shift();
    this.completedInSession++;
  }

  static formatEta(seconds, remaining) {
    if (!remaining) return 'Completado';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  /** @param {{queueCount, activeJobs, concurrency}} state */
  snapshot({ queueCount, activeJobs, concurrency }) {
    const conc = Math.max(1, concurrency);
    const remainingEpisodes = queueCount + activeJobs.length;
    const avgSec = this.recent.length
      ? Math.round(this.recent.reduce((acc, r) => acc + r.durationSec, 0) / this.recent.length)
      : DEFAULT_AVG_SECONDS;
    const remainingSeconds = remainingEpisodes ? Math.round((remainingEpisodes * avgSec) / conc) : 0;

    return {
      avgSecondsPerEpisode: avgSec,
      avgDurationFormatted: avgSec >= 60 ? `${Math.floor(avgSec / 60)}m ${avgSec % 60}s` : `${avgSec}s`,
      episodesPerHour: avgSec > 0 ? parseFloat(((3600 / avgSec) * conc).toFixed(1)) : 0,
      remainingEpisodes,
      queueCount,
      activeCount: activeJobs.length,
      concurrency: conc,
      remainingSeconds,
      etaFormatted: TranscodeMetrics.formatEta(remainingSeconds, remainingEpisodes),
      etaTimestamp: remainingEpisodes ? Date.now() + remainingSeconds * 1000 : null,
      totalFps: Math.round(activeJobs.reduce((acc, j) => acc + (parseFloat(j.fps) || 0), 0)),
      completedInSession: this.completedInSession,
      sampleSize: this.recent.length
    };
  }
}

module.exports = TranscodeMetrics;
