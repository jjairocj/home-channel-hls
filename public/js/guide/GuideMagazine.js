/**
 * Home Channel HLS - Revista "TeleGuía" con la programación por día y franja.
 */

import { $ } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { escapeHtml, clock12Html } from '../../shared/format.js';
import { MAG_SECTIONS, getBlockBadge, normalizeBlocks, mergeOffAir, pickFeature } from './blocks.js';
import { animateGuide } from './animations.js';

const DAY_NAMES = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const WEEKDAYS = {
  monday: 'LUNES', tuesday: 'MARTES', wednesday: 'MIÉRCOLES', thursday: 'JUEVES',
  friday: 'VIERNES', saturday: 'SÁBADO', sunday: 'DOMINGO'
};

const blocksOf = (data) => (Array.isArray(data) ? data : (data.blocks || []));

export class GuideMagazine {
  constructor() {
    this.day = 'today';
    this.filter = 'all';
    this.todayBlocks = [];
    this.lastSchedule = [];
    // Animación del próximo render: 'intro' (carga), 'flip' (día), 'shuffle' (franja)
    this.pendingAnim = 'intro';
  }

  init() {
    this.bindButtons('tgDaySelector', '.tg-day-btn', (btn) => {
      this.day = btn.dataset.day || 'today';
      this.pendingAnim = 'flip';
      this.load(this.day);
    });
    this.bindButtons('tgMagNav', '.tg-filter-btn', (btn) => {
      this.filter = btn.dataset.filter || 'all';
      this.pendingAnim = 'shuffle';
      if (this.lastSchedule.length) this.render(this.lastSchedule, this.day);
    });
    this.load('today');
  }

  /** Grupo de botones excluyentes con delegación de eventos. */
  bindButtons(containerId, selector, onSelect) {
    const container = $(containerId);
    if (!container) return;
    container.addEventListener('click', (e) => {
      const btn = e.target.closest(selector);
      if (!btn) return;
      container.querySelectorAll(selector).forEach(b => b.classList.toggle('active', b === btn));
      onSelect(btn);
    });
  }

  /** Programación de hoy (para la cartelera del TV); se descarga si aún no está. */
  async getTodayBlocks() {
    if (!this.todayBlocks.length) this.todayBlocks = blocksOf(await api.get('/api/schedule'));
    return this.todayBlocks;
  }

  /** Cambió el programa al aire o pasaron 5 min: refrescar sin animación de portada. */
  refreshToday() {
    if (this.day !== 'today') {
      api.get('/api/schedule').then(d => { this.todayBlocks = blocksOf(d); }).catch(() => {});
      return;
    }
    this.pendingAnim = null;
    this.load('today');
  }

  async load(day = this.day) {
    try {
      const data = await api.get(`/api/schedule${day && day !== 'today' ? `?day=${day}` : ''}`);
      this.render(blocksOf(data), data.day || day);
    } catch (err) {
      console.error('Error al cargar parrilla:', err);
      const grid = $('tgGuideGrid');
      if (grid) grid.innerHTML = '<div class="tg-empty">Sintonizando frecuencia satelital...</div>';
    }
  }

  paintDate(day) {
    const el = $('tgMagDate');
    if (!el) return;
    if (day === 'today') {
      const d = new Date();
      el.textContent = `HOY · ${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
    } else {
      el.textContent = `EDICIÓN ${WEEKDAYS[day] || day.toUpperCase()}`;
    }
  }

  render(schedule, day = 'today') {
    this.lastSchedule = schedule || [];
    if (day === 'today' && Array.isArray(schedule)) this.todayBlocks = schedule;
    const grid = $('tgGuideGrid');
    const feature = $('tgFeature');
    if (!grid) return;
    this.paintDate(day);

    if (!schedule || !schedule.length) {
      grid.innerHTML = '<div class="tg-empty">No hay programación registrada para este día.</div>';
      if (feature) feature.hidden = true;
      return;
    }

    const blocks = normalizeBlocks(schedule, day === 'today');
    const filtered = this.filter === 'all' ? blocks : blocks.filter(b => b.section === this.filter);
    grid.innerHTML = filtered.length
      ? this.listingsHtml(mergeOffAir(filtered))
      : '<div class="tg-empty">No hay emisiones programadas en esta franja horaria.</div>';

    this.renderFeature(blocks, day === 'today');
    animateGuide(this.pendingAnim);
    this.pendingAnim = null;
  }

  listingsHtml(entries) {
    let lastSection = null;
    return entries.map(b => {
      let head = '';
      if (b.section !== lastSection) {
        lastSection = b.section;
        const sec = MAG_SECTIONS[b.section];
        head = `<h3 class="tg-section-head s-${b.section}">${sec.label} <small>${sec.range}</small></h3>`;
      }
      const badge = getBlockBadge(b.block);
      const genre = b.offAir ? 'Cierre' : (b.block.category || badge.text);
      const title = b.offAir ? 'Cierre de emisión' : (b.block.title || 'Emisión especial');
      const meta = b.offAir
        ? `Carta de ajuste y señal de descanso hasta las <span class="tg-nowrap">${escapeHtml(b.end)}</span>.`
        : `${Math.round(b.durationSeconds / 60)} min · hasta las <span class="tg-nowrap">${escapeHtml(b.end)}</span>${b.block.isRepeat ? ' · Repetición' : ''}`;

      return `${head}
        <article class="tg-listing ${b.isCurrent ? 'is-on-air' : ''} ${b.offAir ? 'is-off-air' : ''}">
          <div class="tg-l-time">${clock12Html(b.start, 'tg-ampm')}</div>
          <div class="tg-l-body">
            <h4 class="tg-show-title">${escapeHtml(title)}</h4>
            <p class="tg-l-meta"><span class="tg-genre ${badge.class}">${escapeHtml(genre)}</span>${meta}</p>
          </div>
          ${b.isCurrent ? '<span class="tg-starburst tg-now-burst" aria-label="Al aire ahora">¡AHORA!</span>' : ''}
        </article>`;
    }).join('');
  }

  renderFeature(blocks, isToday) {
    const feature = $('tgFeature');
    if (!feature) return;
    const pick = pickFeature(blocks, isToday);
    if (!pick) {
      feature.hidden = true;
      return;
    }
    const { current, next, kicker, burst } = pick;
    feature.innerHTML = `
      <div class="tg-feature-time">${clock12Html(current.start, 'tg-ampm')}<small>a ${escapeHtml(current.end)}</small></div>
      <div>
        <div class="tg-feature-kicker">${kicker}</div>
        <div class="tg-feature-title">${escapeHtml(current.block.title || 'Emisión especial')}</div>
        ${next ? `<div class="tg-feature-next">Después, a las ${escapeHtml(next.start)}: ${escapeHtml(next.block.title)}</div>` : ''}
      </div>
      <span class="tg-starburst tg-feature-burst" aria-hidden="true">${burst}</span>`;
    feature.hidden = false;
  }
}
