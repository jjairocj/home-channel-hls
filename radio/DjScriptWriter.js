/**
 * Home Channel Radio - Guiones del locutor (10-14 s hablados, 20-35 palabras).
 *
 * Con OLLAMA_URL configurado, un modelo local escribe la presentación con la
 * personalidad del DJ y datos reales de la banda (se le pide no inventar). Sin
 * Ollama, o si falla, se usan plantillas variadas. Strategy: dos escritores
 * intercambiables con la misma interfaz `write(track, station)`.
 */

const { BRAND } = require('./stations');

const MIN_WORDS = 12;
const MAX_WORDS = 50;

/** Frecuencia hablada: "104.5" → "104 punto 5" (edge-tts lee bien los números). */
const spokenFreq = (freq) => String(freq).replace('.', ' punto ');

/** Plantillas: aperturas, presentación del tema y cierres; se combinan según la canción. */
const OPENINGS = [
  (s) => `Estás en ${s.show}, por ${BRAND} ${spokenFreq(s.freq)}.`,
  (s) => `${BRAND}, ${spokenFreq(s.freq)} FM. Te habla ${s.dj}.`,
  (s) => `Seguimos en ${s.show}, con ${s.dj} en la cabina.`,
  (s) => `${spokenFreq(s.freq)}, la frecuencia de ${s.show}.`
];
const INTROS = [
  (t) => `Esto es ${t.artist} con ${t.title}${t.album ? `, del álbum ${t.album}` : ''}${t.year ? ` de ${t.year}` : ''}.`,
  (t) => `Llega ${t.title}, de ${t.artist}${t.year ? `, directo desde ${t.year}` : ''}.`,
  (t) => `${t.artist} toma la frecuencia con ${t.title}${t.album ? `, parte de ${t.album}` : ''}.`,
  (t) => `Para ti, ${t.title}. ${t.artist}${t.year ? `, año ${t.year}` : ''}.`
];
const CLOSINGS = {
  metal: ['¡Súbele el volumen!', '¡Que tiemble el barrio!', '¡Cabeza arriba y a romperse el cuello!', '¡Directo a los tímpanos!'],
  rock: ['¡Súbele, que esto suena mejor fuerte!', 'Pura actitud noventera.', 'Para cantarlo a todo pulmón.', 'Sin bajarle ni un poquito.'],
  anime_synth: ['Ponte los audífonos y déjate llevar.', 'Directo a la ciudad de neón.', 'Para viajar a toda velocidad.', 'Esto es pura nostalgia.'],
  clasicos_90s: ['Un clásico que no envejece.', 'Para recordar los buenos tiempos.', 'Como en los noventa, sin cortes.', 'Súbele y viaja en el tiempo.']
};

/** Índice estable por canción (la misma canción siempre recibe el mismo guion). */
function pickIndex(text, n) {
  let h = 0;
  for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % n;
}

class TemplateScriptWriter {
  async write(track, station) {
    const key = `${track.artist}${track.title}`;
    const closings = CLOSINGS[station.id] || CLOSINGS.rock;
    return [
      OPENINGS[pickIndex(key, OPENINGS.length)](station),
      INTROS[pickIndex(`${key}i`, INTROS.length)](track),
      closings[pickIndex(`${key}c`, closings.length)]
    ].join(' ');
  }
}

/** Limpia la respuesta del modelo: sin comillas, acotaciones ni emojis. */
function cleanScript(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/\*[^*]*\*/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/["“”«»]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cómo arrancar la presentación (varía por canción para no sonar siempre igual). */
const OPENING_STYLES = [
  'Empieza con el nombre de la banda.',
  'Empieza con una pregunta corta al oyente.',
  'Empieza saludando a quien está escuchando a esta hora.',
  'Empieza con el nombre del programa y la emisora.',
  'Empieza con el nombre de la canción.',
  'Empieza con una exclamación breve de entusiasmo.'
];

class OllamaScriptWriter {
  constructor({ url, model = 'qwen2.5:7b', timeoutMs = 90000, fallback = new TemplateScriptWriter() }) {
    this.url = url.replace(/\/+$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fallback = fallback;
  }

  prompt(track, station) {
    const details = [`Artista: ${track.artist}`, `Canción: ${track.title}`];
    if (track.album) details.push(`Álbum: ${track.album}`);
    if (track.year) details.push(`Año: ${track.year}`);
    return `Eres ${station.dj}, ${station.persona}, en la emisora ${BRAND} ${station.freq} FM, programa "${station.show}". ` +
      'Vas a presentar al aire la siguiente canción, hablando sobre su intro, como en la radio FM de los años 90.\n\n' +
      `${details.join('\n')}\n\n` +
      'Ejemplo del tono (para otra canción; no copies sus frases): "Estás en Metal Attack por Home Channel Radio 104 punto 5. ' +
      'Directo desde Gotemburgo, Suecia, esto es In Flames con su álbum A Sense of Purpose de 2008. ¡Súbele el volumen a Alias!"\n\n' +
      'Reglas:\n' +
      `- ${OPENING_STYLES[pickIndex(`${track.artist}${track.title}o`, OPENING_STYLES.length)]}\n` +
      '- Entre 20 y 35 palabras, en español latino, hablándole de tú al oyente.\n' +
      '- Di el nombre de la canción y del artista, y la emisora o el programa.\n' +
      `- Escribe la frecuencia así: "${spokenFreq(station.freq)}".\n` +
      '- No menciones años, décadas ni fechas distintas de los datos de arriba.\n' +
      '- Como máximo UN dato real y breve de la banda (origen, género), solo si estás completamente seguro.\n' +
      '- Termina con una frase completa que invite a escuchar. Sin emojis, acotaciones ni comillas.\n' +
      'Responde solo con el texto que dirías.';
  }

  async write(track, station) {
    try {
      const res = await fetch(`${this.url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: this.prompt(track, station), stream: false, options: { temperature: 0.7 } }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!res.ok) throw new Error(`Ollama respondió ${res.status}`);
      const text = cleanScript((await res.json()).response);
      const words = text.split(' ').length;
      if (words < MIN_WORDS || words > MAX_WORDS) throw new Error(`guion de ${words} palabras`);
      if (!/[.!?¡¿]$/.test(text)) throw new Error('guion cortado');
      return text;
    } catch (e) {
      console.warn(`[Radio/DJ] Ollama no disponible (${e.message}); uso plantilla.`);
      return this.fallback.write(track, station);
    }
  }
}

/** Factory: Ollama si está configurado, si no plantillas. */
function createScriptWriter(env = process.env) {
  return env.OLLAMA_URL
    ? new OllamaScriptWriter({ url: env.OLLAMA_URL, model: env.OLLAMA_MODEL || 'qwen2.5:7b' })
    : new TemplateScriptWriter();
}

module.exports = { createScriptWriter, TemplateScriptWriter, OllamaScriptWriter, cleanScript, spokenFreq };
