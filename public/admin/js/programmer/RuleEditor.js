/**
 * Home Channel Master Control - Editor de una regla de la parrilla:
 * "esta serie, estos días, a esta hora, durante N bloques".
 */

import { $, on } from '/shared/dom.js';
import { Modal } from '/shared/modal.js';
import { escapeHtml } from '/shared/format.js';
import { DAYS } from './WeekCalendar.js';

const PRESETS = {
  weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  weekend: ['saturday', 'sunday'],
  all: DAYS.map(d => d.id)
};

const MAX_SLOTS = 24;
const DEFAULT_SLOTS = { show: 1, marathon: 5, off_air: 2 };

function durationLabel(slots) {
  const min = slots * 30;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${slots} ${slots === 1 ? 'bloque' : 'bloques'} (${h ? `${h} h` : ''}${h && m ? ' ' : ''}${m ? `${m} min` : ''})`;
}

export class RuleEditor {
  /**
   * @param {Object} deps
   * @param {(rule) => Promise} deps.onSave - rule.id presente = edición
   * @param {(rule) => Promise} deps.onDelete
   */
  constructor({ onSave, onDelete }) {
    this.onSave = onSave;
    this.onDelete = onDelete;
    this.modal = new Modal('ruleModal', { closers: ['btnCloseRuleModal', 'btnCancelRule'] });
    this.rule = null;
    this.series = [];
    this.times = [];

    $('ruleDays').innerHTML = DAYS.map(d => `<button type="button" class="rule-day" data-day="${d.id}">${d.short}</button>`).join('');
    on('ruleDays', 'click', (e) => {
      const btn = e.target.closest('.rule-day');
      if (btn) btn.classList.toggle('on');
    });
    document.querySelectorAll('.rule-day-presets [data-preset]').forEach(btn => on(btn, 'click', () => this.setDays(PRESETS[btn.dataset.preset])));
    on('ruleKind', 'change', () => this.syncKind(true));
    on('ruleForm', 'submit', (e) => {
      e.preventDefault();
      this.save();
    });
    on('btnDeleteRule', 'click', () => this.remove());
  }

  setDays(days) {
    document.querySelectorAll('#ruleDays .rule-day').forEach(b => b.classList.toggle('on', days.includes(b.dataset.day)));
  }

  selectedDays() {
    return [...document.querySelectorAll('#ruleDays .rule-day.on')].map(b => b.dataset.day);
  }

  targetOptions(kind, selected) {
    const series = this.series.filter(s => kind !== 'marathon' || !s.episodic);
    const opt = (value, label) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    const ready = series.filter(s => s.eligible);
    const waiting = series.filter(s => !s.eligible);
    let html = `<optgroup label="Series listas">${ready.map(s => opt(s.value, s.label)).join('')}</optgroup>`;
    if (waiting.length) html += `<optgroup label="Sin capítulos listos">${waiting.map(s => opt(s.value, `${s.label} (no saldrá aún)`)).join('')}</optgroup>`;
    const seasons = series.flatMap(s => s.seasons.map(m => ({ ...m, saga: s.label })));
    if (seasons.length) html += `<optgroup label="Temporada específica">${seasons.map(m => opt(m.id, m.title)).join('')}</optgroup>`;
    // Una regla vieja puede apuntar a algo que ya no existe: se conserva
    if (selected && !series.some(s => s.value === selected) && !seasons.some(m => m.id === selected)) html = opt(selected, `${selected} (no encontrada)`) + html;
    return html;
  }

  syncKind(resetSlots = false) {
    const kind = $('ruleKind').value;
    $('ruleTargetLabel').hidden = kind === 'off_air';
    const current = $('ruleTarget').value || (this.rule && this.rule.target);
    $('ruleTarget').innerHTML = this.targetOptions(kind, current);
    if (resetSlots && !this.rule.id) $('ruleSlots').value = String(DEFAULT_SLOTS[kind]);
  }

  /**
   * @param {Object} rule - regla existente o valores iniciales de una nueva
   * @param {Object} view - vista semanal (series y horas)
   */
  open(rule, view) {
    this.rule = rule;
    this.series = view.series || [];
    this.times = view.times || [];
    const isNew = !rule.id;
    $('ruleModalTitle').textContent = isNew ? 'NUEVA REGLA' : 'EDITAR REGLA';
    $('ruleSourceNote').textContent = rule.source === 'auto'
      ? '⚡ Esta regla la sugirió la programación automática. Si la cambias pasa a ser tuya y las próximas propuestas la respetan.'
      : (isNew ? 'Tus reglas tienen prioridad sobre las sugeridas y las propuestas automáticas nunca las tocan.' : '');
    $('ruleKind').value = rule.kind || 'show';
    $('ruleTarget').innerHTML = '';
    $('ruleStart').innerHTML = this.times.map(t => `<option value="${t}" ${t === rule.startTime ? 'selected' : ''}>${t}</option>`).join('');
    $('ruleSlots').innerHTML = Array.from({ length: MAX_SLOTS }, (_, i) => i + 1)
      .map(n => `<option value="${n}" ${n === (rule.slots || 1) ? 'selected' : ''}>${durationLabel(n)}</option>`).join('');
    $('ruleNote').value = rule.note || '';
    this.setDays(rule.days || []);
    this.syncKind();
    if (rule.target) $('ruleTarget').value = rule.target;
    $('btnDeleteRule').hidden = isNew;
    this.modal.open();
  }

  read() {
    const kind = $('ruleKind').value;
    return {
      kind,
      target: kind === 'off_air' ? null : $('ruleTarget').value,
      days: this.selectedDays(),
      startTime: $('ruleStart').value,
      slots: parseInt($('ruleSlots').value, 10),
      note: $('ruleNote').value.trim() || null
    };
  }

  async save() {
    const data = this.read();
    if (!data.days.length) return alert('Elige al menos un día.');
    if (data.kind !== 'off_air' && !data.target) return alert('Elige una serie.');
    try {
      await this.onSave({ ...data, id: this.rule.id });
      this.modal.close();
    } catch (e) {
      alert('No se pudo guardar la regla: ' + e.message);
    }
  }

  async remove() {
    if (!this.rule.id || !confirm('¿Eliminar esta regla? Sus horarios quedan libres (al azar) hasta la próxima propuesta.')) return;
    try {
      await this.onDelete(this.rule);
      this.modal.close();
    } catch (e) {
      alert('No se pudo eliminar: ' + e.message);
    }
  }
}
