/**
 * Home Channel HLS - Reglas de la grilla semanal.
 *
 * Una regla: { id, kind, target, days, startTime, slots, source, priority, enabled, note }
 *   kind     'show' (serie: estreno o repetición según el día), 'marathon' (capítulos de
 *            la semana seguidos) u 'off_air' (cierre de emisión)
 *   target   'saga:<clave>' o el id de una temporada (vacío en off_air)
 *   days     ['monday', …]
 *   source   'manual' (del administrador, manda) o 'auto' (sugerida por la propuesta)
 */

const SQL = require('../sql');
const { DAY_KEYS } = require('../../core/time');

const KINDS = ['show', 'marathon', 'off_air'];
const SOURCES = ['manual', 'auto'];
const newId = () => `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** Valida y normaliza una regla (lanza con un mensaje legible). */
function normalizeRule(input, base = {}) {
  const rule = { ...base, ...input };
  if (!KINDS.includes(rule.kind || 'show')) throw new Error('Tipo de regla inválido');
  rule.kind = rule.kind || 'show';
  if (rule.kind !== 'off_air' && !rule.target) throw new Error('La regla necesita una serie');
  if (rule.kind === 'off_air') rule.target = null;
  if (!Array.isArray(rule.days) || !rule.days.length || rule.days.some(d => !DAY_KEYS.includes(d))) throw new Error('Días inválidos');
  rule.days = DAY_KEYS.filter(d => rule.days.includes(d));
  if (!/^\d{2}:(00|30)$/.test(rule.startTime || '')) throw new Error('La hora debe ser en punto o y media (HH:00 / HH:30)');
  const slots = rule.slots === undefined || rule.slots === null ? 1 : parseInt(rule.slots, 10);
  if (isNaN(slots) || slots < 1 || slots > 48) throw new Error('Duración inválida (1-48 bloques de 30 min)');
  rule.slots = slots;
  rule.source = SOURCES.includes(rule.source) ? rule.source : 'manual';
  rule.priority = parseInt(rule.priority, 10) || 0;
  rule.enabled = rule.enabled !== false;
  rule.note = rule.note ? String(rule.note).slice(0, 200) : null;
  return rule;
}

class ScheduleRuleRepository {
  constructor({ store, pg }) {
    this.store = store;
    this.pg = pg;
  }

  get rules() {
    if (!Array.isArray(this.store.data.scheduleRules)) this.store.data.scheduleRules = [];
    return this.store.data.scheduleRules;
  }

  all() {
    return this.rules;
  }

  find(id) {
    return this.rules.find(r => r.id === id) || null;
  }

  persist(rule) {
    this.pg.write('upsertScheduleRule', SQL.UPSERT_SCHEDULE_RULE, [
      rule.id, rule.kind, rule.target, JSON.stringify(rule.days), rule.startTime, rule.slots,
      rule.source, rule.priority, rule.enabled, rule.note, rule.createdAt
    ]);
  }

  create(input) {
    const now = new Date().toISOString();
    const rule = normalizeRule(input, { id: newId(), createdAt: now });
    rule.updatedAt = now;
    this.rules.push(rule);
    this.store.save();
    this.persist(rule);
    return rule;
  }

  update(id, patch) {
    const current = this.find(id);
    if (!current) return null;
    const rule = normalizeRule({ ...patch, id, createdAt: current.createdAt }, current);
    rule.updatedAt = new Date().toISOString();
    this.rules[this.rules.indexOf(current)] = rule;
    this.store.save();
    this.persist(rule);
    return rule;
  }

  delete(id) {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx === -1) return null;
    const [removed] = this.rules.splice(idx, 1);
    this.store.save();
    this.pg.write('deleteScheduleRule', SQL.DELETE_SCHEDULE_RULE, [id]);
    return removed;
  }

  /** Reemplaza todas las reglas automáticas (las manuales no se tocan). */
  replaceAuto(inputs) {
    for (const r of this.rules.filter(x => x.source === 'auto')) this.pg.write('deleteScheduleRule', SQL.DELETE_SCHEDULE_RULE, [r.id]);
    const now = new Date().toISOString();
    const created = inputs.map(input => ({ ...normalizeRule({ ...input, source: 'auto' }, { id: newId(), createdAt: now }), updatedAt: now }));
    this.store.data.scheduleRules = [...this.rules.filter(r => r.source !== 'auto'), ...created];
    this.store.save();
    created.forEach(r => this.persist(r));
    return created;
  }
}

module.exports = ScheduleRuleRepository;
module.exports.normalizeRule = normalizeRule;
module.exports.KINDS = KINDS;
