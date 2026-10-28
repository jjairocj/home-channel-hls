/**
 * Home Channel HLS - Bus de eventos mínimo (Observer) para desacoplar módulos de la página.
 */

export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.listeners.get(event).delete(handler);
  }

  emit(event, payload) {
    for (const handler of this.listeners.get(event) || []) {
      try {
        handler(payload);
      } catch (e) {
        console.error(`[EventBus] Error en "${event}":`, e);
      }
    }
  }
}
