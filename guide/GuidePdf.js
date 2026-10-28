/**
 * Home Channel - "TV Guide" en PDF: la programación de la semana con el estilo de
 * la revista de la web (papel de periódico, logo en cajas, estrellas de oferta, cintas
 * de color por franja y columnas de horarios).
 *
 * Portada con los estrenos de la semana, los maratones y el índice; luego un día por
 * página (si no cabe, continúa en la siguiente).
 */

const path = require('path');
const PDFDocument = require('pdfkit');
const { SECTIONS, coverHighlights } = require('./WeekGuide');

const FONTS_DIR = path.resolve(__dirname, '../assets/fonts');

const C = {
  paper: '#f4eedc',
  paperDark: '#e6dcc0',
  ink: '#161310',
  red: '#d7261e',
  yellow: '#ffd60a',
  pink: '#e8298a',
  muted: '#5c5446',
  faded: '#8a8170',
  white: '#ffffff'
};

const PAGE = { width: 595.28, height: 841.89, margin: 30 };
const CONTENT_W = PAGE.width - PAGE.margin * 2;
const FOOTER_Y = PAGE.height - 34;

const DAY_NAMES = {
  monday: 'Lunes', tuesday: 'Martes', wednesday: 'Miércoles', thursday: 'Jueves',
  friday: 'Viernes', saturday: 'Sábado', sunday: 'Domingo'
};
const DAY_SHORT = { monday: 'Lun', tuesday: 'Mar', wednesday: 'Mié', thursday: 'Jue', friday: 'Vie', saturday: 'Sáb', sunday: 'Dom' };
const WEEK_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const KIND_CHIPS = {
  premiere: { text: 'ESTRENO', color: C.red },
  marathon: { text: 'MARATÓN', color: C.pink }
};

/* ---------- Utilidades ---------- */

function registerFonts(doc) {
  doc.registerFont('Logo', path.join(FONTS_DIR, 'Bungee-Regular.ttf'));
  doc.registerFont('Head', path.join(FONTS_DIR, 'Oswald-Bold.ttf'));
  doc.registerFont('HeadMedium', path.join(FONTS_DIR, 'Oswald-Medium.ttf'));
  // Tinos: misma métrica que Times New Roman (la serifa de la revista web), incrustada
  doc.registerFont('SerifItalic', path.join(FONTS_DIR, 'Tinos-Italic.ttf'));
  doc.registerFont('SerifBoldItalic', path.join(FONTS_DIR, 'Tinos-BoldItalic.ttf'));
  doc.registerFont('SerifBold', path.join(FONTS_DIR, 'Tinos-Bold.ttf'));
}

const dateLong = (d) => `${d.getDate()} de ${MONTHS[d.getMonth()]}`;

/** Semana del año (ISO), para el número de la edición. */
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/** "Lunes a viernes", "Todos los días" o "Lun, Mié, Vie". */
function daysLabel(keys) {
  const set = new Set(keys);
  const weekdays = WEEK_ORDER.slice(0, 5);
  if (set.size === 7) return 'Todos los días';
  if (set.size === 5 && weekdays.every(d => set.has(d))) return 'Lunes a viernes';
  if (set.size === 2 && set.has('saturday') && set.has('sunday')) return 'Fines de semana';
  return WEEK_ORDER.filter(d => set.has(d)).map(d => DAY_SHORT[d]).join(', ');
}

function paper(doc) {
  doc.save().rect(0, 0, PAGE.width, PAGE.height).fill(C.paper).restore();
}

/** Trama de puntos de imprenta en una esquina (los puntos crecen hacia la esquina). */
function halftone(doc, cornerX, cornerY, radius, color) {
  doc.save().fillColor(color).fillOpacity(0.55);
  const step = 7;
  for (let dx = 0; dx <= radius; dx += step) {
    for (let dy = 0; dy <= radius; dy += step) {
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      const r = 2.6 * (1 - dist / radius);
      if (r < 0.35) continue;
      const x = cornerX === 0 ? dx : cornerX - dx;
      const y = cornerY === 0 ? dy : cornerY - dy;
      doc.circle(x, y, r).fill();
    }
  }
  doc.restore();
}

