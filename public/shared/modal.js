/**
 * Home Channel HLS - Ventanas modales.
 *
 * Dos estilos conviven en las páginas: clase .active (la mayoría) y display:flex
 * (modales de la grilla). `display: true` elige el segundo.
 */

import { $, on } from './dom.js';

export class Modal {
  /**
   * @param {string} id
   * @param {Object} [opts]
   * @param {string[]} [opts.openers] - ids de botones que lo abren
   * @param {string[]} [opts.closers] - ids de botones que lo cierran
   * @param {Function} [opts.onOpen]
   * @param {boolean} [opts.display] - usar style.display en vez de .active
   * @param {boolean} [opts.closeOnBackdrop]
   */
  constructor(id, { openers = [], closers = [], onOpen = null, display = false, closeOnBackdrop = false } = {}) {
    this.el = $(id);
    this.display = display;
    this.onOpen = onOpen;
    openers.forEach(b => on(b, 'click', () => this.open()));
    closers.forEach(b => on(b, 'click', () => this.close()));
    if (closeOnBackdrop && this.el) {
      this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    }
  }

  get isOpen() {
    if (!this.el) return false;
    return this.display ? this.el.style.display === 'flex' : this.el.classList.contains('active');
  }

  async open() {
    if (!this.el) return;
    if (this.display) this.el.style.display = 'flex';
    else this.el.classList.add('active');
    if (this.onOpen) await this.onOpen();
  }

  close() {
    if (!this.el) return;
    if (this.display) this.el.style.display = 'none';
    else this.el.classList.remove('active');
  }
}
