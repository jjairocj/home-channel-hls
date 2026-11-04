/**
 * Home Channel HLS Master Control - Consumo eléctrico del servidor (tarjeta y ventana).
 */

import { setText, withBusy, $ } from '/shared/dom.js';
import { escapeHtml } from '/shared/format.js';
import { api } from '/shared/api.js';
import { Modal } from '/shared/modal.js';
import { renderPowerTable } from '/shared/power.js';

const IDS = { modal: 'modal', row: 'row', currency: ' COP' };

export class EnergyPanel {
  constructor() {
    this.latest = null;
    this.modal = new Modal('energyModal', {
      openers: ['energyCard'],
      closers: ['btnCloseEnergyModal', 'btnCloseEnergyModal2'],
      closeOnBackdrop: true,
      onOpen: () => {
        renderPowerTable(this.latest, IDS);
        if (this.latest?.disk) this.renderDiskTable(this.latest.disk);
        this.fetch();
      }
    });
    const refresh = $('btnRefreshEnergy');
    if (refresh) refresh.addEventListener('click', () => withBusy(refresh, '⏳ LEYENDO...', () => this.fetch()));
  }

  update(power) {
    if (!power) return;
    this.latest = power;
    if (power.instant) {
      const now = power.instant;
      setText('statPowerWatts', `${now.totalWatts} W`);
      const splitEl = $('statPowerSplit');
      if (splitEl) {
        splitEl.textContent = `CPU: ${now.cpuWatts}W · GPU: ${now.gpuWatts}W · Base: ${now.baseWatts || 25}W`;
      }
    }
    if (power.today && power.last24h) setText('statPowerKwh', `Hoy: ${power.today.kwh} kWh | 24h: ${power.last24h.kwh} kWh`);
    if (power.disk) {
      const p = power.disk.pool || power.disk.total || power.disk.primary;
      if (p) {
        const freeText = p.freeFormatted || `${Math.round(p.free / 1e9)} GB`;
        setText('statDiskSpace', `💾 POOL: ${freeText} libres (${p.usedPercent}% usado)`);
      }
      if (this.modal.isOpen) this.renderDiskTable(power.disk);
    }
    if (this.modal.isOpen) renderPowerTable(power, IDS);
  }

  renderDiskTable(disk) {
    const tbody = $('modalDiskTableBody');
    if (!tbody || !disk) return;
    const list = disk.disks && disk.disks.length ? disk.disks : (disk.primary ? [disk.primary] : []);
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="cell-empty">No hay información disponible</td></tr>';
      return;
    }

    let rows = list.map(d => {
      const isPool = d.id === 'pool';
      const isPrimary = d.id === 'primary';
      const level = d.usedPercent > 90 ? 'disk-full' : (d.usedPercent > 75 ? 'disk-warn' : 'disk-ok');

      return `
        <tr class="disk-row${isPool ? ' pool' : ''}">
          <td class="${isPool || isPrimary ? 'disk-name' : ''}">
            ${isPool ? '🌟 ' : (d.id === 'ssd' ? '⚡ ' : '💾 ')}${escapeHtml(d.label || d.id)}
          </td>
          <td class="num">${escapeHtml(d.description || '--')}</td>
          <td class="num">${escapeHtml(d.totalFormatted || '--')}</td>
          <td class="num ${level}">${escapeHtml(d.freeFormatted || '--')}</td>
          <td class="num ${level}">${escapeHtml(d.usedPercent)}%</td>
        </tr>
      `;
    }).join('');

    if (disk.total && list.length > 1) {
      const t = disk.total;
      rows += `
        <tr>
          <td class="total-row disk-name" colspan="2">Capacidad total del servidor (${list.length} discos)</td>
          <td class="total-row num disk-name">${escapeHtml(t.totalFormatted || '--')}</td>
          <td class="total-row num disk-ok">${escapeHtml(t.freeFormatted || '--')}</td>
          <td class="total-row num disk-ok">${escapeHtml(t.usedPercent)}%</td>
        </tr>
      `;
    }

    tbody.innerHTML = rows;
  }

  async fetch() {
    try {
      const data = await api.get('/api/system/power');
      if (data.success === false) return;
      this.update(data);
      renderPowerTable(data, IDS);
      if (data.disk) this.renderDiskTable(data.disk);
    } catch (e) {
      console.error('Error al obtener telemetría de energía y almacenamiento:', e);
    }
  }
}
