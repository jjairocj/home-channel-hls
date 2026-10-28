/**
 * Home Channel Master Control - Audiencia: gadget "Viendo ahora" y ventana con el
 * historial (gráfica de espectadores, totales, tabla y programas más vistos).
 *
 * La gráfica es una sola serie (espectadores = web + TV/IPTV): línea de 2 px con un
 * relleno suave, cuadrícula fina, valor al final y cursor con el detalle de cada punto.
 * Los títulos de programas vienen de la parrilla: se insertan con textContent.
 */

import { $, on, setText } from '/shared/dom.js';
import { api } from '/shared/api.js';
import { Modal } from '/shared/modal.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SERIES = '#1c6fb8';
const GRID = '#e3e8ee';
const MUTED = '#6c7a8b';
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const BUCKET_LABEL = { 5: 'cada 5 min', 60: 'por hora', 1440: 'por día' };

const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const num = (n) => (n == null ? '–' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: 1 }));
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;

function el(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

function html(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Etiqueta de tiempo de un punto según el intervalo. */
function pointLabel(iso, bucketMinutes) {
  const d = new Date(iso);
  if (bucketMinutes >= 1440) return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const end = new Date(d.getTime() + bucketMinutes * 60000);
  const day = bucketMinutes >= 60 ? `${DAYS[d.getDay()]} ${d.getDate()} · ` : '';
  return `${day}${hhmm(d)}–${hhmm(end)}`;
}

/** Escala del eje Y en números enteros "redondos". */
function niceScale(max) {
  const top = Math.max(1, Math.ceil(max));
  const step = top <= 4 ? 1 : top <= 10 ? 2 : top <= 25 ? 5 : top <= 50 ? 10 : Math.ceil(top / 5 / 10) * 10;
  const ceil = Math.ceil(top / step) * step;
  const ticks = [];
  for (let v = 0; v <= ceil; v += step) ticks.push(v);
  return { max: ceil, ticks };
}

/** Marcas del eje X: cada 3 h (6 h en pantallas angostas), cada día o cada 5 días. */
function xTicks(points, bucketMinutes, narrow) {
  const hourStep = narrow ? 6 : 3;
  const every = bucketMinutes === 5 ? 36 : bucketMinutes === 60 ? 24 : 5;
  const out = [];
  points.forEach((p, i) => {
    const d = new Date(p.at);
    const aligned = bucketMinutes === 5 ? d.getMinutes() === 0 && d.getHours() % hourStep === 0 : (bucketMinutes === 60 ? d.getHours() === 0 : i % every === 0);
    if (aligned) out.push({ i, label: bucketMinutes === 5 ? `${pad2(d.getHours())}:00` : `${DAYS[d.getDay()]} ${d.getDate()}` });
  });
  return out;
}

class AudienceChart {
  constructor(root) {
    this.root = root;
    this.data = null;
    this.tooltip = html('div', 'audience-tooltip');
    this.tooltip.hidden = true;
    new ResizeObserver(() => this.data && this.render(this.data)).observe(root);
  }

  render(data) {
    this.data = data;
    const { points, bucketMinutes } = data;
    const width = Math.max(300, this.root.clientWidth);
    const height = width < 520 ? 200 : 250;
    const m = { top: 14, right: 44, bottom: 26, left: 34 };
    const w = width - m.left - m.right;
    const h = height - m.top - m.bottom;
    const values = points.map(p => p.viewers);
    const { max, ticks } = niceScale(Math.max(0, ...values.filter(v => v != null)));
    const x = (i) => m.left + (points.length > 1 ? (i / (points.length - 1)) * w : w / 2);
    const y = (v) => m.top + h - (v / max) * h;

    const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}` });

    // Cuadrícula y eje Y (recesivos)
    for (const t of ticks) {
      svg.append(el('line', { x1: m.left, x2: m.left + w, y1: y(t), y2: y(t), stroke: GRID, 'stroke-width': 1 }));
      svg.append(el('text', { x: m.left - 8, y: y(t) + 4, 'text-anchor': 'end', fill: MUTED, 'font-size': 11 }, num(t)));
    }
    for (const t of xTicks(points, bucketMinutes, width < 520)) {
      svg.append(el('text', { x: x(t.i), y: height - 8, 'text-anchor': 'middle', fill: MUTED, 'font-size': 11 }, t.label));
    }

    // Tramos sin huecos (sin muestras = servidor apagado): línea y relleno suave
    const segments = [];
    let current = [];
    values.forEach((v, i) => {
      if (v == null) { if (current.length) segments.push(current); current = []; } else current.push(i);
    });
    if (current.length) segments.push(current);
    for (const seg of segments) {
      const line = seg.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`).join('');
      const area = `${line}L${x(seg[seg.length - 1]).toFixed(1)},${y(0)}L${x(seg[0]).toFixed(1)},${y(0)}Z`;
      svg.append(el('path', { d: area, fill: SERIES, 'fill-opacity': 0.1 }));
      svg.append(el('path', { d: line, fill: 'none', stroke: SERIES, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }

    // Valor al final de la línea
    const lastIndex = values.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0).pop();
    if (lastIndex != null) {
      svg.append(el('circle', { cx: x(lastIndex), cy: y(values[lastIndex]), r: 4, fill: SERIES, stroke: '#fff', 'stroke-width': 2 }));
      svg.append(el('text', { x: x(lastIndex) + 8, y: y(values[lastIndex]) + 4, fill: '#1b2430', 'font-size': 12, 'font-weight': 600 }, num(values[lastIndex])));
    }

    // Cursor: línea vertical que se pega al punto más cercano + recuadro con el detalle
    const cross = el('line', { y1: m.top, y2: m.top + h, stroke: '#9aa7b6', 'stroke-width': 1, visibility: 'hidden' });
    const dot = el('circle', { r: 4, fill: SERIES, stroke: '#fff', 'stroke-width': 2, visibility: 'hidden' });
    const hit = el('rect', { x: m.left, y: m.top, width: w, height: h, fill: 'transparent', tabindex: 0 });
    svg.append(cross, dot, hit);

    const show = (i) => {
      const p = points[i];
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      if (p.viewers != null) {
        dot.setAttribute('cx', x(i));
        dot.setAttribute('cy', y(p.viewers));
        dot.setAttribute('visibility', 'visible');
      } else {
        dot.setAttribute('visibility', 'hidden');
      }
      this.fillTooltip(p, bucketMinutes);
      this.tooltip.hidden = false;
      const left = Math.min(Math.max(x(i) + 12, 0), width - this.tooltip.offsetWidth - 4);
      this.tooltip.style.left = `${x(i) + 12 + this.tooltip.offsetWidth > width ? x(i) - this.tooltip.offsetWidth - 12 : left}px`;
      this.tooltip.style.top = `${m.top}px`;
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      this.tooltip.hidden = true;
    };
    const indexAt = (clientX) => {
      const r = svg.getBoundingClientRect();
      const px = clientX - r.left;
      return Math.max(0, Math.min(points.length - 1, Math.round(((px - m.left) / w) * (points.length - 1))));
    };
    hit.addEventListener('pointermove', (e) => show(indexAt(e.clientX)));
    hit.addEventListener('pointerdown', (e) => show(indexAt(e.clientX)));
    hit.addEventListener('pointerleave', hide);
    let focusIndex = lastIndex ?? 0;
    hit.addEventListener('focus', () => show(focusIndex));
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      focusIndex = Math.max(0, Math.min(points.length - 1, focusIndex + (e.key === 'ArrowRight' ? 1 : -1)));
      show(focusIndex);
    });

    this.root.replaceChildren(svg, this.tooltip);
    const peak = data.stats.peak;
    this.root.setAttribute('aria-label', `Espectadores ${BUCKET_LABEL[bucketMinutes] || ''}: pico de ${peak}. Usa las flechas para recorrer los valores.`);
  }

  fillTooltip(p, bucketMinutes) {
    const t = this.tooltip;
    t.replaceChildren();
    t.append(html('div', 'tt-time', pointLabel(p.at, bucketMinutes)));
    if (p.viewers == null) {
      t.append(html('div', 'tt-muted', 'Sin datos (servidor apagado)'));
      return;
    }
    const main = html('div', 'tt-value');
    main.append(html('strong', null, num(p.viewers)), document.createTextNode(` ${p.viewers === 1 ? 'espectador' : 'espectadores'} (prom.)`));
    t.append(main);
    t.append(html('div', 'tt-muted', `Pico ${num(p.peak)} · web ${num(p.web)} · TV ${num(p.tv)} · radio ${num(p.radio)}`));
    if (p.program) t.append(html('div', 'tt-program', p.program));
  }
}

