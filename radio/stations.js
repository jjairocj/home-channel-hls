/**
 * Home Channel Radio - Emisoras (presets del sintonizador). Única fuente de verdad: el
 * sintonizador web las recibe en /api/radio/status.
 */

const BRAND = 'Home Channel Radio';

/**
 * folder: subcarpeta de media/radio/music ('': toda la música de la carpeta).
 * voice: voz neuronal de edge-tts del locutor. persona: estilo para el guion.
 * dialLeft: posición de la aguja en el dial del sintonizador (55.5% para 99.1 FM).
 */
const STATIONS = [
  {
    id: 'main',
    freq: '99.1',
    name: 'HOME CHANNEL RADIO 99.1 FM',
    show: 'Home Channel Radio // Broadcast',
    dj: 'DJ Vex',
    voice: 'es-MX-JorgeNeural',
    folder: '',
    dialLeft: '55.5%',
    persona: 'locutor enérgico y con actitud moderna de radio'
  }
];

/** Carpeta raíz de música: sus temas sirven a la emisora. */
const GENERAL_FOLDER = '';

const stationById = (id) => STATIONS.find(s => s.id === id) || STATIONS[0];

module.exports = { BRAND, STATIONS, GENERAL_FOLDER, stationById };
