/**
 * Home Channel HLS - Composición de bloques de emisión.
 *
 * Arma la secuencia de un bloque con estructura de TV de cable y garantiza que la suma
 * de duraciones sea EXACTAMENTE la del bloque (30 o 60 min):
 *
 *   Episodio único:  [Intro] → Episodio → Corte → A continuación → Tanda
 *                    → A continuación → Relleno
 *   Doble episodio:  [Intro] → Ep 1 → Corte → Tanda → Regreso → Ep 2 → Corte
 *                    → A continuación → Tanda → A continuación → Relleno
 *
 * La tanda final abre y cierra con "A continuación" (el siguiente programa, quemado en
 * el video por NextUpDecorator); el relleno abre con la cartelera de hoy.
 *
 * Patrón Builder: BlockBuilder lleva el reloj interno del bloque y cada paso es un
 * método pequeño; BlockComposer decide qué pasos usar.
 */

const path = require('path');

const DEFAULT_SHOW_SECONDS = 1380;
/** Margen mínimo que debe quedar para la tanda al poner "A continuación" al abrirla. */
const NEXT_UP_AT_BREAK_MIN = 60;
const DEFAULT_BREAK_OUT_SECONDS = 12;
const INTRO_MAX_SECONDS = 25;
const PAD_CLIP_ROTATION_MIN = 35;
const SIGNOFF_DEFAULT = { id: 'signoff_default', name: 'Home Channel HLS // Cierre de Emisión (Música para dormir)', duration: 60 };

const randomId = () => Math.random().toString(36).substring(2, 6);

/** Acumula elementos y su posición dentro del bloque. */
class BlockBuilder {
  constructor(targetDuration) {
    this.target = targetDuration;
    this.items = [];
    this.t = 0;
  }

  get remaining() {
    return this.target - this.t;
  }

  add(item, role, extra = {}) {
    this.items.push({ ...item, role, slotOffset: this.t, ...extra });
    this.t += extra.targetDuration || item.duration;
    return this;
  }

  /** Agrega varios elementos ya posicionados (relleno). */
  addPositioned(items, total) {
    this.items.push(...items);
    this.t += total;
    return this;
  }

  build() {
    return { items: this.items, totalDuration: this.target };
  }
}

class BlockComposer {
  /**
   * @param {Object} deps
   * @param {import('../library/BumperCatalog')} deps.bumpers
   * @param {import('./CommercialRotation')} deps.rotation
   * @param {Function} deps.getCommercials
   * @param {string} deps.bumpersDir - para el clip de cierre por defecto
   */
  constructor({ bumpers, rotation, getCommercials, bumpersDir }) {
    this.bumpers = bumpers;
    this.rotation = rotation;
    this.getCommercials = getCommercials;
    this.bumpersDir = bumpersDir;
  }

  /** Bloque completo para uno o dos episodios. */
  compose(show, targetDuration = 1800, secondShow = null) {
    const b = new BlockBuilder(targetDuration);
    const used = new Set();
    if (secondShow) this.composeDouble(b, show, secondShow, used);
    else this.composeSingle(b, show, used);
    this.finish(b);
    return b.build();
  }

  composeSingle(b, show, used) {
    const showDuration = show ? show.duration : DEFAULT_SHOW_SECONDS;
    const hadIntro = this.addIntro(b, b.target - showDuration, 60, used);
    if (show) b.add(show, 'main_show');

    // Transición hacia comerciales: "Estás viendo"
    this.addBumperIfFits(b, 'break_in', 'mid_bumper_in', 20);

    // Tanda comercial: calculamos presupuesto dejando hueco para el "A continuación" de cierre
    const breakOut = this.bumpers.forRole('break_out');
    const budget = Math.max(0, b.remaining - (breakOut ? breakOut.duration : DEFAULT_BREAK_OUT_SECONDS));
    this.addCommercials(b, budget, used, { withStationId: !hadIntro });

    // Cierre único de la tanda hacia el siguiente programa: "A continuación"
    if (breakOut && b.remaining >= breakOut.duration) b.add(breakOut, 'outro_bumper');
  }

  composeDouble(b, show, secondShow, used) {
    const combined = (show ? show.duration : 0) + secondShow.duration;
    const hadIntro = this.addIntro(b, b.target - combined, 55, used);
    if (show) b.add(show, 'main_show', { part: 1 });

    // Tanda intermedia: ~45 % del margen que queda antes del segundo episodio
    const marginBeforeSecond = Math.max(0, b.target - (b.t + secondShow.duration));
    let midRemaining = Math.min(240, Math.max(30, Math.floor(marginBeforeSecond * 0.45)));
    const midIn = this.bumpers.forRole('break_in');
    if (midIn && midRemaining >= midIn.duration + 20) {
      b.add(midIn, 'mid_bumper_in');
      midRemaining -= midIn.duration;
    }
    const midOut = this.bumpers.forRole('break_out');
    const midBudget = Math.max(0, midRemaining - (midOut ? midOut.duration : DEFAULT_BREAK_OUT_SECONDS));
    this.addCommercials(b, midBudget, used, { withStationId: !hadIntro });
    if (midOut && b.target - (b.t + secondShow.duration) >= midOut.duration) b.add(midOut, 'mid_bumper_out');

    b.add(secondShow, 'main_show', { part: 2 });

    // Tanda final
    this.addBumperIfFits(b, 'break_in', 'outro_bumper_in', 25);
    const out = this.bumpers.forRole('break_out');
    const finalBudget = Math.max(0, b.remaining - (out ? out.duration : DEFAULT_BREAK_OUT_SECONDS));
    const alreadyHadStation = b.items.some(it => it.role === 'intro_bumper' || it.role === 'mid_bumper_station');
    this.addCommercials(b, finalBudget, used, { withStationId: !alreadyHadStation });
    if (out && b.remaining >= out.duration) b.add(out, 'outro_bumper');
  }