/** Franja negra superior de la revista. */
function topStrip(doc, left, right) {
  const y = PAGE.margin;
  doc.save().rect(PAGE.margin, y, CONTENT_W, 18).fill(C.ink);
  doc.font('Head').fontSize(8.5).fillColor(C.yellow)
    .text(left, PAGE.margin + 8, y + 3.5, { characterSpacing: 1.2, lineBreak: false });
  const w = doc.widthOfString(right, { characterSpacing: 1.2 });
  doc.fillColor(C.paper).text(right, PAGE.margin + CONTENT_W - 8 - w, y + 3.5, { characterSpacing: 1.2, lineBreak: false });
  doc.restore();
}

/** Logo: "TELE" en caja roja, "GUÍA" en caja blanca con sombra dura y "X-99" en etiqueta amarilla. */
function logo(doc, x, y, scale = 1) {
  const size = 26 * scale;
  const pad = 6 * scale;
  doc.save();
  doc.font('Logo').fontSize(size);
  const teleW = doc.widthOfString('TELE') + pad * 2;
  const guiaW = doc.widthOfString('GUÍA') + pad * 2;
  const h = size * 1.12 + pad;
  const shadow = 4 * scale;
  // Sombras duras
  doc.rect(x + shadow, y + shadow, teleW + guiaW, h).fill(C.ink);
  // Cajas
  doc.rect(x, y, teleW, h).fill(C.red);
  doc.lineWidth(2.5 * scale).rect(x + teleW, y, guiaW, h).fillAndStroke(C.white, C.ink);
  doc.lineWidth(2.5 * scale).rect(x, y, teleW + guiaW, h).stroke(C.ink);
  doc.fillColor(C.white).text('TELE', x + pad, y + pad * 0.55, { lineBreak: false });
  doc.fillColor(C.red).text('GUÍA', x + teleW + pad, y + pad * 0.55, { lineBreak: false });
  // Etiqueta X-99
  const tagSize = 11 * scale;
  doc.fontSize(tagSize);
  const tagW = doc.widthOfString('X-99') + 8 * scale;
  const tagX = x + teleW + guiaW - tagW * 0.55;
  const tagY = y - tagSize * 0.75;
  doc.rotate(-6, { origin: [tagX + tagW / 2, tagY + tagSize / 2] });
  doc.lineWidth(1.5 * scale).rect(tagX, tagY, tagW, tagSize * 1.35).fillAndStroke(C.yellow, C.ink);
  doc.fillColor(C.ink).text('X-99', tagX + 4 * scale, tagY + tagSize * 0.12, { lineBreak: false });
  doc.restore();
  return { width: teleW + guiaW + shadow, height: h + shadow };
}

/** Estrella de oferta con texto centrado. */
function starburst(doc, cx, cy, radius, fill, lines, { textColor = C.red, font = 'Logo', size = 11, rotate = -10, spikes = 16 } = {}) {
  doc.save();
  doc.rotate(rotate, { origin: [cx, cy] });
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.78;
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  doc.polygon(...pts).fill(fill);
  doc.font(font).fontSize(size).fillColor(textColor);
  const lineH = size * 1.05;
  const top = cy - (lines.length * lineH) / 2 + 1;
  lines.forEach((line, i) => {
    const w = doc.widthOfString(line);
    doc.text(line, cx - w / 2, top + i * lineH, { lineBreak: false });
  });
  doc.restore();
}

/** Código de barras decorativo (determinista). */
function barcode(doc, x, y, width, height, seed = 99) {
  doc.save().fillColor(C.ink);
  let s = seed;
  let cx = x;
  while (cx < x + width) {
    s = (s * 9301 + 49297) % 233280;
    const w = 0.6 + (s % 4) * 0.55;
    doc.rect(cx, y, w, height).fill();
    cx += w + 0.8 + ((s >> 3) % 3) * 0.6;
  }
  doc.restore();
}

