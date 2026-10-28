/**
 * Home Channel HLS - Compilador de reglas de la parrilla.
 *
 * Las reglas se escriben por DÍA DE TRANSMISIÓN, como una guía de TV: la columna
 * "lunes" va de las 06:00 del lunes a las 05:30 del martes. El motor de emisión usa una
 * grilla por día de CALENDARIO, así que lo emitido entre las 00:00 y las 05:59 se anota
 * en el día siguiente.
 *
 * Choques: si dos reglas cubren el mismo horario gana la manual sobre la automática,
 * luego la de mayor prioridad y luego la editada más recientemente; el resto se informa
 * como conflicto.
 *
 * Valores de celda que entiende el planificador:
 *   'saga:<clave>' | id de temporada   serie (estreno o repetición según el día)
 *   'maraton:<objetivo>@<n>'           capítulo n del maratón de fin de semana
 *   'off_air'                          cierre de emisión
 */

const { DAY_KEYS, BROADCAST_DAY_START_HOUR } = require('../../core/time');

const pad2 = (n) => String(n).padStart(2, '0');
const SLOTS_PER_DAY = 48;

/** Las 48 horas "HH:MM" del día de transmisión, desde las 06:00. */
const BROADCAST_TIMES = Array.from({ length: SLOTS_PER_DAY }, (_, i) => {
  const m = (BROADCAST_DAY_START_HOUR * 60 + i * 30) % (24 * 60);
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
});

/** Día de calendario de una celda del día de transmisión `dayIndex` (0 = lunes). */
function calendarDayIndex(dayIndex, time) {
  const hour = parseInt(time.slice(0, 2), 10);
  return hour < BROADCAST_DAY_START_HOUR ? (dayIndex + 1) % 7 : dayIndex;
}

/** Día de transmisión de una celda de calendario (inverso del anterior). */
function broadcastDayIndex(calendarIndex, time) {
  const hour = parseInt(time.slice(0, 2), 10);
  return hour < BROADCAST_DAY_START_HOUR ? (calendarIndex + 6) % 7 : calendarIndex;
}

const cellKey = (day, time) => `${day}|${time}`;

/** Orden de preferencia entre reglas que se pisan. */
function outranks(a, b) {
  if ((a.source === 'manual') !== (b.source === 'manual')) return a.source === 'manual';
  if ((a.priority || 0) !== (b.priority || 0)) return (a.priority || 0) > (b.priority || 0);
  return String(a.updatedAt || '') > String(b.updatedAt || '');
}

/** Comparador para ordenar reglas de la que gana a la que pierde. */
const precedence = (a, b) => (outranks(a, b) ? -1 : (outranks(b, a) ? 1 : 0));

function cellValue(rule, index) {
  if (rule.kind === 'off_air') return 'off_air';
  if (rule.kind === 'marathon') return `maraton:${rule.target}@${index}`;
  return rule.target;
}

/** Celdas (día de transmisión, hora) que ocupa una regla, en orden. */
function ruleCells(rule) {
  const start = BROADCAST_TIMES.indexOf(rule.startTime);
  if (start === -1) return [];
  const out = [];
  for (const day of rule.days) {
    const dayIndex = DAY_KEYS.indexOf(day);
    for (let k = 0; k < rule.slots; k++) {
      const pos = start + k;
      const d = (dayIndex + Math.floor(pos / SLOTS_PER_DAY)) % 7;
      out.push({ day: DAY_KEYS[d], time: BROADCAST_TIMES[pos % SLOTS_PER_DAY], index: k });
    }
  }
  return out;
}

const cellKeyOf = (c) => cellKey(c.day, c.time);

/** Claves "día|hora" que ocupa una regla. */
function ruleCellKeys(rule) {
  return new Set(ruleCells(rule).map(cellKeyOf));
}

/**
 * Quita de una regla los horarios ya ocupados (`covered`, claves "día|hora").
 * Lo que queda se devuelve como reglas nuevas con los mismos datos (tipo, serie,
 * origen, nota): una por cada tramo seguido, agrupando los días que quedan iguales.
 * @returns {Object[]|null} null si la regla no pisa nada de `covered`
 */
function subtractCells(rule, covered) {
  const start = BROADCAST_TIMES.indexOf(rule.startTime);
  if (start === -1) return null;
  let touched = false;
  const groups = new Map(); // "inicio|largo" -> { pos, len, days }
  const keep = (segment) => {
    const key = `${segment.pos}|${segment.len}`;
    if (!groups.has(key)) groups.set(key, { pos: segment.pos, len: segment.len, days: new Set() });
    groups.get(key).days.add(segment.day);
  };

  for (const day of rule.days) {
    const dayIndex = DAY_KEYS.indexOf(day);
    let segment = null;
    for (let k = 0; k < rule.slots; k++) {
      const pos = start + k;
      // Pasadas las 05:30 la regla sigue en el día de transmisión siguiente
      const cellDay = DAY_KEYS[(dayIndex + Math.floor(pos / SLOTS_PER_DAY)) % 7];
      if (covered.has(cellKey(cellDay, BROADCAST_TIMES[pos % SLOTS_PER_DAY]))) {
        touched = true;
        if (segment) keep(segment);
        segment = null;
      } else if (segment) {
        segment.len++;
      } else {
        segment = { pos: pos % SLOTS_PER_DAY, day: cellDay, len: 1 };
      }
    }
    if (segment) keep(segment);
  }
  if (!touched) return null;

  const { id, createdAt, updatedAt, ...data } = rule;
  return [...groups.values()].map(g => ({
    ...data,
    days: DAY_KEYS.filter(d => g.days.has(d)),
    startTime: BROADCAST_TIMES[g.pos],
    slots: g.len
  }));
}

