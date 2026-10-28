/**
 * Home Channel HLS - Constantes de programación: franjas horarias, cierre nocturno y umbrales.
 */

const { DAY_KEYS } = require('../core/time');

/** Episodios listos mínimos para que una serie entre a la grilla (o todos si son menos). */
const MIN_READY_EPISODES = 6;

/**
 * Veces que una serie sale al aire por día como máximo: el estreno del capítulo del día
 * y sus repeticiones (todas con el mismo capítulo).
 */
const MAX_DAILY_AIRINGS = 2;

/**
 * Series largas (telenovelas, animes de cientos de capítulos): su capítulo del día se
 * repite más para que sea fácil seguirlas.
 */
const LONG_SERIES_MIN_EPISODES = 100;
const LONG_SERIES_DAILY_AIRINGS = 3;

/**
 * Series episódicas (sin continuidad entre capítulos): cada emisión es un capítulo al
 * azar en vez del capítulo del día. Se detectan por nombre; el panel puede cambiarlo.
 */
const EPISODIC_KEYWORDS = ['simpson', 'smiling friends'];

/**
 * Frecuencia automática: las series cortas (hasta este total de capítulos, la típica de
 * 13-26) son semanales, como el prime time de antes; las más largas van en tira diaria.
 */
const WEEKLY_MAX_EPISODES = 40;
/** Emisiones por semana de una serie semanal: el estreno y una repetición. */
const WEEKLY_AIRINGS = 2;
/** Series semanales seguidas que forman un bloque temático en una misma noche. */
const WEEKLY_BLOCK_SIZE = 3;

/**
 * Maratón de fin de semana: los capítulos estrenados de lunes a viernes, seguidos, el
 * sábado o el domingo (en Colombia no se estrena el fin de semana).
 */
const MARATHON_LENGTH = 5;
const MIN_MARATHON_LENGTH = 3;

/** Separación mínima entre el estreno y la repetición de un mismo capítulo. */
const MIN_REPEAT_GAP_MINUTES = 240;

/** Franja de cierre de emisión (horas locales, [inicio, fin)). */
const OFF_AIR = { from: 1, to: 5 };

const FRANJAS = {
  manana: { label: 'Mañana', ranges: [['06:00', '12:00']] },
  tarde: { label: 'Tarde', ranges: [['12:00', '18:00']] },
  prime: { label: 'Prime Time', ranges: [['18:00', '23:00']] },
  noche: { label: 'Noche', ranges: [['23:00', '24:00']] },
  madrugada: { label: 'Madrugada', ranges: [['00:00', '01:00'], ['05:00', '06:00']] }
};

const FRANJA_KEYWORDS = {
  madrugada: ['ergo proxy', 'lain', 'saikano', 'death note', 'blue seed', 'beastars'],
  manana: ['dragon ball', 'digimon', 'pokemon', 'yu-gi-oh', 'sakura', 'avatar'],
  tarde: ['inuyasha', 'naruto', 'saber marionette', 'nadesico', 'caballeros', 'zodiaco', 'betty'],
  prime: ['evangelion', 'cowboy bebop', 'jojo', 'fullmetal', 'brotherhood'],
  noche: ['smiling friends', 'simpson']
};

function franjaSlots(franjaKey) {
  const f = FRANJAS[franjaKey];
  if (!f) return [];
  const out = [];
  for (const [from, to] of f.ranges) {
    const [fh, fm] = from.split(':').map(Number);
    const [th, tm] = to.split(':').map(Number);
    for (let t = fh * 60 + fm; t < th * 60 + tm; t += 30) {
      out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    }
  }
  return out;
}

function isOffAirTime(time) {
  const h = parseInt(String(time).split(':')[0], 10);
  return h >= OFF_AIR.from && h < OFF_AIR.to;
}

module.exports = { DAY_KEYS, MIN_READY_EPISODES, MAX_DAILY_AIRINGS, LONG_SERIES_MIN_EPISODES, LONG_SERIES_DAILY_AIRINGS, EPISODIC_KEYWORDS, WEEKLY_MAX_EPISODES, WEEKLY_AIRINGS, WEEKLY_BLOCK_SIZE, MARATHON_LENGTH, MIN_MARATHON_LENGTH, MIN_REPEAT_GAP_MINUTES, OFF_AIR, FRANJAS, FRANJA_KEYWORDS, franjaSlots, isOffAirTime };
