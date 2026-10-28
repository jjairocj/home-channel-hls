/**
 * Home Channel HLS - Exportación de la guía en formato XMLTV (EPG para apps IPTV).
 * El id del canal DEBE coincidir con el tvg-id del M3U para que la guía se enlace.
 */

const EPG_CHANNEL_ID = 'homechannel.tv';

const escapeXml = (str) => String(str == null ? '' : str).replace(/[<>&'"]/g, (c) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
));

const pad = (n) => String(n).padStart(2, '0');
const xmltvDate = (iso) => {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
};

function programmeXml(block) {
  const title = block.isOffAir
    ? 'Cierre de emisión'
    : String(block.title || 'Home Channel').replace(/\s*\(Doble Episodio\)/i, '');
  const desc = block.isOffAir
    ? 'Frecuencia de descanso nocturna. La transmisión se reanuda a las 05:00.'
    : 'Bloque de 30 minutos con animación de culto, tandas comerciales y cortinillas retro.';
  return `  <programme start="${xmltvDate(block.startTime)}" stop="${xmltvDate(block.endTime)}" channel="${EPG_CHANNEL_ID}">
    <title lang="es">${escapeXml(title)}</title>
    <desc lang="es">${escapeXml(desc)}</desc>
    <category lang="es">Animación</category>${block.isRepeat ? '\n    <previously-shown />' : ''}
  </programme>
`;
}

/**
 * @param {string} hostUrl - URL pública (para el logo)
 * @param {Array} blocks - bloques a publicar
 */
function toXmltv(hostUrl, blocks) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="Home Channel Broadcast System">
  <channel id="${EPG_CHANNEL_ID}">
    <display-name>Home Channel</display-name>
    <icon src="${escapeXml(hostUrl)}/img/logo.png" />
  </channel>
${blocks.map(programmeXml).join('')}</tv>
`;
}

module.exports = { toXmltv, EPG_CHANNEL_ID, escapeXml };