/** Etiqueta de color con texto en mayúsculas; devuelve su ancho. */
function chip(doc, x, y, text, color, size = 6.8) {
  doc.save().font('Head').fontSize(size);
  const w = doc.widthOfString(text, { characterSpacing: 0.6 }) + 7;
  doc.rect(x, y, w, size + 4).fill(color);
  doc.fillColor(C.white).text(text, x + 3.5, y + 1.2, { characterSpacing: 0.6, lineBreak: false });
  doc.restore();
  return w;
}

function pageFooter(doc, pageNumber) {
  doc.save();
  doc.moveTo(PAGE.margin, FOOTER_Y - 6).lineTo(PAGE.margin + CONTENT_W, FOOTER_Y - 6).lineWidth(1.2).stroke(C.ink);
  doc.font('SerifItalic').fontSize(8.5).fillColor(C.muted)
    .text('Home Channel Broadcast System · Bloques de 30 minutos · Programación sujeta a cambios', PAGE.margin, FOOTER_Y, { lineBreak: false });
  const label = `PÁG. ${pageNumber}`;
  doc.font('Head').fontSize(9).fillColor(C.ink);
  doc.text(label, PAGE.margin + CONTENT_W - doc.widthOfString(label), FOOTER_Y - 1, { lineBreak: false });
  doc.restore();
}

/* ---------- Portada ---------- */

const ellipsize = (doc, text, width) => {
  if (doc.widthOfString(text) <= width) return text;
  let t = text;
  while (t.length > 1 && doc.widthOfString(`${t}…`) > width) t = t.slice(0, -1);
  return `${t.trim()}…`;
};

function coverSection(doc, x, y, width, title, color) {
  doc.rect(x, y, width, 20).fill(color);
  doc.font('Head').fontSize(10.5).fillColor(C.white).text(title, x + 8, y + 3.6, { characterSpacing: 1.2, lineBreak: false });
  return y + 28;
}

function dotted(doc, x, y, width) {
  doc.save().moveTo(x, y).lineTo(x + width, y).lineWidth(0.6).dash(1, { space: 2 }).stroke(C.faded).undash().restore();
}

/** Lista compacta: hora en color, título y una nota a la derecha. */
function compactRow(doc, x, y, width, { time, timeColor, title, note }) {
  doc.font('Head').fontSize(11).fillColor(timeColor).text(time, x, y, { lineBreak: false });
  doc.font('SerifItalic').fontSize(8.5);
  const noteW = note ? doc.widthOfString(note) : 0;
  if (note) doc.fillColor(C.muted).text(note, x + width - noteW, y + 2.5, { lineBreak: false });
  doc.font('Head').fontSize(10.5).fillColor(C.ink)
    .text(ellipsize(doc, title.toUpperCase(), width - 50 - noteW - 8), x + 46, y + 0.5, { lineBreak: false });
  dotted(doc, x, y + 16, width);
  return y + 20;
}

/** Cuadrícula del prime time: días en columnas, 18:00 a 00:30 en filas. */
const PRIME_SLOTS = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00', '22:30', '23:00', '23:30', '00:00', '00:30'];