  /** Cortinilla de apertura si el margen libre lo permite. */
  addIntro(b, margin, minMargin, used) {
    if (margin <= minMargin) return false;
    const intro = this.bumpers.forRole('intro', { exclude: used });
    if (intro && intro.duration <= INTRO_MAX_SECONDS) {
      b.add(intro, 'intro_bumper');
      if (used) {
        if (intro.id) used.add(intro.id);
        if (intro.filename) used.add(intro.filename);
      }
      return true;
    }
    return false;
  }

  addBumperIfFits(b, bumperRole, itemRole, extraSeconds) {
    const bumper = this.bumpers.forRole(bumperRole);
    if (bumper && b.remaining >= bumper.duration + extraSeconds) b.add(bumper, itemRole);
  }

  /**
   * Tanda comercial. En tandas largas (6+ spots) se intercala un Station ID a la mitad.
   */
  addCommercials(b, budget, used, { withStationId = false } = {}) {
    if (budget < 15) return;
    const configuredMax = (this.rotation && this.rotation.getMaxSpotsPerBreak) ? this.rotation.getMaxSpotsPerBreak() : 0;
    // Si el límite de spots configurado dejaría más de 60 s sin comerciales en la tanda
    // (lo que provocaría huecos vacíos excesivos de relleno), permitimos llenar con comerciales.
    const maxSpots = (configuredMax > 0 && budget > (configuredMax * 32) + 60) ? 0 : configuredMax;
    const spots = this.rotation.pick(budget, used, { maxSpots });
    const alreadyHasStation = b.items.some(it => it.role === 'intro_bumper' || it.role === 'mid_bumper_station');
    const station = (withStationId && !alreadyHasStation) ? this.bumpers.forRole('intro', { exclude: used }) : null;
    const midPoint = Math.floor(spots.length / 2);

    spots.forEach((spot, i) => {
      if (station && i === midPoint && spots.length >= 6 && b.remaining >= station.duration + 20) {
        b.add(station, 'mid_bumper_station');
        if (used) {
          if (station.id) used.add(station.id);
          if (station.filename) used.add(station.filename);
        }
      }
      if (!withStationId || spot.duration <= b.remaining) b.add(spot, 'commercial');
    });
  }

  /** Relleno exacto hasta el final del bloque (o recorte del último elemento). */
  finish(b) {
    const exactPad = b.remaining;
    if (exactPad > 0.05) {
      const padClip = this.bumpers.forRole('sync_pad') || (this.getCommercials() || [])[0] || null;
      if (padClip) b.addPositioned(this.padItems(padClip, exactPad, b.t), exactPad);
    } else if (exactPad < -0.05) {
      const last = b.items[b.items.length - 1];
      if (last && last.role !== 'main_show') {
        const adjusted = Math.max(1, last.duration + exactPad);
        last.targetDuration = adjusted;
        last.duration = Math.round(adjusted);
        b.t = b.target;
      }
    }
  }

  /**
   * Relleno sincronizador. FFmpeg no puede estirar un archivo: si el hueco es mayor que
   * el clip, se rotan bumpers cortos variados y el último trozo se recorta al
   * milisegundo para clavar el :00/:30.
   * Las cortinillas Station ID NUNCA se usan como relleno de sincronización.
   */
  padItems(padClip, exactPad, startOffset) {
    const variety = this.bumpers.regular({
      minDur: 4,
      maxDur: 45,
      excludeKeywords: ['sincronizador', 'station id', 'station_id', 'animestation', 'intro']
    });
    const items = [];
    let remaining = exactPad;
    let offset = startOffset;
    let k = 0;

    while (remaining > 0.05) {
      const chosen = remaining > PAD_CLIP_ROTATION_MIN && variety.length ? variety[k++ % variety.length] : padClip;
      const piece = Math.min(remaining, chosen.duration > 1 ? chosen.duration : remaining);
      items.push({
        ...chosen,
        id: `pad_${Date.now()}_${randomId()}`,
        name: chosen.name || 'Home Channel Señal Satelital (Sincronizador Horario)',
        role: 'filler_pad',
        duration: Math.round(piece),
        targetDuration: piece,
        slotOffset: offset
      });
      offset += piece;
      remaining -= piece;
    }
    return items;
  }

  /**
   * Bloque de cierre de emisión (01:00–05:00): el clip de cierre en bucle, recortado al
   * segundo para terminar exacto.
   */
  signoff(targetDuration = 1800) {
    const clip = this.bumpers.forRole('cierre_emision') ||
      { ...SIGNOFF_DEFAULT, path: path.resolve(this.bumpersDir, 'bumper_04_cierre_emision_nocturno.mp4') };
    const clipDuration = clip.duration > 0 ? clip.duration : 60.73;
    const base = { showTitle: 'Cierre de Emisión', role: 'signoff' };
    const items = [];
    let t = 0;

    for (let n = 1; t + clipDuration <= targetDuration; n++) {
      items.push({ ...clip, ...base, id: `signoff_${n}_${randomId()}`, name: 'Home Channel HLS // Cierre de Emisión Nocturna (Transmisión OFF)', slotOffset: t });
      t += clipDuration;
    }
    const rest = targetDuration - t;
    if (rest > 0.05) {
      items.push({
        ...clip,
        ...base,
        id: `signoff_pad_${randomId()}`,
        name: 'Home Channel HLS // Cierre de Emisión Nocturna (Sincronizador)',
        duration: Math.round(rest),
        targetDuration: rest,
        slotOffset: t
      });
    }
    return { items, totalDuration: targetDuration };
  }
}

module.exports = BlockComposer;
module.exports.BlockBuilder = BlockBuilder;
