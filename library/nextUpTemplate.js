/**
 * Home Channel - Plantilla SVG de la cortinilla "A continuación" (Next Up Bumper).
 *
 * Estética Windows Aero Glass con ventana flotante translúcida (~72% de opacidad),
 * esquinas redondeadas suaves (rx=22), resplandor aurora, brillo especular superior,
 * ajuste adaptativo multilínea para títulos largos y eslogan oficial de la marca.
 */

function escapeXml(unsafe) {
  return String(unsafe || '').replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

const FONT = 'DejaVu Sans, Segoe UI, Arial, Helvetica, sans-serif';
const MONO = 'DejaVu Sans Mono, Courier New, monospace';

/**
 * División balanceada de títulos para pantalla completa
 */
function splitTitleLines(title) {
  const clean = String(title || 'Home Channel Broadcast').trim();

  // Si tiene separador de saga (: o - o &), dividir elegantemente
  if (clean.includes(':') || clean.includes(' - ') || clean.includes('&')) {
    const parts = clean.split(/[:\-&]+/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        line1: parts[0],
        line2: parts.slice(1).join(' • ')
      };
    }
  }

  // Si es largo (> 24 letras), balancear palabras en dos líneas
  if (clean.length > 24) {
    const words = clean.split(/\s+/);
    let mid = Math.ceil(words.length / 2);
    return {
      line1: words.slice(0, mid).join(' '),
      line2: words.slice(mid).join(' ')
    };
  }

  return { line1: clean, line2: '' };
}

/**
 * Renderiza el SVG en resolución 1920x1080 con ventana flotante Aero Glass.
 *
 * @param {Object} opts
 * @param {string} opts.showTitle - Título del programa o bloque
 * @param {string} opts.episodeTitle - Título o número del capítulo
 * @param {string} opts.startTime - Hora de emisión (ej. "19:30 HS" o "07:30 PM")
 * @param {string} [opts.scheduleInfo] - Información de horario de la serie
 * @param {string} [opts.categoryInfo] - Bloque o franja temática
 * @param {string} [opts.channelBrand] - Nombre de la marca (Home Channel)
 * @param {string} [opts.slogan] - Eslogan oficial del canal
 */
