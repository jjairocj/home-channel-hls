/**
 * Home Channel Master Control - Programador de parrilla por reglas.
 *
 * Vista semanal editable: cada bloque es una regla ("esta serie, estos días, a esta
 * hora"). Lo sugerido por la programación automática se ve punteado; al editarlo pasa a
 * ser del administrador y las propuestas siguientes lo respetan.
 */

import { $, on, setText } from '/shared/dom.js';
import { api } from '/shared/api.js';
import { escapeHtml } from '/shared/format.js';
import { store, reload, describeResync } from '../store.js';
import { refreshScheduleBlocks } from '../schedule/blocks.js';
import { WeekCalendar, DAYS, hueOf } from './WeekCalendar.js';
import { RuleEditor } from './RuleEditor.js';

const DAY_IDS = DAYS.map(d => d.id);
const dayName = (id) => (DAYS.find(d => d.id === id) || {}).short || id;
const shiftDay = (day, delta) => DAY_IDS[(DAY_IDS.indexOf(day) + delta + 7) % 7];

let calendar = null;
let editor = null;

/* ---------- Móvil: un día a la vez ---------- */

const mobile = window.matchMedia('(max-width: 720px)');

/** Día de transmisión actual (antes de las 06:00 cuenta como el día anterior). */
function broadcastToday() {
  const now = new Date();
  const index = (now.getDay() + 6) % 7 - (now.getHours() < 6 ? 1 : 0);
  return DAY_IDS[(index + 7) % 7];
}

let pickedDay = broadcastToday();

function renderDayPicker() {
  const picker = $('weekDayPicker');
  if (!picker) return;
  picker.innerHTML = DAYS.map(d => `<button type="button" class="rule-day${d.id === pickedDay ? ' on' : ''}" role="tab" aria-selected="${d.id === pickedDay}" data-day="${d.id}">${d.short}</button>`).join('');
}

function applyDayMode() {
  calendar.setDayFilter(mobile.matches ? pickedDay : null);
}

function initDayPicker() {
  renderDayPicker();
  on('weekDayPicker', 'click', (e) => {
    const btn = e.target.closest('[data-day]');
    if (!btn) return;
    pickedDay = btn.dataset.day;
    renderDayPicker();
    applyDayMode();
  });
  mobile.addEventListener('change', applyDayMode);
  applyDayMode();
}

const view = () => store.get('week');
const ruleOf = (id) => (view().rules || []).find(r => r.id === id);

/* ---------- Guardar cambios ---------- */

async function afterChange(data, what) {
  if (data && data.success === false) throw new Error(data.error);
  await reload('week');
  await reload('programming');
  refreshScheduleBlocks();
  const at = data && data.resyncAt ? describeResync(data.resyncAt).trim() : '';
  const replaced = data && data.replaced ? ` Reemplazó lo que había en ${data.replaced === 1 ? '1 regla' : `${data.replaced} reglas`}.` : '';
  setText('weekStatus', `✔ ${what}.${replaced} ${at}`);
}

async function run(task, what) {
  try {
    await afterChange(await task(), what);
  } catch (e) {
    alert(`No se pudo guardar: ${e.message}`);
    calendar.render(view());
  }
}

async function saveRuleFromEditor(rule) {
  const { id, ...fields } = rule;
  const data = id
    ? await api.put(`/api/admin/schedule/rules/${encodeURIComponent(id)}`, fields)
    : await api.post('/api/admin/schedule/rules', fields);
  await afterChange(data, id ? 'Regla guardada' : 'Regla creada');
}

async function deleteRule(rule) {
  await afterChange(await api.del(`/api/admin/schedule/rules/${encodeURIComponent(rule.id)}`), 'Regla eliminada');
}

/* ---------- Mover y estirar bloques ---------- */

/** Día de la regla dueño del bloque (un bloque que pasa de las 05:30 sigue en la columna siguiente). */
function ownerDay(block) {
  const times = view().times;
  const first = block.cells[0];
  return times.indexOf(first.time) - first.index < 0 ? shiftDay(block.day, -1) : block.day;
}

/**
 * Aplica un cambio a la regla de un bloque. Solo a ese día (separándolo en una regla
 * propia) salvo que la regla tenga un solo día o se pida para todos.
 */
