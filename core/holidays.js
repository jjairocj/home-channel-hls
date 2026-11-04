/**
 * CrHe X-99 - Calendario y cálculo de Festivos en Colombia.
 * Basado en la Ley 51 de 1983 (Ley Emiliani) y el cómputo eclesiástico de Pascua (algoritmo anónimo Butcher).
 */

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Calcula la fecha del Domingo de Pascua (Resurrección) para un año dado.
 * Algoritmo Gregoriano de Butcher / Meeus.
 * @param {number} year 
 * @returns {{ month: number, day: number }} (mes 1-indexado)
 */
function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/**
 * Traslada una fecha al lunes siguiente si no cae en lunes (Ley Emiliani).
 * Si ya cae en lunes, se queda igual.
 */
function toNextMonday(year, month, day) {
  const d = new Date(year, month - 1, day);
  const dayOfWeek = d.getDay(); // 0 = Domingo, 1 = Lunes, ...
  if (dayOfWeek === 1) return formatDate(year, month, day);
  const daysToAdd = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  d.setDate(d.getDate() + daysToAdd);
  return formatDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function formatDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Suma días a una fecha base (año, mes, día).
 */
function addDays(year, month, day, days) {
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/**
 * Retorna todos los días festivos de Colombia para un año específico ("AAAA-MM-DD").
 * @param {number} year 
 * @returns {Set<string>}
 */
function getColombianHolidays(year) {
  const holidays = new Set();

  // 1. Festivos Fijos (no se mueven)
  holidays.add(formatDate(year, 1, 1));   // Año Nuevo
  holidays.add(formatDate(year, 5, 1));   // Día del Trabajo
  holidays.add(formatDate(year, 7, 20));  // Independencia de Colombia
  holidays.add(formatDate(year, 8, 7));   // Batalla de Boyacá
  holidays.add(formatDate(year, 12, 8));  // Inmaculada Concepción
  holidays.add(formatDate(year, 12, 25)); // Navidad

  // 2. Festivos con Ley Emiliani (se trasladan al siguiente lunes)
  holidays.add(toNextMonday(year, 1, 6));   // Reyes Magos
  holidays.add(toNextMonday(year, 3, 19));  // San José
  holidays.add(toNextMonday(year, 6, 29));  // San Pedro y San Pablo
  holidays.add(toNextMonday(year, 8, 15));  // Asunción de la Virgen
  holidays.add(toNextMonday(year, 10, 12)); // Día de la Raza
  holidays.add(toNextMonday(year, 11, 1));  // Todos los Santos
  holidays.add(toNextMonday(year, 11, 11)); // Independencia de Cartagena

  // 3. Festivos basados en Pascua
  const easter = getEasterSunday(year);

  // Jueves Santo (-3 días) y Viernes Santo (-2 días) - no se trasladan
  const holyThursday = addDays(year, easter.month, easter.day, -3);
  holidays.add(formatDate(holyThursday.year, holyThursday.month, holyThursday.day));

  const goodFriday = addDays(year, easter.month, easter.day, -2);
  holidays.add(formatDate(goodFriday.year, goodFriday.month, goodFriday.day));

  // Ascensión del Señor (+43 días tras Pascua, al lunes)
  const ascension = addDays(year, easter.month, easter.day, 43);
  holidays.add(formatDate(ascension.year, ascension.month, ascension.day));

  // Corpus Christi (+64 días tras Pascua, al lunes)
  const corpus = addDays(year, easter.month, easter.day, 64);
  holidays.add(formatDate(corpus.year, corpus.month, corpus.day));

  // Sagrado Corazón de Jesús (+71 días tras Pascua, al lunes)
  const sacredHeart = addDays(year, easter.month, easter.day, 71);
  holidays.add(formatDate(sacredHeart.year, sacredHeart.month, sacredHeart.day));

  return holidays;
}

const holidaysCache = new Map();

/**
 * Determina si una fecha (Date o string "AAAA-MM-DD") es un día festivo en Colombia.
 * @param {Date|string} dateOrString 
 * @returns {boolean}
 */
function isColombianHoliday(dateOrString) {
  let dateStr = '';
  let year = 0;

  if (typeof dateOrString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOrString)) {
    dateStr = dateOrString;
    year = parseInt(dateStr.slice(0, 4), 10);
  } else {
    const d = new Date(dateOrString);
    year = d.getFullYear();
    dateStr = formatDate(year, d.getMonth() + 1, d.getDate());
  }

  if (!holidaysCache.has(year)) {
    holidaysCache.set(year, getColombianHolidays(year));
  }
  return holidaysCache.get(year).has(dateStr);
}

module.exports = {
  isColombianHoliday,
  getColombianHolidays
};
