/**
 * CrHe X-99 - Consumo eléctrico del servidor (W y kWh) en la TV y en el panel.
 * Ambas páginas usan los mismos nombres de id con distinto prefijo.
 */

import { setText } from './dom.js';

const COP_PER_KWH = 850;
const PERIODS = [
  { key: 'today', suffix: 'Today' },
  { key: 'last24h', suffix: '24h' },
  { key: 'last7days', suffix: '7d' }
];

const cost = (kwh) => `$${Math.round(kwh * COP_PER_KWH).toLocaleString('es-CO')}`;

/**
 * @param {Object} power - respuesta de /api/system/power (o status.power)
 * @param {Object} ids
 * @param {string} ids.modal - prefijo de las cifras instantáneas (…TotalWatts, …CpuWatts…)
 * @param {string} ids.row - prefijo de la tabla (…TodayWatts, …24hKwh…)
 * @param {string} [ids.currency] - sufijo de moneda (" COP")
 */
export function renderPowerTable(power, { modal, row, currency = '' }) {
  if (!power) return;
  const now = power.instant;
  if (now) {
    setText(`${modal}TotalWatts`, `${now.totalWatts} W`);
    setText(`${modal}CpuWatts`, `${now.cpuWatts} W`);
    setText(`${modal}GpuWatts`, `${now.gpuWatts} W`);
    if (now.baseWatts !== undefined) setText(`${modal}BaseWatts`, `${now.baseWatts} W`);
  }
  for (const { key, suffix } of PERIODS) {
    const p = power[key];
    if (!p) continue;
    setText(`${row}${suffix}Watts`, key === 'today' ? `${p.avgWatts} W (${p.hours}h)` : `${p.avgWatts} W`);
    setText(`${row}${suffix}Kwh`, `${p.kwh} kWh`);
    setText(`${row}${suffix}Cost`, `${cost(p.kwh)}${currency}`);
  }
}
