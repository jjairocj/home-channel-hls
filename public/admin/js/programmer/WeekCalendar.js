/**
 * Home Channel Master Control - Vista semanal de la parrilla (como una guía de TV).
 *
 * Columnas = días de transmisión (de 06:00 a 05:30 del día siguiente), filas = bloques
 * de 30 min. Las celdas compiladas por el servidor se agrupan en bloques por regla.
 * Interacciones (si no es de solo lectura): clic en vacío, clic en bloque, arrastrar
 * para mover y estirar el borde inferior para cambiar la duración. En pantallas
 * táctiles el dedo desplaza la vista: tocar un bloque lo edita (sin arrastre).
 * Con un filtro de día (móvil) se muestra una sola columna. Con una serie enfocada
 * (setFocus) sus bloques se resaltan y el resto se atenúa.
 */

import { escapeHtml } from '/shared/format.js';

export const DAYS = [
  { id: 'monday', name: 'LUNES', short: 'LUN' },
  { id: 'tuesday', name: 'MARTES', short: 'MAR' },
  { id: 'wednesday', name: 'MIÉRCOLES', short: 'MIÉ' },
  { id: 'thursday', name: 'JUEVES', short: 'JUE' },
  { id: 'friday', name: 'VIERNES', short: 'VIE' },
  { id: 'saturday', name: 'SÁBADO', short: 'SÁB' },
  { id: 'sunday', name: 'DOMINGO', short: 'DOM' }
];

export const BADGES = {
  premiere: 'ESTRENO',
  repeat: 'REPETICIÓN',
  marathon: 'MARATÓN',
  random: 'AL AZAR',
  off: 'CIERRE'
};

/** Cierre nocturno implícito (01:00–04:30): se sombrea en la vista. */
const isNight = (time) => time >= '01:00' && time < '05:00';

/** Tono estable por serie, para distinguir bloques de un vistazo. */
export function hueOf(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash % 360);
}

/**
 * Agrupa las celdas de cada día en bloques consecutivos de la misma regla.
 * @param {Object[]} [days] - días visibles (col = posición en esta lista)
 */
export function buildBlocks(cells, times, days = DAYS) {
  const blocks = [];
  days.forEach((day, col) => {
    let open = null;
    times.forEach((time, row) => {
      const cell = cells[`${day.id}|${time}`];
      if (open && cell && cell.ruleId === open.ruleId && cell.badge === open.badge) {
        open.rows++;
        open.cells.push(cell);
        return;
      }
      open = null;
      if (!cell) return;
      open = { ruleId: cell.ruleId, day: day.id, col, row, rows: 1, cells: [cell], badge: cell.badge, label: cell.label, source: cell.source, kind: cell.kind, sagaKey: cell.sagaKey, target: cell.target };
      blocks.push(open);
    });
  });
  return blocks;
}

export class WeekCalendar {
  /**
   * @param {HTMLElement} root
   * @param {Object} [opts]
   * @param {boolean} [opts.readOnly]
   * @param {(day, time) => void} [opts.onEmpty]
   * @param {(block) => void} [opts.onBlock]
   * @param {(move: {block, day, time, allDays}) => void} [opts.onMove] - day/time: nuevo inicio
   * @param {(resize: {block, slots}) => void} [opts.onResize] - slots: nueva duración en este día
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.view = null;
    this.highlight = new Set();
    this.dayFilter = null;
    this.focusKey = null;
    if (!opts.readOnly) this.bindPointer();
  }

  /** Muestra un solo día (id) o todos (null). */
  setDayFilter(day) {
    if (day === this.dayFilter) return;
    this.dayFilter = day;
    if (this.view) this.render(this.view);
  }

  /**
   * Resalta los bloques de una serie (clave de saga) y lleva la vista al primero.
   * @param {string|null} key - null quita el resaltado
   * @returns {number} bloques resaltados
   */
  setFocus(key) {
    this.focusKey = key || null;
    if (!this.view) return 0;
    this.render(this.view);
    const first = this.root.querySelector('.wk-block.focus');
    if (first) first.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    return this.root.querySelectorAll('.wk-block.focus').length;
  }

  get visibleDays() {
    return this.dayFilter ? DAYS.filter(d => d.id === this.dayFilter) : DAYS;
  }

  render(view, { highlight } = {}) {
    this.view = view;
    if (highlight) this.highlight = highlight;
    const { times, cells } = view;
    const days = this.visibleDays;
    const weekend = (d) => DAYS.indexOf(d) >= 5;
    const head = `<div class="wk-corner"></div>${days.map((d, i) => `<div class="wk-day${weekend(d) ? ' wk-weekend' : ''}" style="grid-column:${i + 2}">${d.name}</div>`).join('')}`;
    const slots = times.map((time, row) => {
      const label = `<div class="wk-time${time.endsWith(':00') ? '' : ' half'}" style="grid-row:${row + 2}">${time}</div>`;
      const cols = days.map((d, col) => `<div class="wk-slot${isNight(time) ? ' night' : ''}${weekend(d) ? ' weekend' : ''}" data-day="${d.id}" data-time="${time}" style="grid-row:${row + 2};grid-column:${col + 2}"></div>`).join('');
      return label + cols;
    }).join('');
    this.root.style.setProperty('--days', days.length);
    this.blocks = buildBlocks(cells, times, days);
    const blocks = this.blocks.map((b, i) => this.blockHtml(b, i)).join('');
    this.root.innerHTML = head + slots + blocks;
    this.root.classList.toggle('read-only', !!this.opts.readOnly);
    this.root.classList.toggle('has-focus', !!this.focusKey);
  }

