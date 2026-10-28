/**
 * Home Channel Master Control - Programación automática asistida: preferencias por
 * serie, agrupación de temporadas y propuestas. La propuesta es un juego de reglas
 * sugeridas; al aceptarla reemplaza solo las sugeridas, nunca las del administrador.
 */

import { $, on, delegate, withBusy } from '/shared/dom.js';
import { api } from '/shared/api.js';
import { Modal } from '/shared/modal.js';
import { escapeHtml, hhmm } from '/shared/format.js';
import { store, reload, describeResync } from './store.js';
import { refreshScheduleBlocks } from './schedule/blocks.js';
import { WeekCalendar } from './programmer/WeekCalendar.js';

const plural = (n, word, many = `${word}es`) => `${n} ${n === 1 ? word : many}`;

/**
 * "1 estreno + 2 repeticiones al día", "1 estreno semanal + 1 repetición" o
 * "2 capítulos al azar por semana" (episódicas).
 */
function airingsLabel({ slotsPerWeek, daysPerWeek, episodic, frequency, marathonSlots }) {
  const marathon = marathonSlots ? ` · maratón de ${marathonSlots}` : '';
  return baseAirings({ slotsPerWeek, daysPerWeek, episodic, frequency }) + marathon;
}

function baseAirings({ slotsPerWeek, daysPerWeek, episodic, frequency }) {
  if (!daysPerWeek) return '—';
  if (frequency === 'weekly') {
    if (episodic) return `${plural(slotsPerWeek, 'capítulo', 'capítulos')} al azar por semana`;
    const repeats = slotsPerWeek - 1;
    return `1 estreno semanal${repeats > 0 ? ` + ${plural(repeats, 'repetición', 'repeticiones')}` : ''}`;
  }
  const perDay = Math.round(slotsPerWeek / daysPerWeek);
  const days = daysPerWeek === 7 ? 'todos los días' : `${daysPerWeek} días/sem`;
  if (episodic) return `${plural(perDay, 'capítulo', 'capítulos')} al azar · ${days}`;
  const repeats = perDay - 1;
  return `1 estreno${repeats > 0 ? ` + ${plural(repeats, 'repetición', 'repeticiones')}` : ''} · ${days}`;
}

const ORDER_LABELS = {
  sequential: 'En orden (capítulo del día)',
  random: 'Al azar (episódica)'
};

const FREQUENCY_LABELS = {
  daily: 'Diaria (tira)',
  weekly: 'Semanal'
};

const FRANJA_LABELS = {
  auto: 'Automática',
  manana: 'Mañana (06–12)',
  tarde: 'Tarde (12–18)',
  prime: 'Prime Time (18–23)',
  noche: 'Noche (23–00)',
  madrugada: 'Madrugada (00–01 / 05–06)',
  excluir: '⛔ Excluir de la grilla'
};

/* ---------- Orden y filtros de la tabla de series ---------- */

const STATUS_RANK = { grid: 0, unscheduled: 1, waiting: 2 };
const statusOf = (s) => (!s.eligible ? 'waiting' : (s.slotsPerWeek ? 'grid' : 'unscheduled'));
const franjaOf = (s) => (s.franjaChoice && s.franjaChoice !== 'auto' ? s.franjaChoice : s.suggested);
const SORT_VALUES = {
  label: (s) => s.label,
  current: (s) => s.current || '',
  franja: (s) => FRANJA_LABELS[franjaOf(s)] || '',
  remaining: (s) => (s.episodic ? Infinity : s.remaining || 0),
  slots: (s) => s.slotsPerWeek || 0,
  status: (s) => STATUS_RANK[statusOf(s)]
};
const sortState = { key: 'label', dir: 1 };

function compareSagas(a, b) {
  const va = SORT_VALUES[sortState.key](a);
  const vb = SORT_VALUES[sortState.key](b);
  const cmp = typeof va === 'string' ? va.localeCompare(vb, 'es', { sensitivity: 'base' }) : va - vb;
  return (cmp || a.label.localeCompare(b.label, 'es')) * sortState.dir;
}