export class AudiencePanel {
  constructor() {
    this.range = '24h';
    this.showTable = false;
    this.chart = new AudienceChart($('audienceChart'));
    this.modal = new Modal('audienceModal', {
      openers: ['audienceCard'],
      closers: ['btnCloseAudienceModal', 'btnCloseAudienceModal2'],
      closeOnBackdrop: true,
      onOpen: () => this.loadHistory()
    });
    on('audienceCard', 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.modal.open(); } });
    on('audienceRange', 'click', (e) => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      this.range = btn.dataset.range;
      document.querySelectorAll('#audienceRange [data-range]').forEach(b => b.classList.toggle('active', b === btn));
      this.loadHistory();
    });
    on('btnAudienceTable', 'click', (e) => {
      this.showTable = !this.showTable;
      e.currentTarget.setAttribute('aria-pressed', String(this.showTable));
      e.currentTarget.textContent = this.showTable ? '📈 Ver gráfica' : '▦ Ver como tabla';
      $('audienceChart').hidden = this.showTable;
      $('audienceTableWrap').hidden = !this.showTable;
    });
  }

  /** Gadget: espectadores ahora y resumen de hoy. */
  async refresh() {
    try {
      const { now, today } = await api.get('/api/admin/audience');
      setText('statAudienceNow', num(now.viewers));
      setText('statAudienceSplit', `${num(now.web)} web · ${num(now.tv)} TV/IPTV${now.radio ? ` · 📻 ${num(now.radio)}` : ''}`);
      const peak = today && today.peak ? `Pico de hoy: ${num(today.peak)} a las ${hhmm(new Date(today.peakAt))}` : 'Pico de hoy: –';
      setText('statAudienceToday', `${peak} · ${plural(today ? today.unique : 0, 'único', 'únicos')}`);
      if (this.modal.isOpen) this.paintNow(now);
    } catch (e) {}
  }

  paintNow(now) {
    const tile = $('audienceNowTile');
    if (tile) tile.textContent = num(now.viewers);
  }

  async loadHistory() {
    try {
      const data = await api.get(`/api/admin/audience/history?range=${this.range}`);
      this.renderStats(data);
      setText('audienceChartTitle', `Espectadores (promedio ${BUCKET_LABEL[data.bucketMinutes] || ''})`);
      this.chart.render(data);
      this.renderTable(data);
      this.renderPrograms(data.programs);
    } catch (e) {
      $('audienceChart').textContent = `No se pudo cargar el historial: ${e.message}`;
    }
  }

  renderStats({ now, stats }) {
    const box = $('audienceStats');
    const tile = (label, value, sub, id) => {
      const t = html('div', 'power-part audience-tile');
      t.append(html('span', null, label));
      const v = html('strong', null, value);
      if (id) v.id = id;
      t.append(v);
      if (sub) t.append(html('small', null, sub));
      return t;
    };
    const peakSub = stats.peakAt ? `${DAYS[new Date(stats.peakAt).getDay()]} ${hhmm(new Date(stats.peakAt))}` : 'sin datos aún';
    box.replaceChildren(
      tile('Viendo ahora', num(now.viewers), `${num(now.web)} web · ${num(now.tv)} TV/IPTV`, 'audienceNowTile'),
      tile('Pico', num(stats.peak), peakSub),
      tile('Promedio', num(stats.avg), 'espectadores a la vez'),
      tile('Espectadores únicos', num(stats.unique), plural(stats.sessions, 'visita', 'visitas')),
      tile('Tiempo por visita', `${num(stats.avgMinutes)} min`, 'promedio'),
      tile('Radio', num(stats.radioPeak), `pico · ${plural(stats.radioUnique, 'oyente', 'oyentes')}`)
    );
  }

  renderTable({ points, bucketMinutes }) {
    const body = $('audienceTableBody');
    const rows = points.filter(p => p.viewers != null).slice().reverse().map(p => {
      const tr = document.createElement('tr');
      [pointLabel(p.at, bucketMinutes), num(p.viewers), num(p.peak), num(p.web), num(p.tv), num(p.radio), p.program || '–'].forEach((v, i) => {
        const td = html('td', i >= 1 && i <= 5 ? 'num' : null, v);
        tr.append(td);
      });
      return tr;
    });
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = html('td', 'cell-empty', 'Aún no hay datos en este periodo.');
      td.colSpan = 7;
      tr.append(td);
      rows.push(tr);
    }
    body.replaceChildren(...rows);
  }

  renderPrograms(programs) {
    const box = $('audiencePrograms');
    if (!programs.length) {
      box.replaceChildren(html('p', 'muted', 'Todavía no hay suficientes datos (cada programa necesita al menos 15 minutos con audiencia medida).'));
      return;
    }
    const max = Math.max(...programs.map(p => p.avg), 1);
    box.replaceChildren(...programs.map(p => {
      const row = html('div', 'aud-row');
      row.append(html('span', 'aud-title', p.title));
      const track = html('div', 'aud-track');
      const bar = html('div', 'aud-bar');
      bar.style.width = `${Math.max(2, (p.avg / max) * 100)}%`;
      track.append(bar);
      row.append(track);
      row.append(html('span', 'aud-value', `${num(p.avg)} prom. · pico ${num(p.peak)}`));
      row.title = `${p.title}: ${num(p.avg)} espectadores en promedio, pico de ${num(p.peak)}, ${p.minutes} min medidos`;
      return row;
    }));
  }
}
