/**
 * Home Channel HLS - Cola de transcodificación persistida.
 */

const SQL = require('../sql');

const MAX_COMPLETED_IN_MEMORY = 300;

class TranscodeJobRepository {
  constructor({ store, pg }) {
    this.store = store;
    this.pg = pg;
  }

  get jobs() {
    if (!Array.isArray(this.store.data.transcodeJobs)) this.store.data.transcodeJobs = [];
    return this.store.data.transcodeJobs;
  }

  all() {
    return this.jobs;
  }

  /** ¿Quedan capítulos de esta serie en la cola? */
  hasPending(showId) {
    return this.jobs.some(j => j.showId === showId && (j.status === 'pending' || j.status === 'processing'));
  }

  add(job) {
    this.jobs.unshift(job);
    // Solo se conservan en memoria los últimos completados
    let completed = 0;
    this.store.data.transcodeJobs = this.jobs.filter(j => j.status !== 'completed' || ++completed <= MAX_COMPLETED_IN_MEMORY);
    this.store.save();

    this.pg.write('addTranscodeJob', SQL.UPSERT_JOB, [
      job.id, job.inputPath, job.originalFilename, job.type || 'show', job.showId || null,
      job.title || '', parseInt(job.season, 10) || 1, parseInt(job.episode, 10) || 1,
      parseInt(job.progress, 10) || 0, parseFloat(job.fps) || 0, job.status || 'pending',
      job.error || null, job.createdAt || new Date().toISOString()
    ]);
    return job;
  }

  update(jobId, update) {
    const job = this.jobs.find(j => j.id === jobId);
    if (!job) return null;
    Object.assign(job, update);
    // El progreso cambia cada pocos segundos: al JSON solo van los cambios de estado
    if (update.status) this.store.save();

    this.pg.write('updateTranscodeJob', SQL.UPDATE_JOB, [
      update.progress !== undefined ? parseInt(update.progress, 10) : null,
      update.fps !== undefined ? parseFloat(update.fps) : null,
      update.status || null,
      update.error || null,
      jobId
    ]);
    return job;
  }
}

module.exports = TranscodeJobRepository;
