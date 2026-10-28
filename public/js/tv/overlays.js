/**
 * Home Channel HLS - Cartelera de horarios dentro del tubo: durante el relleno sincronizador
 * antes del próximo bloque (o con el botón GUÍA). Si el video ya trae la cartelera
 * quemada (clips "dyn_board_…"), no se dibuja encima.
 *
 * "A continuación" ya no se dibuja en la web: la señal lo trae quemado (cortinilla,
 * recuadro de la tanda y cuadro del capítulo), igual que en Smart TV e IPTV.
 */

import { $ } from '../../shared/dom.js';
import { cleanTitle, escapeHtml, clock12 } from '../../shared/format.js';

const BILLBOARD_MAX_MS = 15000;
const BILLBOARD_MANUAL_SECONDS = 14;
const SYNC_ROLES = ['filler_pad', 'sync_pad'];

/** Cartelera quemada en el video (dyn_board_…). */
const isBurnedBillboard = (track) => String(track.id || '').startsWith('dyn_board_');

export class CrtOverlays {
  /** @param {Function} getTodayBlocks - async () => bloques de hoy */
  constructor(getTodayBlocks) {
    this.getTodayBlocks = getTodayBlocks;
    this.billboardTimer = null;
  }

  update(status) {
    const billboard = $('crtScheduleBillboard');
    if (!billboard) return;
    if (!status || !status.isRunning) {
      billboard.classList.remove('show');
      return;
    }
    const track = status.currentTrack;
    if (!track) return;

    if (isBurnedBillboard(track)) {
      // La cartelera ya va en el video (y no se repite en el resto del relleno)
      billboard.classList.remove('show');
      clearTimeout(this.billboardTimer);
      this.lastBillboardBlock = track.blockTitle || '';
    } else if (SYNC_ROLES.includes(track.role) && track.duration >= 8 && !billboard.classList.contains('show') && !this.billboardShownFor(track)) {
      this.showBillboard(track.duration);
    } else if (track.role === 'main_show') {
      billboard.classList.remove('show');
      this.lastBillboardBlock = null;
    }
  }

  /**
   * La cartelera web sale una vez por relleno: si en el mismo bloque ya pasó la quemada
   * (o la web ya la mostró), los bumpers que siguen no la vuelven a abrir.
   */
  billboardShownFor(track) {
    const block = track.blockTitle || '';
    if (this.lastBillboardBlock === block) return true;
    this.lastBillboardBlock = block;
    return false;
  }

  showBillboard(durationSeconds = 12) {
    const billboard = $('crtScheduleBillboard');
    if (!billboard) return;
    this.renderBillboard();
    billboard.classList.add('show');
    clearTimeout(this.billboardTimer);
    this.billboardTimer = setTimeout(() => billboard.classList.remove('show'), Math.min(BILLBOARD_MAX_MS, durationSeconds * 1000));
  }

  toggleBillboard() {
    const billboard = $('crtScheduleBillboard');
    if (!billboard) return;
    if (billboard.classList.contains('show')) {
      billboard.classList.remove('show');
      clearTimeout(this.billboardTimer);
    } else {
      this.showBillboard(BILLBOARD_MANUAL_SECONDS);
    }
  }

  async renderBillboard() {
    const list = $('crtBillboardItems');
    if (!list) return;
    try {
      const blocks = await this.getTodayBlocks();
      if (!blocks.length) {
        list.innerHTML = '<div class="billboard-item"><span class="billboard-show">Sincronizando satélite...</span></div>';
        return;
      }
      const now = Date.now();
      const start = Math.max(0, blocks.findIndex(b => now < new Date(b.endTime).getTime()));
      list.innerHTML = blocks.slice(start, start + 4).map((b, i) => {
        const isCurrent = i === 0 && now >= new Date(b.startTime).getTime();
        const isNext = (i === 1 && isCurrent) || (i === 0 && !isCurrent);
        const time = clock12(b.startTime);
        const badge = isCurrent ? 'AL AIRE' : (isNext ? 'A CONTINUACIÓN' : 'PRÓXIMO');
        const show = b.isOffAir ? '🌙 Cierre de Emisión (OFF)' : (b.mainShow ? cleanTitle(b.mainShow.name) : b.title);
        return `
          <div class="billboard-item ${isCurrent ? 'is-current' : ''} ${isNext ? 'is-next' : ''} ${b.isOffAir ? 'is-off-air' : ''}">
            <span class="billboard-time">${time}</span>
            <div class="billboard-info">
              <span class="billboard-show">${escapeHtml(show)}</span>
              <span class="billboard-badge">${badge}</span>
            </div>
          </div>`;
      }).join('');
    } catch (e) {
      console.error('Error renderizando cartelera CRT:', e);
    }
  }
}