  blockHtml(b, i) {
    const hue = b.kind === 'off_air' ? null : hueOf(b.sagaKey || b.target || '');
    const style = [`grid-row:${b.row + 2} / span ${b.rows}`, `grid-column:${b.col + 2}`];
    if (hue !== null) style.push(`--hue:${hue}`);
    const changed = b.cells.some(c => this.highlight.has(`${c.day}|${c.time}`));
    const badge = b.badge === 'marathon' ? `${BADGES.marathon} ×${b.rows}` : (BADGES[b.badge] || '');
    const first = b.cells[0].time;
    const end = this.view.times[b.row + b.rows] || '06:00';
    const classes = ['wk-block', `k-${b.kind}`, b.source === 'auto' ? 'auto' : 'manual'];
    if (changed) classes.push('changed');
    if (this.focusKey) classes.push((b.sagaKey || b.target) === this.focusKey ? 'focus' : 'dim');
    if (b.rows === 1) classes.push('short');
    const title = `${b.label} · ${first}–${end} · ${badge}${b.source === 'auto' ? ' · sugerida' : ' · tuya'}`;
    return `
      <div class="${classes.join(' ')}" data-block="${i}" style="${style.join(';')}" title="${escapeHtml(title)}">
        <span class="wk-label">${escapeHtml(b.label)}</span>
        <span class="wk-badge b-${b.badge}">${badge}</span>
        ${this.opts.readOnly ? '' : '<span class="wk-resize" data-resize="1"></span>'}
      </div>`;
  }

  /* ---------- Arrastrar, estirar y clic ---------- */

  slotAt(x, y) {
    const el = document.elementsFromPoint(x, y).find(e => e.classList && e.classList.contains('wk-slot'));
    return el ? { day: el.dataset.day, time: el.dataset.time } : null;
  }

  bindPointer() {
    let drag = null;

    this.root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const blockEl = e.target.closest('.wk-block');
      if (!blockEl) return;
      const block = this.blocks[+blockEl.dataset.block];
      // Táctil: el gesto desplaza la vista; un toque sin moverse abre el editor
      if (e.pointerType === 'touch') {
        drag = { touch: true, block, startX: e.clientX, startY: e.clientY, moved: false };
        return;
      }
      const at = this.slotAt(e.clientX, e.clientY);
      const grabRow = at ? Math.max(0, this.view.times.indexOf(at.time) - block.row) : 0;
      drag = { block, el: blockEl, resize: !!e.target.dataset.resize, grabRow, startX: e.clientX, startY: e.clientY, moved: false, target: null };
      try {
        blockEl.setPointerCapture(e.pointerId);
      } catch (err) { /* puntero sintético: se sigue sin captura */ }
      e.preventDefault();
    });

    this.root.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
      if (drag.touch) {
        drag.moved = true;
        return;
      }
      drag.moved = true;
      const at = this.slotAt(e.clientX, e.clientY);
      if (!at) return;
      const row = this.view.times.indexOf(at.time);
      const { block, el } = drag;
      if (drag.resize) {
        const rows = Math.max(1, row - block.row + 1);
        drag.target = { rows };
        el.style.gridRow = `${block.row + 2} / span ${rows}`;
      } else {
        const startRow = Math.max(0, Math.min(this.view.times.length - block.rows, row - drag.grabRow));
        const col = this.visibleDays.findIndex(d => d.id === at.day);
        drag.target = { day: at.day, time: this.view.times[startRow] };
        el.style.gridRow = `${startRow + 2} / span ${block.rows}`;
        el.style.gridColumn = `${col + 2}`;
      }
      el.classList.add('dragging');
    });

    const finish = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.touch) {
        if (!d.moved && e.type === 'pointerup' && this.opts.onBlock) this.opts.onBlock(d.block);
        return;
      }
      d.el.classList.remove('dragging');
      if (!d.moved) {
        if (this.opts.onBlock) this.opts.onBlock(d.block);
        return;
      }
      if (!d.target || e.type === 'pointercancel') return this.render(this.view);
      if (d.resize) {
        if (d.target.rows === d.block.rows) return;
        this.opts.onResize && this.opts.onResize({ block: d.block, slots: d.target.rows });
      } else {
        const sameSpot = d.target.day === d.block.day && d.target.time === this.view.times[d.block.row];
        if (sameSpot) return this.render(this.view);
        this.opts.onMove && this.opts.onMove({ block: d.block, day: d.target.day, time: d.target.time, allDays: e.shiftKey });
      }
    };
    this.root.addEventListener('pointerup', finish);
    this.root.addEventListener('pointercancel', finish);

    this.root.addEventListener('click', (e) => {
      const slot = e.target.closest('.wk-slot');
      if (slot && this.opts.onEmpty) this.opts.onEmpty(slot.dataset.day, slot.dataset.time);
    });
  }
}