function applyToBlock(block, patch, allDays, what) {
  const rule = ruleOf(block.ruleId);
  if (!rule) return;
  const day = ownerDay(block);
  if (allDays || rule.days.length === 1) {
    return run(() => api.put(`/api/admin/schedule/rules/${encodeURIComponent(rule.id)}`, patch(rule, rule.days)), what);
  }
  const own = { kind: rule.kind, target: rule.target, startTime: rule.startTime, slots: rule.slots, note: rule.note, priority: rule.priority };
  return run(() => api.post('/api/admin/schedule/rules/batch', {
    ops: [
      { op: 'update', id: rule.id, rule: { days: rule.days.filter(d => d !== day) } },
      { op: 'create', rule: { ...own, ...patch(rule, [day]) } }
    ]
  }), what);
}

function onMove({ block, day, time, allDays }) {
  const times = view().times;
  const startRow = times.indexOf(time) - block.cells[0].index;
  if (startRow < 0) {
    alert('Ese bloque es la continuación de uno que empieza el día anterior: muévelo desde su inicio.');
    return calendar.render(view());
  }
  const delta = DAY_IDS.indexOf(day) - DAY_IDS.indexOf(block.day);
  const where = `${allDays ? 'Todos sus días' : dayName(day)} ${times[startRow]}`;
  applyToBlock(block, (rule, days) => ({ days: days.map(d => shiftDay(d, delta)), startTime: times[startRow] }), allDays, `Movida a ${where}`);
}

function onResize({ block, slots }) {
  const rule = ruleOf(block.ruleId);
  if (!rule) return;
  const total = Math.max(1, Math.min(48, rule.slots + slots - block.rows));
  applyToBlock(block, () => ({ slots: total }), false, `Duración: ${total} bloques`);
}

/* ---------- Abrir el editor ---------- */

function editBlock(block) {
  const rule = ruleOf(block.ruleId);
  if (rule) editor.open(rule, view());
}

function newRule(day = 'monday', time = '19:00') {
  editor.open({ kind: 'show', days: [day], startTime: time, slots: 1, source: 'manual' }, view());
}

/* ---------- Buscar una serie en la parrilla ---------- */

let focusKey = null;

