/**
 * Home Channel HLS - Atajos de DOM compartidos.
 */

export const $ = (id) => document.getElementById(id);

/** addEventListener tolerante a elementos que no existen en la página. */
export function on(id, event, handler) {
  const el = typeof id === 'string' ? $(id) : id;
  if (el) el.addEventListener(event, handler);
  return el;
}

/** Vincula varios ids al mismo evento: { idBoton: handler }. */
export function bindAll(map, event = 'click') {
  for (const [id, handler] of Object.entries(map)) on(id, event, handler);
}

export function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

/**
 * Deja un botón en estado "ocupado" mientras corre `task` y lo restaura al final.
 * @returns el resultado de task
 */
export async function withBusy(btn, busyText, task) {
  if (!btn) return task();
  const idle = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyText;
  try {
    return await task();
  } finally {
    btn.disabled = false;
    btn.textContent = idle;
  }
}

/**
 * Delegación de eventos: un solo listener en `root` para todos los elementos con
 * data-action. handlers = { accion: (el, event) => … }.
 */
export function delegate(root, event, handlers) {
  if (!root) return;
  root.addEventListener(event, (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const handler = handlers[el.dataset.action];
    if (handler) handler(el, e);
  });
}
