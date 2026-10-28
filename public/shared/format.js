/**
 * Home Channel HLS - Formatos compartidos por la TV y el panel de control.
 */

const pad2 = (n) => String(n).padStart(2, '0');

export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Segundos → "MM:SS". */
export function formatSec(seconds) {
  const s = Math.round(seconds || 0);
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

/** Fecha → "HH:MM" (hora local). */
export function hhmm(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Fecha o "HH:MM" → hora en formato 12 h: "6:30 PM". */
export function clock12(value) {
  let h;
  let m;
  if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value)) {
    [h, m] = value.split(':').map(Number);
  } else {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '--:--';
    h = d.getHours();
    m = d.getMinutes();
  }
  return `${h % 12 || 12}:${pad2(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "6:30 PM" → HTML con el AM/PM en un <span> aparte (para achicarlo). */
export function clock12Html(text, cls = 'ampm') {
  const m = /^(.*) (AM|PM)$/.exec(String(text));
  return m ? `${escapeHtml(m[1])}<span class="${cls}">${m[2]}</span>` : escapeHtml(text);
}

/** Nombre de archivo → título legible. */
export function cleanTitle(name) {
  if (!name) return '';
  return name.replace(/^Channel_/, 'Episodio ').replace(/_/g, ' ').replace(/\.mp4$/i, '');
}

/** Las 48 franjas de 30 min del día: "00:00" … "23:30". */
export function daySlots() {
  return Array.from({ length: 48 }, (_, i) => `${pad2(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`);
}
