/**
 * Home Channel Radio - Fachada de la radio.
 *
 *   RadioLibrary    mediateca (escaneo, normalización, caché)
 *   DjStudio        guion + voz + mezcla de las presentaciones del locutor
 *   RadioStation    una por emisora: stream HLS de audio continuo
 *
 * Al cambiar la mediateca, las emisoras sin música que ahora tienen arrancan solas;
 * las que ya están al aire toman lo nuevo en su próxima tanda (sin cortar el tema).
 */

const path = require('path');
const RadioLibrary = require('./RadioLibrary');
const DjStudio = require('./DjStudio');
const RadioStation = require('./RadioStation');
const { createScriptWriter } = require('./DjScriptWriter');
const { BRAND, STATIONS } = require('./stations');

const DJ_DEBOUNCE_MS = 5000;

class RadioService {
  /**
   * @param {Object} opts
   * @param {string} opts.radioDir - media/radio
   * @param {string} opts.streamDir - stream (la radio usa stream/radio/<emisora>)
   */
  constructor({ radioDir, streamDir }) {
    this.library = new RadioLibrary({ baseDir: radioDir });
    this.studio = new DjStudio({ library: this.library, scriptWriter: createScriptWriter() });
    this.stations = STATIONS.map(station => new RadioStation({ station, library: this.library, streamRoot: path.join(streamDir, 'radio') }));
    this.djTimer = null;

    this.library.on('changed', () => {
      for (const st of this.stations) if (!st.onAir && !st.stopped) st.start();
      clearTimeout(this.djTimer);
      this.djTimer = setTimeout(() => this.studio.run(), DJ_DEBOUNCE_MS);
    });
  }

  async start() {
    for (const st of this.stations) st.stopped = false;
    await this.library.scan();
  }

  stop() {
    clearTimeout(this.djTimer);
    for (const st of this.stations) st.stop();
  }

  rescan() {
    return this.library.scan();
  }

  regenerateDj(trackId) {
    return this.studio.regenerate(trackId);
  }

  status() {
    const tracks = this.library.tracks;
    return {
      brand: BRAND,
      stations: this.stations.map(st => st.status()),
      library: {
        tracks: tracks.length,
        ready: tracks.filter(t => t.ready).length,
        withDj: tracks.filter(t => t.dj).length,
        jingles: this.library.jingles.length,
        ttsAvailable: this.studio.ttsAvailable
      }
    };
  }
}

module.exports = RadioService;
