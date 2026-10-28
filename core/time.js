/**
 * Home Channel HLS - Utilidades de tiempo de la emisión.
 * La parrilla se divide en bloques de 30 minutos que empiezan a las :00 y :30.
 */

const BLOCK_SECONDS = 1800;

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
/** Índice de Date#getDay() (0 = domingo) a clave de día. */
const JS_DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const pad2 = (n) => String(n).padStart(2, '0');

/** "HH:MM" de una fecha local. */
function hhmm(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Hora en formato 12 h de una fecha local: "6:30 PM", "12:00 AM". */
function clock12(date) {
  const h = date.getHours();
  return `${h % 12 || 12}:${pad2(date.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Copia de la fecha alineada al inicio de su bloque de 30 min. */
function alignToSlot(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
  return d;
}

/** Próximo cambio de bloque (:00 o :30) estrictamente posterior a `date`. */
function nextSlotBoundary(date = new Date()) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
}

/** Todas las horas "HH:MM" de un día en bloques de 30 min. */
function daySlotTimes() {
  const out = [];
  for (let m = 0; m < 24 * 60; m += 30) out.push(`${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`);
  return out;
}

/**
 * El día de transmisión empieza a las 06:00. La franja de 05:00 a 06:00 (tras el cierre
 * nocturno) cierra el día anterior: son las repeticiones de madrugada, como en la TV
 * tradicional, y no estrenan capítulos.
 */
const BROADCAST_DAY_START_HOUR = 6;

/**
 * Día de transmisión "AAAA-MM-DD" al que pertenece una fecha: lo emitido entre las
 * 00:00 y las 05:59 cuenta como parte del día anterior.
 */
function broadcastDay(date) {
  const d = new Date(date);
  d.setHours(d.getHours() - BROADCAST_DAY_START_HOUR);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Semana de transmisión "semana-AAAA-MM-DD" (lunes en que empieza): de lunes 06:00 a
 * lunes 06:00. Es el periodo del "capítulo de la semana" de las series semanales.
 */
function broadcastWeek(date) {
  const d = new Date(date);
  d.setHours(d.getHours() - BROADCAST_DAY_START_HOUR);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `semana-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Minutos desde el inicio del día de transmisión para una hora "HH:MM" (06:00 → 0). */
function broadcastMinutes(time) {
  const [h, m] = String(time).split(':').map(Number);
  return (((h - BROADCAST_DAY_START_HOUR) * 60 + m) + 24 * 60) % (24 * 60);
}

/** "m:ss" o "h:mm:ss". */
function formatDuration(seconds) {
  const s = Math.round(seconds || 0);
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return hours > 0 ? `${hours}:${pad2(mins)}:${pad2(secs)}` : `${mins}:${pad2(secs)}`;
}

/** Información del bloque en curso (para sincronizar la emisión con el reloj). */
function slotInfo(now = new Date()) {
  const slotStart = alignToSlot(now);
  const slotEnd = new Date(slotStart.getTime() + BLOCK_SECONDS * 1000);
  const elapsedSeconds = Math.max(0, Math.floor((now - slotStart) / 1000));
  const remainingSeconds = Math.max(0, BLOCK_SECONDS - elapsedSeconds);
  return {
    slotStart: slotStart.toISOString(),
    slotEnd: slotEnd.toISOString(),
    slotStartFormatted: hhmm(slotStart),
    slotEndFormatted: hhmm(slotEnd),
    elapsedSeconds,
    remainingSeconds,
    remainingFormatted: formatDuration(remainingSeconds)
  };
}

module.exports = {
  BLOCK_SECONDS,
  DAY_KEYS,
  JS_DAY_KEYS,
  pad2,
  hhmm,
  clock12,
  alignToSlot,
  nextSlotBoundary,
  daySlotTimes,
  BROADCAST_DAY_START_HOUR,
  broadcastDay,
  broadcastWeek,
  broadcastMinutes,
  formatDuration,
  slotInfo
};
