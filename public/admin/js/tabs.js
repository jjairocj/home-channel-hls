/**
 * Home Channel Master Control - Navegación por pestañas.
 */

const listeners = new Map();

/** Ejecuta `handler` cada vez que se abre la pestaña `tabId`. */
export function onTabOpen(tabId, handler) {
  listeners.set(tabId, handler);
}

export function goToTab(tabId) {
  document.querySelector(`.admin-tabs-nav .tab-btn[data-tab="${tabId}"]`)?.click();
}

export function initTabs() {
  const buttons = document.querySelectorAll('.admin-tabs-nav .tab-btn');
  buttons.forEach(btn => btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;
    buttons.forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.toggle('active', c.id === tabId));
    const handler = listeners.get(tabId);
    if (handler) handler();
  }));
}
