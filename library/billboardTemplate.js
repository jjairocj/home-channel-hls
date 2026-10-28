/**
 * Home Channel HLS - Plantilla SVG de la "Cartelera de hoy" para quemar en el video.
 *
 * Es la misma cartelera que la web dibuja sobre el televisor durante el relleno
 * sincronizador, pero a pantalla completa para que también se vea en Smart TV, M3U e
 * IPTV: lo que sigue y los próximos programas con su hora.
 */

const { escapeXml } = require('./nextUpTemplate');

const FONT = 'DejaVu Sans, Arial, Helvetica, sans-serif';
const MONO = 'DejaVu Sans Mono, Courier New, monospace';
const MAX_TITLE_CHARS = 38;

const BADGES = {
  next: { text: 'A CONTINUACIÓN', fill: '#00ffff', color: '#000000', accent: '#00ffff', rowFill: '#00ffff', rowOpacity: 0.12 },
  later: { text: 'PRÓXIMO', fill: '#26324d', color: '#cfe0ff', accent: '#3d5a99', rowFill: '#ffffff', rowOpacity: 0.04 },
  off: { text: 'CIERRE', fill: '#3a4566', color: '#cfd8ee', accent: '#7e8eb5', rowFill: '#ffffff', rowOpacity: 0.03 }
};

function shorten(text, max = MAX_TITLE_CHARS) {
  const t = String(text || '').trim();
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
}

/**
 * @param {Object} data
 * @param {Array<{ time: string, title: string, offAir?: boolean }>} data.entries - el primero es lo que sigue
 * @param {string} [data.channelBrand]
 * @param {string} [data.dateLabel] - p. ej. "LUNES 20 OCT"
 */
function renderBillboardSvg({ entries, channelBrand = (process.env.CHANNEL_NAME || 'Home Channel'), dateLabel = '' }) {
  const rows = entries.slice(0, 4);
  const top = 300;
  const rowH = 150;

  const rowsSvg = rows.map((e, i) => {
    const kind = e.offAir ? 'off' : (i === 0 ? 'next' : 'later');
    const b = BADGES[kind];
    const y = top + i * rowH;
    const title = e.offAir ? 'Cierre de emisión' : e.title;
    const badgeW = b.text.length * 17 + 40;
    return `
  <rect x="160" y="${y}" width="1600" height="${rowH - 22}" fill="${b.rowFill}" fill-opacity="${b.rowOpacity}" />
  <rect x="160" y="${y}" width="10" height="${rowH - 22}" fill="${b.accent}" />
  <text x="210" y="${y + 84}" fill="${e.offAir ? '#7e8eb5' : '#40ff40'}" font-family="${MONO}" font-size="${e.time.length > 5 ? 46 : 64}" font-weight="bold">${escapeXml(e.time)}</text>
  <text x="470" y="${y + 66}" fill="${e.offAir ? '#9cb0d8' : '#ffffff'}" font-family="${FONT}" font-size="50" font-weight="bold">${escapeXml(shorten(title).toUpperCase())}</text>
  <rect x="470" y="${y + 84}" width="${badgeW}" height="34" rx="3" fill="${b.fill}" />
  <text x="490" y="${y + 109}" fill="${b.color}" font-family="${FONT}" font-size="22" font-weight="bold" letter-spacing="2">${b.text}</text>`;
  }).join('');

  return `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
<defs>
  <pattern id="scanlines" width="100" height="4" patternUnits="userSpaceOnUse">
    <line x1="0" y1="0" x2="100" y2="0" stroke="#000000" stroke-width="1.5" stroke-opacity="0.35" />
  </pattern>
  <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0d1b3a" />
    <stop offset="1" stop-color="#05070f" />
  </linearGradient>
</defs>

<!-- Panel oscuro sobre el arte de fondo -->
<rect x="0" y="0" width="1920" height="1080" fill="url(#glow)" fill-opacity="0.97" />
<rect x="0" y="0" width="1920" height="1080" fill="url(#scanlines)" />

<!-- Cabecera: marca del canal y título -->
<rect x="160" y="110" width="250" height="56" fill="#ff0055" rx="3" />
<text x="182" y="150" fill="#ffffff" font-family="${FONT}" font-size="32" font-weight="bold">${escapeXml(channelBrand)}</text>
<text x="440" y="152" fill="#ffcc00" font-family="${MONO}" font-size="54" font-weight="bold" letter-spacing="4">CARTELERA DE HOY</text>
${dateLabel ? `<text x="1760" y="150" text-anchor="end" fill="#a0b0d0" font-family="${FONT}" font-size="28" font-weight="bold">${escapeXml(dateLabel)}</text>` : ''}
<line x1="160" y1="210" x2="1760" y2="210" stroke="#00ffff" stroke-width="4" />
<line x1="160" y1="218" x2="1760" y2="218" stroke="#ff0055" stroke-width="2" />
<text x="160" y="262" fill="#a0b0d0" font-family="${FONT}" font-size="26" font-weight="bold" letter-spacing="2">QUÉDATE EN SINTONÍA · CH-99</text>
${rowsSvg}

<!-- Pie -->
<text x="160" y="${top + rows.length * rowH + 40}" fill="#667799" font-family="${FONT}" font-size="22" font-weight="bold">${escapeXml(channelBrand)} // TV RADIKAL • BLOQUES DE 30 MINUTOS • AUDIO MTS STEREO</text>
</svg>`;
}

module.exports = { renderBillboardSvg };
