/**
 * Home Channel HLS - Estado de la emisión (/api/status) cada 2 s, publicado en el bus:
 *   'status'          cada lectura
 *   'programChanged'  cambió el programa al aire ({ title, isFirst })
 *   'offline'         no se pudo leer el estado
 */

import { api } from '../shared/api.js';

const POLL_MS = 2000;

export class StatusFeed {
  constructor(bus) {
    this.bus = bus;
    this.current = null;
    this.lastProgram = null;
    this.inFlight = false;
  }

  start() {
    this.poll();
    setInterval(() => {
      if (!document.hidden) this.poll();
    }, POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.poll();
    });
  }

  async poll() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const status = await api.get('/api/status');
      this.current = status;
      this.bus.emit('status', status);
      const title = status.currentProgram && status.currentProgram.showTitle;
      if (title && title !== this.lastProgram) {
        const isFirst = this.lastProgram === null;
        this.lastProgram = title;
        this.bus.emit('programChanged', { title, isFirst });
      }
    } catch (e) {
      this.bus.emit('offline');
    } finally {
      this.inFlight = false;
    }
  }
}
