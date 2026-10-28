/**
 * Home Channel HLS - Selección de la pista de audio en español latino.
 *
 * Reglas en orden de preferencia (la primera que encuentre pista gana):
 *   1. Única pista en español
 *   2. Español etiquetado como latino / latam / México / hispano
 *   3. Español que no sea de España (castellano, Spain, Europe, Iberian)
 *   4. La primera en español
 * Si el archivo tiene una sola pista (o ninguna en español): la primera (0:a:0).
 */

const lower = (v) => String(v || '').toLowerCase();

// Clean URL / domain watermarks from titles before assessing language tags (e.g. "WWW.GDRIVELatinoHD.NET")
const cleanTitle = (raw) => {
  return lower(raw)
    .replace(/(?:https?:\/\/)?(?:www\.)?[a-z0-9_\-\.]+\.(?:net|com|org|lat|me|tv|io|site|xyz|online|ru|es)/gi, ' ')
    .trim();
};

const tagsOf = (s) => ({
  lang: lower(s.tags && s.tags.language),
  title: cleanTitle(s.tags && s.tags.title),
  rawTitle: lower(s.tags && s.tags.title)
});

const isEnglish = (s) => {
  const { lang, title } = tagsOf(s);
  if (lang === 'eng' || lang === 'en') return true;
  if (/\b(ingles|ingl[eé]s|english)\b/i.test(title)) return true;
  return false;
};

const isSpanish = (s) => {
  if (isEnglish(s)) return false;
  const { lang, title } = tagsOf(s);
  return lang === 'es' || lang === 'spa' || lang === 'es-419' || ['latino', 'latin', 'spanish', 'español', 'castellano'].some(w => title.includes(w));
};

const isLatinoExplicit = (s) => {
  const { lang, title } = tagsOf(s);
  return lang === 'es-419' || ['latino', 'latin', 'latam', 'mexic', 'hispano'].some(w => title.includes(w));
};

const isNotFromSpain = (s) => !['castil', 'castell', 'spain', 'españa', 'europe', 'iberian'].some(w => tagsOf(s).title.includes(w));

const RULES = [
  { label: 'Español Latino explícito', pick: (es) => es.find(isLatinoExplicit) },
  { label: 'Español único', pick: (es) => (es.length === 1 ? es[0] : null) },
  { label: 'Español neutro/latino no europeo', pick: (es) => es.find(isNotFromSpain) },
  { label: 'Primera en español', pick: (es) => es[0] }
];

/**
 * @param {Array} streams - pistas de audio de ffprobe ({ index, tags })
 * @returns {{ map: string, reason: string }}
 */
function selectAudioTrack(streams = []) {
  if (streams.length <= 1) return { map: '0:a:0', reason: 'pista predeterminada' };
  const spanish = streams.filter(isSpanish);
  if (!spanish.length) return { map: '0:a:0', reason: 'sin pistas en español' };
  for (const rule of RULES) {
    const s = rule.pick(spanish);
    if (s) return { map: `0:${s.index}`, reason: `${rule.label}${s.tags && s.tags.title ? `: "${s.tags.title}"` : ''}` };
  }
  return { map: '0:a:0', reason: 'pista predeterminada' };
}

module.exports = { selectAudioTrack };