function primeGrid(doc, week, y) {
  const x = PAGE.margin;
  const timeW = 38;
  const rowH = GRID_ROW;
  const colW = (CONTENT_W - timeW) / week.days.length;
  const top = coverSection(doc, x, y, CONTENT_W, 'PRIME TIME DE LA SEMANA', SECTIONS.primetime.color) - 8;

  // Cabecera de días
  doc.rect(x, top, CONTENT_W, 16).fill(C.ink);
  week.days.forEach((day, i) => {
    const label = `${DAY_SHORT[day.key].toUpperCase()} ${day.date.getDate()}`;
    doc.font('Head').fontSize(8.5).fillColor(i >= 5 ? C.yellow : C.paper);
    const w = doc.widthOfString(label);
    doc.text(label, x + timeW + i * colW + (colW - w) / 2, top + 3, { lineBreak: false });
  });
  const gridTop = top + 16;

  PRIME_SLOTS.forEach((t, r) => {
    const ry = gridTop + r * rowH;
    if (r % 2 === 0) doc.save().rect(x, ry, CONTENT_W, rowH).fillOpacity(0.35).fill(C.paperDark).restore();
    doc.font('Head').fontSize(8.5).fillColor(C.ink).text(t, x + 4, ry + 3.5, { lineBreak: false });
  });

  week.days.forEach((day, i) => {
    const cx = x + timeW + i * colW;
    // Celdas por entrada (las que duran varios bloques ocupan varias filas)
    const slotTime = (r) => {
      const [h, m] = PRIME_SLOTS[r].split(':').map(Number);
      const d = new Date(day.date);
      if (h < 6) d.setDate(d.getDate() + 1);
      d.setHours(h, m, 0, 0);
      return d.getTime();
    };
    let r = 0;
    while (r < PRIME_SLOTS.length) {
      const t = slotTime(r);
      const e = day.entries.find(en => en.start.getTime() <= t && en.end.getTime() > t);
      let span = 1;
      while (e && r + span < PRIME_SLOTS.length && e.end.getTime() > slotTime(r + span)) span++;
      const ry = gridTop + r * rowH;
      if (e && !e.offAir) {
        const fill = e.kind === 'premiere' ? C.yellow : (e.kind === 'marathon' ? '#f6c2df' : null);
        if (fill) doc.save().rect(cx + 1, ry + 1, colW - 2, span * rowH - 2).fill(fill).restore();
        doc.font('Head').fontSize(7.2).fillColor(C.ink);
        const lines = span > 1 ? 2 : 1;
        doc.text(e.title.toUpperCase(), cx + 3, ry + 3, { width: colW - 6, height: lines * 9, ellipsis: true, lineGap: -2 });
      }
      r += span;
    }
    doc.save().moveTo(cx, top).lineTo(cx, gridTop + PRIME_SLOTS.length * rowH).lineWidth(0.5).stroke(C.ink).restore();
  });
  const bottom = gridTop + PRIME_SLOTS.length * rowH;
  doc.save().lineWidth(1.2).rect(x, top, CONTENT_W, bottom - top).stroke(C.ink).restore();

  // Leyenda
  doc.save().rect(x, bottom + 6, 9, 9).fill(C.yellow).rect(x + 70, bottom + 6, 9, 9).fill('#f6c2df').restore();
  doc.font('SerifItalic').fontSize(8.5).fillColor(C.muted)
    .text('Estreno', x + 13, bottom + 6.5, { lineBreak: false })
    .text('Maratón', x + 83, bottom + 6.5, { lineBreak: false });
  return bottom + 20;
}

const GRID_ROW = 15;
const GRID_HEIGHT = 24 + 16 + PRIME_SLOTS.length * GRID_ROW + 20;
const INDEX_TOP = FOOTER_Y - 66;

