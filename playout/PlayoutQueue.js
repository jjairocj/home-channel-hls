/**
 * Home Channel HLS - Cola de emisión.
 *
 * Lista plana de elementos (episodios, bumpers, comerciales, rellenos) con el instante
 * en que empieza cada uno dentro de la lista, y su archivo ffconcat para FFmpeg.
 */

const fs = require('fs');
const path = require('path');

class PlayoutQueue {
  constructor(items = []) {
    this.items = items;
    this.offsets = [];
    this.computeOffsets();
  }

  /** Aplana bloques de la parrilla conservando a qué bloque pertenece cada elemento. */
  static fromBlocks(blocks) {
    const items = [];
    for (const block of blocks) {
      for (const item of block.items) {
        items.push({ ...item, blockTitle: block.title, slotStartTime: block.startTime, slotEndTime: block.endTime });
      }
    }
    return new PlayoutQueue(items);
  }

  static durationOf(item) {
    return item.targetDuration || item.duration || 0;
  }

  get length() {
    return this.items.length;
  }

  at(i) {
    return this.items[i] || null;
  }

  computeOffsets() {
    let acc = 0;
    this.offsets = this.items.map(item => {
      const start = acc;
      acc += PlayoutQueue.durationOf(item);
      return start;
    });
  }

  /** Nueva cola desde el índice dado (el elemento actual queda primero). */
  from(index) {
    return new PlayoutQueue(this.items.slice(index));
  }

  /** Nueva cola con elementos insertados al frente. */
  prepend(items) {
    return new PlayoutQueue([...items, ...this.items]);
  }

  /** Quita elementos cuyo archivo ya no existe. */
  withExistingFiles() {
    return new PlayoutQueue(this.items.filter(item => {
      if (!item.path) return false;
      const target = path.isAbsolute(item.path) ? item.path : path.resolve(item.path);
      return fs.existsSync(target);
    }));
  }

  /**
   * Índice del elemento que corresponde a una posición (segundos desde el inicio de la
   * cola), avanzando desde `fromIndex`.
   */
  indexAt(position, fromIndex = 0) {
    let i = fromIndex;
    while (i + 1 < this.items.length && position >= this.offsets[i + 1]) i++;
    return i;
  }

  /**
   * Archivo ffconcat. Los elementos recortados (relleno, cierre) usan "outpoint": la
   * directiva "duration" sola NO recorta el archivo.
   */
  writeConcat(file) {
    let content = 'ffconcat version 1.0\n';
    for (const item of this.items) {
      const fullPath = path.isAbsolute(item.path) ? item.path : path.resolve(item.path);
      content += `file '${fullPath.replace(/'/g, "'\\''")}'\n`;
      if (item.targetDuration) {
        const d = item.targetDuration.toFixed(3);
        content += `duration ${d}\noutpoint ${d}\n`;
      }
    }
    fs.writeFileSync(file, content, 'utf8');
    return file;
  }
}

module.exports = PlayoutQueue;