/** Series de la vista semanal con sus bloques de 30 min por semana. */
function seriesWithSlots(week) {
  const slots = {};
  for (const c of Object.values(week.cells || {})) {
    if (c.kind !== 'off_air' && c.sagaKey) slots[c.sagaKey] = (slots[c.sagaKey] || 0) + 1;
  }
  return (week.series || [])
    .map(s => ({ ...s, slots: slots[s.key] || 0 }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

function renderFinder() {
  const box = $('seriesFinder');
  const week = view();
  if (!box || !week) return;
  const q = ($('seriesFinderSearch')?.value || '').trim().toLowerCase();
  const list = seriesWithSlots(week).filter(s => !q || s.label.toLowerCase().includes(q));
  box.innerHTML = list.map(s => {
    const where = s.slots ? `${s.slots} ${s.slots === 1 ? 'bloque' : 'bloques'}/sem` : (s.eligible ? 'sin horario' : 'no disponible');
    const classes = ['series-chip', s.key === focusKey ? 'on' : '', s.slots ? '' : 'off-grid'].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" role="option" aria-selected="${s.key === focusKey}" data-series="${escapeHtml(s.key)}" style="--hue:${hueOf(s.key)}">
      <span class="chip-dot"></span>${escapeHtml(s.label)}<small>${where}</small></button>`;
  }).join('') || '<span class="badge-hint">Ninguna serie coincide.</span>';
}

/** Primer día (en orden de la semana) en que la serie tiene bloque. */
function firstDayOf(key) {
  const week = view();
  return DAY_IDS.find(day => Object.values(week.cells).some(c => c.sagaKey === key && c.day === day)) || null;
}

function focusSeries(key) {
  focusKey = key === focusKey ? null : key;
  // En el móvil se ve un día: se salta al primero donde está la serie
  if (focusKey && mobile.matches) {
    const day = firstDayOf(focusKey);
    if (day && day !== pickedDay) {
      pickedDay = day;
      renderDayPicker();
      applyDayMode();
    }
  }
  const found = calendar.setFocus(focusKey);
  renderFinder();
  const s = (view().series || []).find(x => x.key === focusKey);
  if (focusKey) setText('weekStatus', found ? `${s ? s.label : ''}: ${found} ${found === 1 ? 'bloque resaltado' : 'bloques resaltados'} en la parrilla` : `${s ? s.label : ''} no está en la parrilla esta semana`);
  else setText('weekStatus', '');
}

/* ---------- Conflictos y estado ---------- */

function ruleLabel(id) {
  const r = ruleOf(id);
  if (!r) return '¿?';
  if (r.kind === 'off_air') return 'Cierre';
  const s = (view().series || []).find(x => x.value === r.target) || {};
  const name = s.label || ((view().series || []).flatMap(x => x.seasons).find(m => m.id === r.target) || {}).title || r.target;
  return `${r.kind === 'marathon' ? 'Maratón ' : ''}${name} (${r.source === 'auto' ? 'sugerida' : 'tuya'})`;
}

function renderConflicts(conflicts) {
  const box = $('weekConflicts');
  if (!box) return;
  box.hidden = !conflicts.length;
  if (!conflicts.length) return;
  // Un renglón por pareja de reglas, con los horarios donde se pisan
  const pairs = new Map();
  for (const c of conflicts) {
    for (const loser of c.losers) {
      const key = `${c.winner}|${loser}`;
      if (!pairs.has(key)) pairs.set(key, { winner: c.winner, loser, at: [] });
      pairs.get(key).at.push(`${dayName(c.day)} ${c.time}`);
    }
  }
  const rows = [...pairs.values()].slice(0, 12).map(p => {
    const at = p.at.length > 3 ? `${p.at.slice(0, 3).join(', ')} y ${p.at.length - 3} más` : p.at.join(', ');
    return `<li><strong>${escapeHtml(ruleLabel(p.winner))}</strong> tapa a ${escapeHtml(ruleLabel(p.loser))} · ${escapeHtml(at)}</li>`;
  }).join('');
  box.innerHTML = `<div class="week-conflicts-head"><span><strong>⚠ ${pairs.size} ${pairs.size === 1 ? 'choque' : 'choques'} entre reglas</strong>: sale al aire la primera y la otra queda tapada.</span>
    <button type="button" class="btn-micro" id="btnResolveConflicts" title="Deja lo que hoy sale al aire y quita lo que está debajo">🧹 Quitar lo tapado</button></div><ul>${rows}</ul>`;
}

async function resolveConflicts(btn) {
  if (!confirm('¿Quitar lo que está tapado?\nSe queda lo que hoy sale al aire en cada horario; las reglas de debajo se recortan o se eliminan.')) return;
  btn.disabled = true;
  try {
    const data = await api.post('/api/admin/schedule/rules/resolve-conflicts');
    await afterChange({ ...data, replaced: 0 }, `Choques resueltos (${data.affected} ${data.affected === 1 ? 'regla ajustada' : 'reglas ajustadas'})`);
  } catch (e) {
    alert('No se pudieron resolver los choques: ' + e.message);
    btn.disabled = false;
  }
}

function renderWeek(week) {
  if (!week || !week.cells) return;
  calendar.render(week);
  renderFinder();
  renderConflicts(week.conflicts || []);
  const rules = week.rules || [];
  const manual = rules.filter(r => r.source === 'manual').length;
  if (!$('weekStatus').textContent.startsWith('✔')) {
    setText('weekStatus', `${rules.length} reglas · ${manual} tuyas · ${rules.length - manual} sugeridas`);
  }
}

export function initProgrammer() {
  calendar = new WeekCalendar($('weekCalendar'), {
    onEmpty: newRule,
    onBlock: editBlock,
    onMove,
    onResize
  });
  editor = new RuleEditor({ onSave: saveRuleFromEditor, onDelete: deleteRule });
  initDayPicker();
  on('btnNewRule', 'click', () => newRule(mobile.matches ? pickedDay : 'monday'));
  store.on('week', renderWeek);
  on('seriesFinderSearch', 'input', renderFinder);
  on('seriesFinder', 'click', (e) => {
    const chip = e.target.closest('[data-series]');
    if (chip) focusSeries(chip.dataset.series);
  });
  on('weekConflicts', 'click', (e) => {
    const btn = e.target.closest('#btnResolveConflicts');
    if (btn) resolveConflicts(btn);
  });
}

