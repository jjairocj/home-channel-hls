/**
 * Home Channel - Plantilla SVG del cuadro "lo que sigue" (Lower Third).
 *
 * Estética Windows Aero Glass con esquinas redondeadas suaves, resplandor aurora,
 * brillo especular superior y pastilla de hora integrada en la fila superior,
 * permitiendo ajuste automático a dos líneas para títulos largos.
 */

const { escapeXml } = require('./nextUpTemplate');

const DESIGN = { width: 840, height: 180 };
const WIDTH = 740;
const HEIGHT = 155;
const FONT = 'DejaVu Sans, Segoe UI, Arial, sans-serif';
const MONO = 'DejaVu Sans Mono, monospace';

const TAGS = {
  'ESTRENO': { fill: 'url(#tagAeroRuby)', stroke: '#ff6b8b', color: '#ffffff' },
  'REPETICIÓN': { fill: 'url(#tagAeroSlate)', stroke: '#6090b8', color: '#d0e4f8' },
  'OTRO CAPÍTULO': { fill: 'url(#tagAeroCyan)', stroke: '#80e5ff', color: '#ffffff' }
};

const tagStyle = (tag) => {
  if (!tag) return null;
  if (TAGS[tag]) return TAGS[tag];
  if (tag.startsWith('MARATÓN')) return { fill: 'url(#tagAeroPurple)', stroke: '#d580ff', color: '#ffffff' };
  return { fill: 'url(#tagAeroSlate)', stroke: '#6090b8', color: '#d0e4f8' };
};

/** Divide títulos largos (>22 caracteres) en dos líneas balanceadas por palabras */
function splitTitleTwoLines(title) {
  const words = String(title || '').toUpperCase().trim().split(/\s+/);
  if (words.length <= 1) return [title, null];

  let bestDiff = Infinity;
  let bestIdx = 1;
  const fullLen = title.length;
  let currentLen = 0;
  for (let i = 0; i < words.length - 1; i++) {
    currentLen += words[i].length + (i > 0 ? 1 : 0);
    const restLen = fullLen - currentLen;
    const diff = Math.abs(currentLen - restLen);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i + 1;
    }
  }
  return [
    words.slice(0, bestIdx).join(' '),
    words.slice(bestIdx).join(' ')
  ];
}

/**
 * @param {Object} card
 * @param {string} card.label - "MÁS TARDE EN Home Channel", "A CONTINUACIÓN"…
 * @param {string|null} card.time - "7:30 PM"
 * @param {string} card.title - nombre de la serie
 * @param {string|null} card.tag - ESTRENO, REPETICIÓN, MARATÓN…, OTRO CAPÍTULO
 * @param {string|null} card.sub - línea secundaria opcional ("Después: 8:00 PM...")
 * @param {number} [opacity] - factor de opacidad para fundidos (0..1)
 */
