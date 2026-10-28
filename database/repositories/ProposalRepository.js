/**
 * Home Channel HLS - Propuestas de la programación automática: un conjunto de reglas
 * sugeridas que el administrador acepta (reemplazan las reglas automáticas) o descarta.
 */

const SQL = require('../sql');

const KEEP = 5;

class ProposalRepository {
  constructor({ store, pg }) {
    this.store = store;
    this.pg = pg;
  }

  get list() {
    if (!Array.isArray(this.store.data.proposals)) this.store.data.proposals = [];
    return this.store.data.proposals;
  }

  latest() {
    return this.list[0] || null;
  }

  pending() {
    const p = this.latest();
    return p && p.status === 'pending' ? p : null;
  }

  save(proposal) {
    const record = { status: 'pending', decidedAt: null, warnings: [], summary: [], ...proposal };
    // Una sola propuesta pendiente a la vez
    for (const p of this.list) {
      if (p.status !== 'pending') continue;
      p.status = 'replaced';
      p.decidedAt = new Date().toISOString();
      this.write(p);
    }
    this.store.data.proposals = [record, ...this.list.filter(p => p.id !== record.id)].slice(0, KEEP);
    this.store.save();
    this.write(record);
    return record;
  }

  decide(id, status) {
    const p = this.list.find(x => x.id === id);
    if (!p) return null;
    p.status = status;
    p.decidedAt = new Date().toISOString();
    this.store.save();
    this.write(p);
    return p;
  }

  write(p) {
    this.pg.write('upsertProposal', SQL.UPSERT_PROPOSAL, [
      p.id, p.status, p.reason || null, JSON.stringify(p.rules || []), JSON.stringify(p.warnings || []),
      JSON.stringify(p.summary || []), p.createdAt, p.decidedAt
    ]);
  }
}

module.exports = ProposalRepository;