function drawCover(doc, week) {
  const { from } = week;
  const last = week.days[week.days.length - 1].date;
  const highlights = coverHighlights(week);

  paper(doc);
  halftone(doc, PAGE.width, 0, 150, C.paperDark);
  halftone(doc, 0, PAGE.height, 170, C.paperDark);
  topStrip(doc, 'GUÍA OFICIAL DE TELEVISIÓN · EDICIÓN SEMANAL', 'BANDA C // HOME CHANNEL');

  // Logo
  const logoBox = logo(doc, PAGE.margin + 4, 84, 2.05);

  // Recuadro de edición
  const boxW = 134;
  const boxX = PAGE.margin + CONTENT_W - boxW;
  doc.save().lineWidth(2).rect(boxX, 64, boxW, 104).fillAndStroke(C.white, C.ink).restore();
  doc.font('Head').fontSize(11).fillColor(C.ink).text('Nº', boxX + 10, 74, { lineBreak: false });
  doc.fontSize(34).text(String(isoWeek(from)).padStart(3, '0'), boxX + 34, 64, { lineBreak: false });
  doc.moveTo(boxX + 10, 114).lineTo(boxX + boxW - 10, 114).lineWidth(1).stroke(C.ink);
  doc.font('HeadMedium').fontSize(8.5).fillColor(C.ink)
    .text(`SEMANA DEL ${from.getDate()} AL ${dateLong(last).toUpperCase()}`, boxX + 10, 119, { width: boxW - 20, characterSpacing: 0.6, lineGap: -1 });
  doc.font('SerifBold').fontSize(12).fillColor(C.red).text('$2.50', boxX + 10, 148, { lineBreak: false });

  let y = 84 + logoBox.height + 18;
  doc.font('SerifBoldItalic').fontSize(30).fillColor(C.ink).text('Revista de Programación', PAGE.margin, y, { lineBreak: false });
  y += 38;
  doc.font('Head').fontSize(10).fillColor(C.red)
    .text('HORARIOS COMPLETOS · ANIME RADIKAL · ANIMACIÓN ADULTA · CLÁSICOS DE CULTO', PAGE.margin, y, { characterSpacing: 1.4, lineBreak: false });
  starburst(doc, PAGE.margin + CONTENT_W - 44, y - 20, 42, C.yellow, ['¡24 HORAS', 'DE TV!'], { size: 10.5, rotate: -12 });
  y += 24;
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_W, y).lineWidth(2.5).stroke(C.ink);
  doc.moveTo(PAGE.margin, y + 4).lineTo(PAGE.margin + CONTENT_W, y + 4).lineWidth(0.8).stroke(C.ink);
  y += 16;

  // Banda: esta semana
  doc.rect(PAGE.margin, y, CONTENT_W, 32).fill(C.ink);
  doc.font('Logo').fontSize(17).fillColor(C.yellow).text('ESTA SEMANA EN HOME CHANNEL', PAGE.margin + 14, y + 6, { lineBreak: false });
  starburst(doc, PAGE.margin + CONTENT_W - 32, y + 14, 30, C.red, ['¡NO TE', 'LO', 'PIERDAS!'], { textColor: C.white, size: 7.5, rotate: 10 });
  y += 46;

  const gridTop = INDEX_TOP - 8 - GRID_HEIGHT;
  const colW = (CONTENT_W - 24) / 2;
  const leftX = PAGE.margin;
  const rightX = PAGE.margin + colW + 24;

  // Izquierda: estrenos de la semana (una línea por serie)
  let ly = coverSection(doc, leftX, y, colW, 'ESTRENOS DE LA SEMANA', SECTIONS.primetime.color);
  if (!highlights.premieres.length) {
    doc.font('SerifItalic').fontSize(10).fillColor(C.muted).text('Esta semana no hay estrenos programados.', leftX, ly, { width: colW });
  }
  const maxRows = Math.floor((gridTop - 14 - ly) / 20);
  const premieres = highlights.premieres;
  premieres.slice(0, premieres.length > maxRows ? maxRows - 1 : maxRows).forEach(p => {
    ly = compactRow(doc, leftX, ly, colW, { time: p.time, timeColor: C.red, title: p.title, note: daysLabel(p.days) });
  });
  if (premieres.length > maxRows) {
    doc.font('SerifItalic').fontSize(9).fillColor(C.muted).text(`y ${premieres.length - maxRows + 1} estrenos más en las páginas de cada día.`, leftX, ly + 2, { lineBreak: false });
  }

  // Derecha: maratones e índice
  let ry = coverSection(doc, rightX, y, colW, 'MARATONES DEL FIN DE SEMANA', C.pink);
  if (!highlights.marathons.length) {
    doc.font('SerifItalic').fontSize(10).fillColor(C.muted).text('Sin maratones esta semana.', rightX, ry, { width: colW });
    ry += 20;
  }
  const maxMarathons = Math.max(0, Math.floor((gridTop - 14 - ry) / 20));
  const marathons = highlights.marathons;
  for (const m of marathons.slice(0, marathons.length > maxMarathons ? maxMarathons - 1 : maxMarathons)) {
    ry = compactRow(doc, rightX, ry, colW, {
      time: m.startLabel,
      timeColor: C.pink,
      title: m.title,
      note: `${DAY_SHORT[m.day]} · ${m.episodes} cap.`
    });
  }
  if (marathons.length > maxMarathons) {
    doc.font('SerifItalic').fontSize(9).fillColor(C.muted).text(`y ${marathons.length - maxMarathons + 1} maratones más dentro de la revista.`, rightX, ry + 2, { lineBreak: false });
  }

  primeGrid(doc, week, gridTop);
  return { indexY: INDEX_TOP };
}

