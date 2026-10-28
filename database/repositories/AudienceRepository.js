/**
 * Home Channel HLS - Historial de audiencia: una muestra por minuto (cuántos estaban viendo y
 * qué había al aire) y cada sesión de visualización (cliente anónimo, tipo, duración).
 *
 * Postgres guarda el historial (se purga lo de más de un año). En memoria solo quedan
 * las últimas 26 horas, para que el panel funcione aunque la base no esté disponible;
 * no se escribe al respaldo JSON (sería una escritura de disco por minuto).
 */

const SQL = require('../sql');

const MEMORY_MS = 26 * 3600 * 1000;
const RETENTION_DAYS = 365;

class AudienceRepository {
  constructor({ pg }) {
    this.pg = pg;
    this.samples = [];
    this.sessions = [];
  }

  trimMemory() {
    const cutoff = Date.now() - MEMORY_MS;
    this.samples = this.samples.filter(s => new Date(s.at).getTime() > cutoff);
    this.sessions = this.sessions.filter(s => new Date(s.startedAt).getTime() > cutoff);
  }

  /** @param {{ at: string, web: number, tv: number, radio: number, program: string|null }} sample */
  logSample(sample) {
    this.samples.push(sample);
    this.trimMemory();
    this.pg.write('insertAudienceSample', SQL.INSERT_AUDIENCE_SAMPLE, [sample.at, sample.web, sample.tv, sample.radio, sample.program]);
  }

  /** @param {{ clientHash, kind, startedAt, endedAt, seconds }} session */
  logSession(session) {
    this.sessions.push(session);
    this.trimMemory();
    this.pg.write('insertAudienceSession', SQL.INSERT_AUDIENCE_SESSION,
      [session.clientHash, session.kind, session.startedAt, session.endedAt, session.seconds]);
  }

  async rangeOf(memory, sql, from, to, field) {
    if (this.pg.available) {
      try {
        return (await this.pg.query(sql, [from, to])).rows;
      } catch (e) {}
    }
    const a = new Date(from).getTime();
    const b = new Date(to).getTime();
    return memory.filter(x => { const t = new Date(x[field]).getTime(); return t >= a && t < b; });
  }

  samplesRange(from, to) {
    return this.rangeOf(this.samples, SQL.SELECT_AUDIENCE_SAMPLES, from, to, 'at');
  }

  sessionsRange(from, to) {
    return this.rangeOf(this.sessions, SQL.SELECT_AUDIENCE_SESSIONS, from, to, 'startedAt');
  }

  /** Borra lo de más de un año (se llama una vez al día). */
  purge() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
    this.pg.write('purgeAudienceSamples', SQL.PURGE_AUDIENCE_SAMPLES, [cutoff]);
    this.pg.write('purgeAudienceSessions', SQL.PURGE_AUDIENCE_SESSIONS, [cutoff]);
  }
}

module.exports = AudienceRepository;
