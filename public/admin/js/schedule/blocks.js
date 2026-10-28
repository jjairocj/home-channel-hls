/**
 * Home Channel Master Control - Vista previa de los bloques de emisión de hoy.
 */

import { $, on, withBusy } from '/shared/dom.js';
import { api } from '/shared/api.js';
import { escapeHtml, formatSec } from '/shared/format.js';

const ROLE_ICONS = { main_show: '📺', bumper: '🏷️' };
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function render(blocks) {
  const body = $('adminScheduleBody');
  if (!body) return;
  if (!blocks.length) {
    body.innerHTML = '<tr><td colspan="4" style="text-align:center;">No hay bloques generados</td></tr>';
    return;
  }
  body.innerHTML = blocks.map(b => {
    const items = (b.items || []).map(it => `${ROLE_ICONS[it.role] || '📼'} ${escapeHtml(it.name)}`).join(' &bull; ');
    return `
      <tr>
        <td style="color:var(--yellow);font-weight:700;">${time(b.startTime)} - ${time(b.endTime)}</td>
        <td style="color:var(--cyan);font-weight:700;">${escapeHtml(b.title)}</td>
        <td style="font-size:0.75rem;color:var(--text-muted);">${items || 'Transmisión continua'}</td>
        <td style="color:var(--green);font-family:var(--font-osd);font-size:1.1rem;">${formatSec(b.durationSeconds || b.totalDuration)}</td>
      </tr>`;
  }).join('');
}

export async function refreshScheduleBlocks() {
  try {
    const data = await api.get('/api/schedule');
    render(data.blocks || []);
  } catch (e) {}
}

export function initScheduleBlocks() {
  const regen = $('btnRegenerateNow');
  on(regen, 'click', () => withBusy(regen, 'Regenerando...', async () => {
    try {
      await api.post('/api/schedule/generate');
      await refreshScheduleBlocks();
    } catch (e) {}
  }));
}