/** Índice de la portada en una franja (se dibuja al final, cuando se conocen las páginas). */
function drawIndex(doc, { indexY }, pages) {
  const x = PAGE.margin;
  const h = 26;
  doc.save().lineWidth(1.5).rect(x, indexY, CONTENT_W, h).fillAndStroke(C.white, C.ink).restore();
  doc.rect(x, indexY, 96, h).fill(C.ink);
  doc.font('Head').fontSize(9).fillColor(C.yellow).text('EN ESTA EDICIÓN', x + 9, indexY + 7.5, { characterSpacing: 1, lineBreak: false });
  const cellW = (CONTENT_W - 96) / pages.length;
  pages.forEach(({ day, page }, i) => {
    const cx = x + 96 + i * cellW;
    if (i) doc.save().moveTo(cx, indexY + 5).lineTo(cx, indexY + h - 5).lineWidth(0.6).stroke(C.faded).restore();
    const name = `${DAY_SHORT[day.key].toUpperCase()} ${day.date.getDate()}`;
    doc.font('Head').fontSize(9.5).fillColor(C.ink);
    const nw = doc.widthOfString(name);
    const label = ` · p. ${page}`;
    doc.font('SerifItalic').fontSize(8.5);
    const lw = doc.widthOfString(label);
    const start = cx + (cellW - nw - lw) / 2;
    doc.font('Head').fontSize(9.5).fillColor(C.ink).text(name, start, indexY + 7, { lineBreak: false });
    doc.font('SerifItalic').fontSize(8.5).fillColor(C.muted).text(label, start + nw, indexY + 8.3, { lineBreak: false });
  });
  // Pie de portada
  barcode(doc, PAGE.margin, FOOTER_Y - 26, 110, 24, 1999);
  doc.font('SerifItalic').fontSize(9).fillColor(C.muted)
    .text('Home Channel Broadcast System · Transmisión satelital 24/7 · Audio estéreo MTS', PAGE.margin + 122, FOOTER_Y - 12, { lineBreak: false });
  doc.font('Head').fontSize(9).fillColor(C.ink).text('PÁG. 1', PAGE.margin + CONTENT_W - 30, FOOTER_Y - 12, { lineBreak: false });
}

/* ---------- Páginas de cada día ---------- */

function dayHeader(doc, day, continued) {
  paper(doc);
  halftone(doc, PAGE.width, 0, 90, C.paperDark);
  topStrip(doc, `TELEGUÍA · PROGRAMACIÓN DEL ${DAY_NAMES[day.key].toUpperCase()}`, 'HOME CHANNEL // CH-01');

  const y = 58;
  doc.font('Logo').fontSize(23);
  const name = DAY_NAMES[day.key].toUpperCase();
  const w = doc.widthOfString(name) + 20;
  doc.rect(PAGE.margin + 3, y + 3, w, 34).fill(C.ink);
  doc.rect(PAGE.margin, y, w, 34).fill(C.red);
  doc.fillColor(C.white).text(name, PAGE.margin + 10, y + 3, { lineBreak: false });

  const tx = PAGE.margin + w + 16;
  doc.font('Head').fontSize(17).fillColor(C.ink).text(dateLong(day.date).toUpperCase(), tx, y - 1, { lineBreak: false });
  const next = DAY_NAMES[WEEK_ORDER[(WEEK_ORDER.indexOf(day.key) + 1) % 7]].toLowerCase();
  doc.font('SerifItalic').fontSize(9).fillColor(C.muted)
    .text(continued ? 'Continuación' : `De las 06:00 a las 06:00 del ${next}. La madrugada aparece en el día en que empieza.`, tx, y + 22, { lineBreak: false });
  return y + 46;
}