/**
 * @param {Object[]} rules - reglas (se ignoran las deshabilitadas)
 * @returns {{ cells: Object, calendarGrid: Object, conflicts: Object[] }}
 *   cells: 'lunes|19:00' → { ruleId, source, kind, target, value, index, day, time }
 *   calendarGrid: { monday: { '19:00': valor } } para el planificador
 */
function compileRules(rules) {
  const cells = {};
  const losers = {};
  for (const rule of rules.filter(r => r.enabled !== false)) {
    for (const { day, time, index } of ruleCells(rule)) {
      const key = cellKey(day, time);
      const cell = { ruleId: rule.id, source: rule.source, kind: rule.kind, target: rule.target, value: cellValue(rule, index), index, day, time, rule };
      const current = cells[key];
      if (!current) {
        cells[key] = cell;
      } else if (outranks(rule, current.rule)) {
        (losers[key] = losers[key] || []).push(current.ruleId);
        cells[key] = cell;
      } else {
        (losers[key] = losers[key] || []).push(rule.id);
      }
    }
  }

  const calendarGrid = Object.fromEntries(DAY_KEYS.map(d => [d, {}]));
  for (const cell of Object.values(cells)) {
    const cal = DAY_KEYS[calendarDayIndex(DAY_KEYS.indexOf(cell.day), cell.time)];
    calendarGrid[cal][cell.time] = cell.value;
  }

  const conflicts = Object.entries(losers).map(([key, ids]) => {
    const [day, time] = key.split('|');
    return { day, time, winner: cells[key].ruleId, losers: [...new Set(ids)] };
  });
  for (const cell of Object.values(cells)) delete cell.rule;
  return { cells, calendarGrid, conflicts };
}

/**
 * Convierte celdas sueltas en reglas: agrupa los días con el mismo valor a la misma
 * hora y une en una sola regla los maratones y cierres consecutivos.
 * @param {Object} grid - { día de transmisión: { hora: valor } }
 * @param {string} source - 'manual' | 'auto'
 */
function cellsToRules(grid, source = 'manual') {
  // 1. Por hora y valor: qué días lo tienen
  const byTimeValue = new Map();
  for (const day of DAY_KEYS) {
    for (const [time, raw] of Object.entries(grid[day] || {})) {
      if (!raw || !BROADCAST_TIMES.includes(time)) continue;
      const m = /^maraton:(.+)@(\d+)$/.exec(raw);
      const value = m ? `maraton:${m[1]}` : raw;
      const key = `${time}|${value}`;
      if (!byTimeValue.has(key)) byTimeValue.set(key, { time, value, days: [] });
      byTimeValue.get(key).days.push(day);
    }
  }
  // 2. Maratones y cierres consecutivos (mismos días) en una sola regla
  const groups = [...byTimeValue.values()].sort((a, b) => BROADCAST_TIMES.indexOf(a.time) - BROADCAST_TIMES.indexOf(b.time));
  const rules = [];
  const open = new Map();
  for (const g of groups) {
    const kind = g.value === 'off_air' ? 'off_air' : (g.value.startsWith('maraton:') ? 'marathon' : 'show');
    const target = kind === 'off_air' ? null : (kind === 'marathon' ? g.value.slice('maraton:'.length) : g.value);
    const daysKey = DAY_KEYS.filter(d => g.days.includes(d)).join(',');
    const mergeKey = `${kind}|${target}|${daysKey}`;
    const prev = open.get(mergeKey);
    const idx = BROADCAST_TIMES.indexOf(g.time);
    if (kind !== 'show' && prev && BROADCAST_TIMES.indexOf(prev.startTime) + prev.slots === idx) {
      prev.slots++;
      continue;
    }
    const rule = { kind, target, days: daysKey.split(','), startTime: g.time, slots: 1, source };
    rules.push(rule);
    open.set(mergeKey, rule);
  }
  return rules;
}

/** Grilla por día de calendario (formato anterior) → grilla por día de transmisión. */
function calendarToBroadcast(calendarGrid) {
  const out = Object.fromEntries(DAY_KEYS.map(d => [d, {}]));
  DAY_KEYS.forEach((calDay, ci) => {
    for (const [time, value] of Object.entries((calendarGrid || {})[calDay] || {})) {
      out[DAY_KEYS[broadcastDayIndex(ci, time)]][time] = value;
    }
  });
  return out;
}

module.exports = { compileRules, cellsToRules, calendarToBroadcast, ruleCells, ruleCellKeys, subtractCells, precedence, BROADCAST_TIMES, calendarDayIndex, broadcastDayIndex };