function visibleSagas(sagas) {
  const q = ($('progSearch')?.value || '').trim().toLowerCase();
  const status = $('progStatusFilter')?.value || '';
  const franja = $('progFranjaFilter')?.value || '';
  return sagas.filter(s => (!q || `${s.label} ${s.current || ''} ${s.members.map(m => m.title).join(' ')}`.toLowerCase().includes(q))
    && (!status || statusOf(s) === status)
    && (!franja || franjaOf(s) === franja));
}

function renderSagaTable() {
  const ov = store.get('programming');
  const body = $('programmingBody');
  if (!ov || !body) return;
  const list = visibleSagas(ov.sagas).sort(compareSagas);
  body.innerHTML = list.length
    ? list.map(sagaRowHtml).join('')
    : '<tr><td colspan="10" class="cell-empty">Ninguna serie coincide con el filtro.</td></tr>';
  const count = $('progCount');
  if (count) count.textContent = list.length === ov.sagas.length ? `${list.length} series` : `${list.length} de ${ov.sagas.length} series`;
  document.querySelectorAll('#programmingTable th[data-sort]').forEach(th => {
    const active = th.dataset.sort === sortState.key;
    th.setAttribute('aria-sort', active ? (sortState.dir > 0 ? 'ascending' : 'descending') : 'none');
  });
}

function initSagaTable() {
  const franja = $('progFranjaFilter');
  if (franja) {
    franja.innerHTML += Object.entries(FRANJA_LABELS).filter(([k]) => k !== 'auto')
      .map(([k, label]) => `<option value="${k}">${escapeHtml(label)}</option>`).join('');
  }
  on('progSearch', 'input', renderSagaTable);
  on('progStatusFilter', 'change', renderSagaTable);
  on('progFranjaFilter', 'change', renderSagaTable);
  document.querySelectorAll('#programmingTable th[data-sort]').forEach(th => {
    th.tabIndex = 0;
    const sort = () => {
      if (sortState.key === th.dataset.sort) sortState.dir *= -1;
      else Object.assign(sortState, { key: th.dataset.sort, dir: 1 });
      renderSagaTable();
    };
    th.addEventListener('click', sort);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
  });
}

let proposal = null;
let proposalModal = null;
let proposalCalendar = null;
let groupsModal = null;

/* ---------- Resumen por serie ---------- */