/** Recuadro "No te lo pierdas" con el destacado del día. */
function featureBox(doc, y, entry) {
  const h = 50;
  doc.rect(PAGE.margin, y, CONTENT_W, h).fill(C.ink);
  doc.rect(PAGE.margin, y + h, CONTENT_W, 4).fill(C.red);
  doc.font('Head').fontSize(24).fillColor(C.yellow).text(entry.startLabel, PAGE.margin + 14, y + 4, { lineBreak: false });
  doc.font('HeadMedium').fontSize(8.5).fillColor(C.paper).text(`a ${entry.endLabel}`, PAGE.margin + 16, y + 35, { lineBreak: false });
  const x = PAGE.margin + 100;
  doc.moveTo(x - 12, y + 10).lineTo(x - 12, y + h - 10).lineWidth(1).stroke('#5c5446');
  const kicker = entry.kind === 'marathon' ? 'MARATÓN DEL DÍA' : (entry.start.getHours() >= 18 ? 'NO TE LO PIERDAS ESTA NOCHE' : 'NO TE LO PIERDAS');
  doc.font('Head').fontSize(8.5).fillColor(C.yellow).text(kicker, x, y + 8, { characterSpacing: 2, lineBreak: false });
  doc.font('SerifBoldItalic').fontSize(19).fillColor(C.paper)
    .text(entry.title, x, y + 21, { width: CONTENT_W - 190, height: 26, ellipsis: true, lineBreak: false });
  const burst = entry.kind === 'premiere' ? ['¡ESTRENO!'] : (entry.kind === 'marathon' ? ['¡MARATÓN!'] : ['¡HOY!']);
  starburst(doc, PAGE.margin + CONTENT_W - 34, y + h / 2, 30, C.red, burst, { textColor: C.white, size: 8.5, rotate: 8 });
  return y + h + 14;
}

class Columns {
  constructor(doc, top, onNewPage) {
    this.doc = doc;
    this.top = top;
    this.gap = 18;
    this.width = (CONTENT_W - this.gap) / 2;
    this.col = 0;
    this.y = top;
    this.bottom = FOOTER_Y - 14;
    this.onNewPage = onNewPage;
    this.drawRule();
  }

  get x() {
    return PAGE.margin + this.col * (this.width + this.gap);
  }

  drawRule() {
    const x = PAGE.margin + this.width + this.gap / 2;
    this.doc.save().moveTo(x, this.top).lineTo(x, this.bottom).lineWidth(0.8).stroke(C.ink).restore();
  }

  ensure(height) {
    if (this.y + height <= this.bottom) return;
    if (this.col === 0) {
      this.col = 1;
      this.y = this.top;
      return;
    }
    this.top = this.onNewPage();
    this.col = 0;
    this.y = this.top;
    this.drawRule();
  }
}

function sectionBand(doc, cols, key) {
  const sec = SECTIONS[key];
  cols.ensure(44);
  const { x } = cols;
  doc.rect(x, cols.y, cols.width, 17).fill(sec.color);
  doc.font('Head').fontSize(9.5).fillColor(C.white).text(sec.label.toUpperCase(), x + 7, cols.y + 3, { characterSpacing: 1.4, lineBreak: false });
  doc.font('HeadMedium').fontSize(7.5);
  const w = doc.widthOfString(sec.range);
  doc.text(sec.range, x + cols.width - 7 - w, cols.y + 4.5, { lineBreak: false });
  cols.y += 22;
}