function renderLowerThirdSvg({ label, time, title, tag, sub }, opacity = 1) {
  const rawTitle = String(title || '').toUpperCase().trim();
  const isLong = rawTitle.length > 22;
  const [line1, line2] = isLong ? splitTitleTwoLines(rawTitle) : [rawTitle, null];

  const labelX = 36;
  const tagW = tag ? Math.round(tag.length * 15.2) + 28 : 0;
  const tagX = 804 - tagW;
  const style = tagStyle(tag);

  // Pastilla de hora integrada en la barra superior
  const timeW = time ? Math.round(time.length * 13) + 20 : 0;
  const timeX = 36 + Math.round(label.length * 14.5) + 18;

  // Cálculo de tipografía y posiciones del título
  let titleY1 = 114;
  let titleY2 = null;
  let fontSize = 38;

  if (line2) {
    if (sub) {
      fontSize = 28;
      titleY1 = 92;
      titleY2 = 124;
    } else {
      fontSize = 32;
      titleY1 = 100;
      titleY2 = 138;
    }
  } else {
    fontSize = Math.min(42, Math.max(34, Math.floor(750 / (rawTitle.length * 0.75))));
    titleY1 = sub ? 110 : 124;
  }

  const glassOpacity = 0.68 * opacity;

  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${DESIGN.width} ${DESIGN.height}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <!-- Cristal Aero Glass Translúcido (~68%) -->
  <linearGradient id="aeroGlassBg" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#091c38" stop-opacity="${(glassOpacity * 0.95).toFixed(2)}" />
    <stop offset="50%" stop-color="#051324" stop-opacity="${(glassOpacity * 0.90).toFixed(2)}" />
    <stop offset="100%" stop-color="#020814" stop-opacity="${(glassOpacity * 0.98).toFixed(2)}" />
  </linearGradient>

  <!-- Reflejo Especular Superior (Gloss Sheen Arc) -->
  <linearGradient id="aeroGloss" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="${(0.38 * opacity).toFixed(2)}" />
    <stop offset="35%" stop-color="#ffffff" stop-opacity="${(0.14 * opacity).toFixed(2)}" />
    <stop offset="85%" stop-color="#ffffff" stop-opacity="${(0.02 * opacity).toFixed(2)}" />
    <stop offset="100%" stop-color="#ffffff" stop-opacity="0.0" />
  </linearGradient>

  <!-- Borde Iluminado de Cristal -->
  <linearGradient id="aeroBorder" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="${(0.85 * opacity).toFixed(2)}" />
    <stop offset="30%" stop-color="#8ce4ff" stop-opacity="${(0.65 * opacity).toFixed(2)}" />
    <stop offset="70%" stop-color="#3088cc" stop-opacity="${(0.45 * opacity).toFixed(2)}" />
    <stop offset="100%" stop-color="#104477" stop-opacity="${(0.35 * opacity).toFixed(2)}" />
  </linearGradient>

  <!-- Resplandor Ambiental Aurora -->
  <radialGradient id="auroraGlow" cx="20%" cy="25%" r="75%">
    <stop offset="0%" stop-color="#00d2ff" stop-opacity="${(0.30 * opacity).toFixed(2)}" />
    <stop offset="45%" stop-color="#0066bb" stop-opacity="${(0.10 * opacity).toFixed(2)}" />
    <stop offset="100%" stop-color="#001830" stop-opacity="0.0" />
  </radialGradient>

  <!-- Pilar de Luz Lateral Cian -->
  <linearGradient id="aeroCyanBar" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#70f0ff" />
    <stop offset="50%" stop-color="#00c0f0" />
    <stop offset="100%" stop-color="#0066cc" />
  </linearGradient>

  <!-- Pastilla de Hora en Cristal -->
  <linearGradient id="timePillGlass" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#0f345e" stop-opacity="${(0.85 * opacity).toFixed(2)}" />
    <stop offset="100%" stop-color="#07192e" stop-opacity="${(0.90 * opacity).toFixed(2)}" />
  </linearGradient>

  <!-- Degradados de Distintivos -->
  <linearGradient id="tagAeroRuby" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#e82458" />
    <stop offset="100%" stop-color="#990b30" />
  </linearGradient>
  <linearGradient id="tagAeroCyan" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#00c8f8" />
    <stop offset="100%" stop-color="#0072aa" />
  </linearGradient>
  <linearGradient id="tagAeroSlate" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#2c4464" />
    <stop offset="100%" stop-color="#152438" />
  </linearGradient>
  <linearGradient id="tagAeroPurple" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#aa38ee" />
    <stop offset="100%" stop-color="#6a14a0" />
  </linearGradient>
  <linearGradient id="tagGloss" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="${(0.45 * opacity).toFixed(2)}" />
    <stop offset="50%" stop-color="#ffffff" stop-opacity="${(0.05 * opacity).toFixed(2)}" />
    <stop offset="100%" stop-color="#ffffff" stop-opacity="0.0" />
  </linearGradient>
</defs>

<g opacity="${opacity}">
  <!-- Panel de Cristal con Bordes Suaves -->
  <rect x="4" y="4" width="832" height="172" rx="16" ry="16" fill="url(#aeroGlassBg)" stroke="url(#aeroBorder)" stroke-width="1.6" />
  
  <!-- Resplandor Aurora -->
  <rect x="5" y="5" width="830" height="170" rx="15" ry="15" fill="url(#auroraGlow)" />

  <!-- Brillo Especular Superior -->
  <path d="M 5,20 Q 5,5 20,5 L 820,5 Q 835,5 835,20 L 835,74 C 650,85 420,90 5,74 Z" fill="url(#aeroGloss)" />

  <!-- Pilar de Luz Lateral Cian -->
  <rect x="14" y="16" width="6" height="148" rx="3" fill="url(#aeroCyanBar)" />
  <rect x="15" y="18" width="2" height="144" rx="1" fill="#ffffff" fill-opacity="${(0.65 * opacity).toFixed(2)}" />

  <!-- Fila 1: Etiqueta del bloque -->
  <text x="${labelX}" y="45" fill="#8fe5ff" font-family="${FONT}" font-size="20" font-weight="bold" letter-spacing="1.2">${escapeXml(label)}</text>

  <!-- Fila 1: Pastilla de Hora Integrada -->
  ${time ? `
    <g transform="translate(${timeX}, 23)">
      <rect x="0" y="0" width="${timeW}" height="28" rx="7" fill="url(#timePillGlass)" stroke="#64c4ff" stroke-opacity="${(0.6 * opacity).toFixed(2)}" stroke-width="1.2" />
      <rect x="2" y="2" width="${timeW - 4}" height="12" rx="5" fill="#ffffff" fill-opacity="${(0.14 * opacity).toFixed(2)}" />
      <text x="${Math.round(timeW / 2)}" y="20" fill="#a8f5ff" font-family="${MONO}" font-size="18" font-weight="bold" text-anchor="middle">${escapeXml(time)}</text>
    </g>
  ` : ''}

  <!-- Fila 1: Distintivo de transmisión -->
  ${tag ? `
    <g transform="translate(${tagX}, 20)">
      <rect x="0" y="0" width="${tagW}" height="32" rx="8" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.2" />
      <path d="M 1,8 Q 1,1 8,1 L ${tagW - 8},1 Q ${tagW - 1},1 ${tagW - 1},8 L ${tagW - 1},14 L 1,14 Z" fill="url(#tagGloss)" />
      <text x="${Math.round(tagW / 2)}" y="22" fill="${style.color}" font-family="${FONT}" font-size="18" font-weight="bold" letter-spacing="0.8" text-anchor="middle">${escapeXml(tag)}</text>
    </g>
  ` : ''}

  <!-- Fila 2: Título de la Serie (Hasta 2 líneas balanceadas) -->
  ${line2 ? `
    <text x="36" y="${titleY1}" fill="#ffffff" font-family="${FONT}" font-size="${fontSize}" font-weight="bold">${escapeXml(line1)}</text>
    <text x="36" y="${titleY2}" fill="#ffffff" font-family="${FONT}" font-size="${fontSize}" font-weight="bold">${escapeXml(line2)}</text>
  ` : `
    <text x="36" y="${titleY1}" fill="#ffffff" font-family="${FONT}" font-size="${fontSize}" font-weight="bold">${escapeXml(line1)}</text>
  `}

  <!-- Línea Secundaria Opcional ("Después: ...") -->
  ${sub ? `<text x="36" y="160" fill="#b0d4f4" font-family="${FONT}" font-size="20" font-weight="bold">${escapeXml(sub)}</text>` : ''}
</g>
</svg>`;
}

module.exports = { renderLowerThirdSvg, LOWER_THIRD_SIZE: { width: WIDTH, height: HEIGHT } };