function sagaRowHtml(s) {
  const key = escapeHtml(s.key);
  const members = s.members.length > 1
    ? `<div class="prog-members">${s.members.map(m => escapeHtml(m.title.replace(/^.*?temporada/i, 'T'))).join(' → ')}</div>`
    : '';
  const franjas = Object.entries(FRANJA_LABELS).map(([k, label]) => {
    const text = k === 'auto' ? `Automática (${FRANJA_LABELS[s.suggested] || s.suggested})` : label;
    return `<option value="${k}" ${k === s.franjaChoice ? 'selected' : ''}>${escapeHtml(text)}</option>`;
  }).join('');
  const autoOrder = s.episodic && s.orderChoice === 'auto' ? 'al azar' : 'en orden';
  const orders = [['auto', `Automático · ${autoOrder}`], ...Object.entries(ORDER_LABELS)]
    .map(([k, label]) => `<option value="${k}" ${k === (s.orderChoice || 'auto') ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const autoFrequency = s.frequency === 'weekly' && s.frequencyChoice === 'auto' ? 'semanal' : 'diaria';
  const frequencies = [['auto', `Automática · ${autoFrequency}`], ...Object.entries(FREQUENCY_LABELS)]
    .map(([k, label]) => `<option value="${k}" ${k === (s.frequencyChoice || 'auto') ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const maxDaily = [['', `Auto (${s.maxDaily})`], ...[1, 2, 3, 4, 5, 6].map(n => [String(n), String(n)])]
    .map(([v, label]) => `<option value="${v}" ${v === (s.maxDailyChoice == null ? '' : String(s.maxDailyChoice)) ? 'selected' : ''}>${label}</option>`).join('');
  const marathon = s.episodic || s.frequency === 'weekly'
    ? '<span class="prog-members">—</span>'
    : `<label class="prog-toggle"><input type="checkbox" data-action="marathon" data-key="${key}" ${s.marathonChoice ? 'checked' : ''}> fin de semana</label>`;
  const proposed = s.proposedSlotsPerWeek !== s.slotsPerWeek ? ` <span class="prog-members">(propuesta: ${s.proposedSlotsPerWeek})</span>` : '';
  const airingInfo = s.daysPerWeek || s.marathonSlots ? escapeHtml(airingsLabel(s)) : '';
  const weeks = airingInfo ? `<div class="prog-members">${airingInfo}${s.weeksLeft ? ` · ≈ ${s.weeksLeft} semanas` : ''}</div>` : '';
  const status = s.eligible ? (s.slotsPerWeek ? '✔ En la parrilla' : '★ Lista, sin horario') : escapeHtml(s.reason);
  let remainingHtml = s.remaining;
  if (s.episodic) {
    if (s.episodicProgress) {
      remainingHtml = `
        <div style="font-size: 11px;">
          <div>🎲 <strong>${s.episodicProgress.seenCount}/${s.episodicProgress.totalEpisodes}</strong> <span class="prog-members">(C${s.episodicProgress.cycle})</span></div>
          <button class="btn-micro" data-action="reset-episodic" data-key="saga:${key}" style="font-size: 9px; padding: 1px 4px; margin-top: 3px;" title="Reiniciar ciclo de emisión aleatoria">🔄 Reiniciar</button>
        </div>`;
    } else {
      remainingHtml = '∞';
    }
  }
  return `
    <tr>
      <td><strong>${escapeHtml(s.label)}</strong>${members}</td>
      <td>${escapeHtml(s.current || '—')}</td>
      <td><select class="admin-input prog-franja" data-action="franja" data-key="${key}">${franjas}</select></td>
      <td><select class="admin-input prog-order" data-action="order" data-key="${key}">${orders}</select></td>
      <td><select class="admin-input prog-frequency" data-action="frequency" data-key="${key}">${frequencies}</select></td>
      <td><select class="admin-input prog-max" data-action="maxDaily" data-key="${key}">${maxDaily}</select></td>
      <td>${marathon}</td>
      <td>${remainingHtml}</td>
      <td>${s.slotsPerWeek}/sem${proposed}${weeks}</td>
      <td class="${s.eligible ? 'prog-ok' : 'prog-wait'}">${status}</td>
    </tr>`;
}

function renderOverview(ov) {
  if (!ov) return;
  const banner = $('programmingBanner');
  const ready = ov.sagas.filter(s => s.eligible).length;
  const unscheduled = ov.sagas.filter(s => s.eligible && !s.slotsPerWeek).length;
  if (banner) {
    if (ov.pending) {
      banner.innerHTML = `📋 <strong>Hay una propuesta pendiente</strong> (${hhmm(ov.pending.createdAt)} · ${escapeHtml(ov.pending.reason || '')}): ${ov.pending.changes} horarios cambian. Revísala con «👁 Ver propuesta».`;
    } else {
      banner.textContent = `Sin propuestas pendientes · ${ready} series listas${unscheduled ? ` · ⚠️ ${unscheduled} listas sin horario en la parrilla actual` : ''}.`;
    }
    banner.classList.toggle('has-pending', !!ov.pending);
  }
  if ($('btnReviewProposal')) $('btnReviewProposal').hidden = !ov.pending;
  document.querySelector('.tab-btn[data-tab="tabScheduler"]')?.classList.toggle('has-pending', !!ov.pending);

  renderSagaTable();
}

/**
 * Guarda una preferencia de la serie. Orden, frecuencia, máximo y maratón cambian qué
 * capítulos salen; la franja solo afecta a la próxima propuesta.
 */
async function saveSagaOption(el, field, value, label) {
  try {
    const data = await api.put(`/api/admin/programming/sagas/${encodeURIComponent(el.dataset.key)}`, { [field]: value });
    if (data.success === false) throw new Error(data.error);
    await reload('programming');
    await reload('week');
    if (label) alert(`${label} guardada. Genera una propuesta (⚡) para reacomodar la parrilla.${describeResync(data.resyncAt)}`);
  } catch (e) {
    alert(`No se pudo guardar: ${e.message}`);
    reload('programming');
  }
}

/* ---------- Propuesta ---------- */

function renderProposal(p) {
  const created = new Date(p.createdAt);
  $('proposalMeta').innerHTML = `Propuesta del ${created.toLocaleDateString()} ${hhmm(created)} · ${escapeHtml(p.reason || '')} · <strong>${p.changes.length} horarios cambian</strong> respecto a la parrilla actual.`;
  $('proposalWarnings').innerHTML = (p.warnings || []).map(w => `<li>⚠️ ${escapeHtml(w)}</li>`).join('');
  $('proposalSagasBody').innerHTML = (p.sagas || [])
    .filter(s => s.slotsPerWeek > 0)
    .sort((a, b) => b.slotsPerWeek - a.slotsPerWeek)
    .map(s => `
      <tr>
        <td><strong>${escapeHtml(s.label)}</strong></td>
        <td>${escapeHtml(s.current || '—')}</td>
        <td>${escapeHtml(airingsLabel(s))}</td>
        <td>${s.weeksLeft ? `≈ ${s.weeksLeft} semanas` : '—'}</td>
      </tr>`).join('');

  const changed = new Set(p.changes.map(c => `${c.day}|${c.time}`));
  proposalCalendar.render({ times: (store.get('week') || {}).times || [], cells: p.cells }, { highlight: changed });
}

async function openProposal() {
  try {
    proposal = await api.get('/api/admin/programming/proposal');
  } catch (e) {
    proposal = null;
  }
  if (!proposal || proposal.status !== 'pending') return alert('No hay una propuesta pendiente.');
  if (!store.get('week')) await reload('week');
  renderProposal(proposal);
  proposalModal.open();
}

async function generateProposal() {
  try {
    const data = await api.post('/api/admin/programming/propose');
    if (data.success === false) throw new Error(data.error);
    await reload('programming');
    await openProposal();
  } catch (e) {
    alert('No se pudo generar la propuesta: ' + e.message);
  }
}

async function acceptProposal() {
  if (!proposal) return;
  if (!confirm(`¿Aplicar la propuesta (${proposal.changes.length} horarios cambian)?\nReemplaza solo las reglas sugeridas; las tuyas se mantienen. La emisión se actualizará en el próximo bloque.`)) return;
  try {
    const data = await api.post('/api/admin/programming/accept', { id: proposal.id });
    if (!data.success) throw new Error(data.error || 'Error');
    proposalModal.close();
    await reload('week');
    await reload('programming');
    await refreshScheduleBlocks();
    alert(`✔ Parrilla aplicada.${describeResync(data.resyncAt)}`);
  } catch (e) {
    alert('No se pudo aplicar la propuesta: ' + e.message);
  }
}

async function discardProposal() {
  if (!confirm('¿Descartar esta propuesta? La parrilla actual queda igual.')) return;
  try {
    await api.post('/api/admin/programming/discard');
    proposalModal.close();
    await reload('programming');
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

/* ---------- Agrupar temporadas ---------- */

function groupRowHtml(sh, groups) {
  const autoText = sh.autoGroupLabel ? `Automático (grupo "${sh.autoGroupLabel}")` : 'Automático (independiente)';
  const selected = sh.mode === 'none' ? 'none' : (sh.mode === 'manual' ? sh.groupKey : 'auto');
  const groupOpts = groups.map(g => `<option value="${escapeHtml(g.key)}" ${selected === g.key ? 'selected' : ''}>Grupo: ${escapeHtml(g.label)}</option>`).join('');
  return `
    <tr>
      <td><strong>${escapeHtml(sh.title)}</strong><div class="prog-members">${sh.episodes} cap.${sh.groupLabel ? ` · en "${escapeHtml(sh.groupLabel)}" (#${sh.position})` : ''}</div></td>
      <td>
        <select class="admin-input group-select" data-action="group" data-id="${escapeHtml(sh.id)}">
          <option value="auto" ${selected === 'auto' ? 'selected' : ''}>${escapeHtml(autoText)}</option>
          <option value="none" ${selected === 'none' ? 'selected' : ''}>Independiente</option>
          ${groupOpts}
          <option value="__new__">+ Nuevo grupo…</option>
        </select>
      </td>
      <td><input type="number" min="1" class="admin-input group-order" data-action="order" data-id="${escapeHtml(sh.id)}" value="${sh.order ?? ''}" placeholder="${sh.position}" style="width: 70px;"></td>
    </tr>`;
}

let groupsData = null;

function renderGroups(data) {
  groupsData = data;
  $('groupsBody').innerHTML = data.shows.map(sh => groupRowHtml(sh, data.groups)).join('');
}

async function saveGroup(id, payload) {
  const out = await api.put(`/api/admin/programming/shows/${encodeURIComponent(id)}/group`, payload);
  if (!out.success) throw new Error(out.error || 'Error');
  renderGroups(out);
  await reload('programming');
  await reload('week');
}

const groupActions = {
  group: async (sel) => {
    try {
      if (sel.value !== '__new__') return await saveGroup(sel.dataset.id, { group: sel.value });
      const label = prompt('Nombre del nuevo grupo (ej. "Saga Dragon Ball"):');
      if (!label) return renderGroups(groupsData);
      await saveGroup(sel.dataset.id, { newGroupLabel: label });
    } catch (e) {
      alert('No se pudo guardar: ' + e.message);
    }
  },
  order: async (input) => {
    try {
      await saveGroup(input.dataset.id, { order: input.value === '' ? null : parseInt(input.value, 10) });
    } catch (e) {
      alert('No se pudo guardar el orden: ' + e.message);
    }
  }
};

async function openGroups() {
  try {
    renderGroups(await api.get('/api/admin/programming/groups'));
    groupsModal.open();
  } catch (e) {
    alert('No se pudo cargar la agrupación: ' + e.message);
  }
}

export function initProgramming() {
  proposalModal = new Modal('proposalModal', { closers: ['btnCloseProposalModal'] });
  proposalCalendar = new WeekCalendar($('proposalCalendar'), { readOnly: true });
  groupsModal = new Modal('groupsModal', { closers: ['btnCloseGroupsModal', 'btnCancelGroups'] });
  initSagaTable();

  const generate = $('btnGenerateProposal');
  on(generate, 'click', () => withBusy(generate, '⏳ CALCULANDO...', generateProposal));
  on('btnReviewProposal', 'click', openProposal);
  on('btnOpenGroupsModal', 'click', openGroups);
  on('btnAcceptProposal', 'click', acceptProposal);
  on('btnDiscardProposal', 'click', discardProposal);
  delegate($('programmingBody'), 'change', {
    franja: (sel) => saveSagaOption(sel, 'franja', sel.value),
    order: (sel) => saveSagaOption(sel, 'order', sel.value, 'Preferencia de orden'),
    frequency: (sel) => saveSagaOption(sel, 'frequency', sel.value, 'Frecuencia'),
    maxDaily: (sel) => saveSagaOption(sel, 'maxDaily', sel.value === '' ? null : parseInt(sel.value, 10)),
    marathon: (box) => saveSagaOption(box, 'marathon', box.checked)
  });
  delegate($('programmingBody'), 'click', {
    'reset-episodic': async (btn) => {
      const key = btn.dataset.key;
      if (!confirm(`¿Reiniciar el ciclo de emisión aleatoria para ${key}?\n\nComenzará de nuevo con todos los capítulos en una nueva mezcla aleatoria sin repeticiones.`)) return;
      try {
        await api.post(`/api/admin/shows/episodic-progress/${encodeURIComponent(key)}/reset`);
        await reload('programming');
        await reload('shows');
        await reload('episodic');
      } catch (e) {
        alert('Error al reiniciar ciclo: ' + e.message);
      }
    }
  });
  delegate($('groupsBody'), 'change', groupActions);
  store.on('programming', renderOverview);
}