function listing(doc, cols, e) {
  const timeW = 36;
  const bodyW = cols.width - timeW - 2;
  const title = e.title.toUpperCase();
  doc.font('Head').fontSize(10.5);
  const titleH = doc.heightOfString(title, { width: bodyW, lineGap: -3 });
  const height = titleH + 15;
  cols.ensure(height);
  const { x, y } = cols;
  const ink = e.offAir ? C.faded : C.ink;

  doc.font('Head').fontSize(11).fillColor(e.kind === 'premiere' ? C.red : ink).text(e.startLabel, x, y, { lineBreak: false });

  // Marcador fosforescente detrás de los estrenos
  if (e.kind === 'premiere') {
    const firstLineW = Math.min(bodyW, doc.font('Head').fontSize(10.5).widthOfString(title));
    doc.save().fillColor(C.yellow).fillOpacity(0.85).rect(x + timeW - 2, y + 1.5, firstLineW + 5, 11.5).fill().restore();
  }
  doc.font('Head').fontSize(10.5).fillColor(ink).text(title, x + timeW + 1, y - 0.5, { width: bodyW, lineGap: -3 });

  // Línea de datos: género, tipo y duración
  let mx = x + timeW + 1;
  const my = y + titleH + 1;
  mx += chip(doc, mx, my, e.genre.text.toUpperCase(), e.genre.color, 6) + 3;
  const kind = KIND_CHIPS[e.kind];
  if (kind) {
    const text = e.kind === 'marathon' ? `${kind.text} · ${e.slots} CAP.` : kind.text;
    mx += chip(doc, mx, my, text, kind.color, 6) + 3;
  }
  const meta = e.offAir
    ? `Carta de ajuste hasta las ${e.endLabel}`
    : `${e.minutes} min · hasta las ${e.endLabel}${e.kind === 'repeat' ? ' · Repetición' : ''}`;
  doc.font('SerifItalic').fontSize(7.8).fillColor(e.offAir ? C.faded : C.muted).text(meta, mx, my + 0.3, { lineBreak: false });

  cols.y += height;
  dotted(doc, x, cols.y - 3.5, cols.width);
}

function drawDay(doc, day, pageNumbers) {
  doc.addPage();
  pageNumbers.push(doc.bufferedPageRange().count);
  let y = dayHeader(doc, day, false);
  if (day.feature) y = featureBox(doc, y, day.feature);

  if (!day.entries.length) {
    doc.font('SerifItalic').fontSize(13).fillColor(C.muted).text('No hay programación registrada para este día.', PAGE.margin, y + 20);
    return;
  }
  const cols = new Columns(doc, y, () => {
    doc.addPage();
    return dayHeader(doc, day, true);
  });
  let lastSection = null;
  for (const e of day.entries) {
    if (e.section !== lastSection) {
      lastSection = e.section;
      sectionBand(doc, cols, e.section);
    }
    listing(doc, cols, e);
  }
}

/**
 * Escribe el PDF de la semana en `stream`.
 * @param {{ from, to, days }} week - de buildWeekGuide
 * @param {import('stream').Writable} stream
 */
function renderGuidePdf(week, stream) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
    info: {
      Title: `TV Guide — Semana del ${dateLong(week.from)}`,
      Author: 'Home Channel',
      Subject: 'Programación semanal del canal Home Channel'
    }
  });
  registerFonts(doc);
  doc.pipe(stream);

  const indexSpot = drawCover(doc, week);
  const firstPages = [];
  for (const day of week.days) drawDay(doc, day, firstPages);

  // Índice de la portada y números de página
  const range = doc.bufferedPageRange();
  doc.switchToPage(0);
  drawIndex(doc, indexSpot, week.days.map((day, i) => ({ day, page: firstPages[i] })));
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(i);
    pageFooter(doc, i + 1);
  }
  doc.end();
  return doc;
}

module.exports = { renderGuidePdf, daysLabel, isoWeek };
