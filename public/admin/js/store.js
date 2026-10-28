/**
 * Home Channel Master Control - Estado compartido del panel (Observer).
 *
 * Cada recurso (series, comerciales, vista semanal de la parrilla, programación) vive en
 * el store; al recargarse se avisa a los módulos suscritos para que se repinten.
 */

import { EventBus } from '/shared/EventBus.js';
import { api } from '/shared/api.js';
import { clock12 } from '/shared/format.js';

class Store extends EventBus {
  constructor() {
    super();
    this.state = {
      shows: [],
      commercials: [],
      week: null,
      programming: null,
      episodic: []
    };
  }

  get(key) {
    return this.state[key];
  }

  set(key, value) {
    this.state[key] = value;
    this.emit(key, value);
  }

  findShow(id) {
    return (this.state.shows || []).find(s => s.id === id);
  }

  /** Series con al menos un capítulo listo. */
  readyShows() {
    return (this.state.shows || []).filter(s => (s.episodes || []).length > 0);
  }
}

export const store = new Store();

const ENDPOINTS = {
  shows: '/api/admin/shows',
  commercials: '/api/admin/commercials',
  week: '/api/admin/schedule/week',
  programming: '/api/admin/programming',
  episodic: '/api/admin/shows/episodic-progress'
};

/** Recarga un recurso desde la API y notifica a los suscriptores. */
export async function reload(key) {
  try {
    const data = await api.get(ENDPOINTS[key]);
    if (data && data.success === false) return;
    store.set(key, data);
  } catch (e) {
    console.error(`Error cargando ${key}:`, e);
  }
}

/** Texto para avisar cuándo entra al aire un cambio de parrilla (próximo :00 o :30). */
export function describeResync(resyncAt) {
  if (!resyncAt) return '';
  return `\nLa emisión se actualizará en el próximo bloque (${clock12(resyncAt)}), sin cortar el programa en curso.`;
}