function renderNextUpSvg({
  showTitle,
  episodeTitle,
  startTime,
  scheduleInfo,
  categoryInfo,
  channelBrand = 'Home Channel',
  slogan = 'Más que dibujos... historias que marcan'
}) {
  const { line1, line2 } = splitTitleLines(showTitle);
  const cleanEp = (episodeTitle && episodeTitle !== showTitle)
    ? String(episodeTitle).trim()
    : 'Emisión Regular';

  // Subtítulo de episodio con wrap a dos líneas si es extenso
  let epLine1 = cleanEp;
  let epLine2 = null;
  if (cleanEp.length > 36) {
    const epWords = cleanEp.split(/\s+/);
    const mid = Math.ceil(epWords.length / 2);
    epLine1 = epWords.slice(0, mid).join(' ');
    epLine2 = epWords.slice(mid).join(' ');
  }

  const effectiveSchedule = scheduleInfo || (startTime ? `Lunes a Viernes • ${startTime}` : 'Lunes a Viernes • Horario Estelar');
  const effectiveCategory = categoryInfo || 'Franja Animación • Emisión Continua';

  return `<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
<defs>
  <!-- Cristal Base Aero Glass (~72% de opacidad) -->
  <linearGradient id="aeroWinBg" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#081d38" stop-opacity="0.75" />
    <stop offset="45%" stop-color="#051426" stop-opacity="0.70" />
    <stop offset="100%" stop-color="#020814" stop-opacity="0.80" />
  </linearGradient>

  <!-- Reflejo Especular Superior (Gloss Sheen Arc) -->
  <linearGradient id="aeroWinGloss" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.36" />
    <stop offset="35%" stop-color="#ffffff" stop-opacity="0.12" />
    <stop offset="85%" stop-color="#ffffff" stop-opacity="0.02" />
    <stop offset="100%" stop-color="#ffffff" stop-opacity="0.0" />
  </linearGradient>

  <!-- Borde Iluminado de Cristal -->
  <linearGradient id="aeroWinBorder" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85" />
    <stop offset="25%" stop-color="#70e0ff" stop-opacity="0.65" />
    <stop offset="70%" stop-color="#2580c8" stop-opacity="0.45" />
    <stop offset="100%" stop-color="#104070" stop-opacity="0.35" />
  </linearGradient>

  <!-- Resplandor Ambiental Aurora -->
  <radialGradient id="aeroAurora" cx="25%" cy="20%" r="75%">
    <stop offset="0%" stop-color="#00d2ff" stop-opacity="0.25" />
    <stop offset="50%" stop-color="#0055bb" stop-opacity="0.08" />
    <stop offset="100%" stop-color="#001830" stop-opacity="0.0" />
  </radialGradient>

  <!-- Pastilla de Hora en Cristal -->
  <linearGradient id="timePill" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#0e3a66" stop-opacity="0.90" />
    <stop offset="100%" stop-color="#06182c" stop-opacity="0.95" />
  </linearGradient>

  <!-- Tarjeta Interior de Cristal Esmerilado (Frosted Card) -->
  <linearGradient id="frostedCard" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.10" />
    <stop offset="100%" stop-color="#ffffff" stop-opacity="0.03" />
  </linearGradient>

  <!-- Sombra Suave de la Ventana Flotante -->
  <filter id="winShadow" x="-5%" y="-5%" width="115%" height="115%">
    <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000000" flood-opacity="0.85" />
  </filter>
</defs>

<!-- VENTANA FLOTANTE AERO GLASS -->
<g filter="url(#winShadow)" transform="translate(80, 60)">
  <!-- Marco de Cristal con Esquinas Redondeadas Suaves -->
  <rect x="0" y="0" width="940" height="960" rx="22" ry="22" fill="url(#aeroWinBg)" stroke="url(#aeroWinBorder)" stroke-width="1.8" />
  
  <!-- Resplandor de Color Aurora -->
  <rect x="1" y="1" width="938" height="958" rx="21" ry="21" fill="url(#aeroAurora)" />

  <!-- Arco de Brillo Especular Superior -->
  <path d="M 0,26 Q 0,0 26,0 L 914,0 Q 940,0 940,26 L 940,320 C 700,360 250,360 0,320 Z" fill="url(#aeroWinGloss)" />

  <!-- Pilar de Luz Lateral Cian -->
  <rect x="16" y="24" width="7" height="912" rx="3.5" fill="#00e5ff" />
  <rect x="18" y="26" width="3" height="908" rx="1.5" fill="#ffffff" fill-opacity="0.75" />

  <!-- ==================== BARRA DE CABECERA ==================== -->
  <!-- Distintivo de Marca Home Channel -->
  <g transform="translate(48, 40)">
    <rect x="0" y="0" width="130" height="42" rx="10" fill="#004e8c" fill-opacity="0.85" stroke="#60d0ff" stroke-width="1.2" />
    <rect x="2" y="2" width="126" height="18" rx="8" fill="#ffffff" fill-opacity="0.18" />
    <text x="65" y="29" fill="#ffffff" font-family="${FONT}" font-size="24" font-weight="bold" letter-spacing="2" text-anchor="middle">${escapeXml(channelBrand)}</text>
  </g>

  <!-- Indicador de Emisión en Vivo -->
  <g transform="translate(730, 48)">
    <circle cx="10" cy="14" r="6" fill="#00ff66" />
    <circle cx="10" cy="14" r="10" fill="#00ff66" fill-opacity="0.25" />
    <text x="30" y="21" fill="#a0e5ff" font-family="${FONT}" font-size="16" font-weight="bold" letter-spacing="1.5">EN EMISIÓN</text>
  </g>

  <!-- Separador Superior -->
  <line x1="48" y1="105" x2="890" y2="105" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1" />

  <!-- ==================== HORA & A CONTINUACIÓN ==================== -->
  <g transform="translate(48, 140)">
    <!-- Pastilla de Hora -->
    <rect x="0" y="0" width="190" height="52" rx="12" fill="url(#timePill)" stroke="#40b8ff" stroke-width="1.4" />
    <rect x="2" y="2" width="186" height="22" rx="10" fill="#ffffff" fill-opacity="0.12" />
    <text x="95" y="36" fill="#99f5ff" font-family="${MONO}" font-size="28" font-weight="bold" text-anchor="middle">${escapeXml(startTime)}</text>

    <!-- Rótulo A Continuación -->
    <text x="220" y="37" fill="#8fe5ff" font-family="${FONT}" font-size="28" font-weight="bold" letter-spacing="2">▶ A CONTINUACIÓN</text>
  </g>

  <!-- ==================== TÍTULO DE LA SERIE ==================== -->
  <g transform="translate(48, 270)">
    <text x="0" y="0" fill="#ffffff" font-family="${FONT}" font-size="${line2 ? 46 : 52}" font-weight="bold">${escapeXml(line1.toUpperCase())}</text>
    ${line2 ? `<text x="0" y="60" fill="#6fe2ff" font-family="${FONT}" font-size="38" font-weight="bold">${escapeXml(line2.toUpperCase())}</text>` : ''}
  </g>

  <!-- Línea Divisoria con Resplandor Cian -->
  <line x1="48" y1="${line2 ? 375 : 315}" x2="890" y2="${line2 ? 375 : 315}" stroke="#00d2ff" stroke-opacity="0.5" stroke-width="1.5" />

  <!-- ==================== CAPÍTULO PRÓXIMO ==================== -->
  <g transform="translate(48, ${line2 ? 415 : 355})">
    <text x="4" y="0" fill="#90d8ff" font-family="${FONT}" font-size="20" font-weight="bold" letter-spacing="1.5">CAPÍTULO EN PANTALLA:</text>
    
    <!-- Tarjeta de Cristal Esmerilado para el Capítulo -->
    <g transform="translate(0, 16)">
      <rect x="0" y="0" width="842" height="${epLine2 ? 96 : 64}" rx="14" fill="url(#frostedCard)" stroke="#80d5ff" stroke-opacity="0.35" stroke-width="1.2" />
      <rect x="2" y="2" width="838" height="26" rx="12" fill="#ffffff" fill-opacity="0.08" />
      
      <text x="24" y="${epLine2 ? 38 : 42}" fill="#ffffff" font-family="${FONT}" font-size="26" font-weight="bold">${escapeXml(epLine1)}</text>
      ${epLine2 ? `<text x="24" y="74" fill="#ffffff" font-family="${FONT}" font-size="24" font-weight="bold">${escapeXml(epLine2)}</text>` : ''}
    </g>
  </g>

  <!-- ==================== INFORMACIÓN RELEVANTE ==================== -->
  <g transform="translate(48, ${line2 ? (epLine2 ? 580 : 540) : (epLine2 ? 520 : 480)})">
    <!-- Horario habitual -->
    <g transform="translate(0, 0)">
      <circle cx="12" cy="12" r="10" fill="#005599" fill-opacity="0.6" stroke="#40b8ff" stroke-width="1" />
      <text x="12" y="16" fill="#6fe2ff" font-family="${FONT}" font-size="14" font-weight="bold" text-anchor="middle">🕒</text>
      <text x="36" y="18" fill="#d8ecff" font-family="${FONT}" font-size="20" font-weight="bold">Horario de Emisión:</text>
      <text x="240" y="18" fill="#8fe5ff" font-family="${FONT}" font-size="20">${escapeXml(effectiveSchedule)}</text>
    </g>

    <!-- Franja temática -->
    <g transform="translate(0, 48)">
      <circle cx="12" cy="12" r="10" fill="#005599" fill-opacity="0.6" stroke="#40b8ff" stroke-width="1" />
      <text x="12" y="16" fill="#6fe2ff" font-family="${FONT}" font-size="14" font-weight="bold" text-anchor="middle">★</text>
      <text x="36" y="18" fill="#d8ecff" font-family="${FONT}" font-size="20" font-weight="bold">Bloque Temático:</text>
      <text x="240" y="18" fill="#ffffff" font-family="${FONT}" font-size="20">${escapeXml(effectiveCategory)}</text>
    </g>

    <!-- Señal continua -->
    <g transform="translate(0, 96)">
      <circle cx="12" cy="12" r="10" fill="#005599" fill-opacity="0.6" stroke="#40b8ff" stroke-width="1" />
      <text x="12" y="16" fill="#6fe2ff" font-family="${FONT}" font-size="14" font-weight="bold" text-anchor="middle">✓</text>
      <text x="36" y="18" fill="#d8ecff" font-family="${FONT}" font-size="20" font-weight="bold">Transmisión:</text>
      <text x="240" y="18" fill="#6fe2ff" font-family="${FONT}" font-size="20">Señal Oficial Home Channel • Transmisión 24/7</text>
    </g>
  </g>

  <!-- ==================== PIE CON SLOGAN OFICIAL ==================== -->
  <g transform="translate(48, 890)">
    <line x1="0" y1="0" x2="842" y2="0" stroke="#ffffff" stroke-opacity="0.15" stroke-width="1" />
    <text x="421" y="38" fill="#b0d8ff" font-family="${FONT}" font-size="20" font-weight="bold" letter-spacing="1" text-anchor="middle">
      <tspan fill="#ffffff" font-weight="bold">Home Channel</tspan>  •  <tspan fill="#a0e0ff" font-style="italic">«${escapeXml(slogan)}»</tspan>
    </text>
  </g>
</g>
</svg>`;
}

module.exports = { renderNextUpSvg, escapeXml, splitTitleLines };
