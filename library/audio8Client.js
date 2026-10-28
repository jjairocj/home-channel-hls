/**
 * Home Channel HLS - TTS Voiceover Client for Next-Up & Billboard Bumpers.
 *
 * Supported TTS providers:
 *   1. ElevenLabs API (Primary): High quality multilingual neural voice with disk cache.
 *   2. Local TTS fallback (edge-tts / HTTP TTS).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Carga variables de un archivo .env si aún no están en process.env. */
function loadDotEnvIfNeeded() {
  const candidates = [
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../.env')
  ];
  for (const envPath of candidates) {
    try {
      if (!fs.existsSync(envPath)) continue;
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key] || process.env[key] === 'xxxxxxx') {
          process.env[key] = val;
        }
      }
    } catch (e) {}
  }
}

loadDotEnvIfNeeded();

/** Configuración de ElevenLabs y Audio8_TTS. */
const AUDIO8_HOST = process.env.AUDIO8_TTS_URL || '';
const DEFAULT_VOICE = process.env.ELEVENLABS_VOICE_NAME || process.env.AUDIO8_VOICE || 'El Faraón';
const DEFAULT_ELEVENLABS_VOICE_ID = 'QpDQJR3frbDwOhTIo8nW'; // "El Faraon - Energetic Commentator" (Spanish Colombiano)
const DEFAULT_ELEVENLABS_MODEL = 'eleven_v4';

let cachedResolvedVoiceId = null;

/**
 * Diccionario fonético para títulos en inglés, japonés o siglas complejas.
 * Adapta la pronunciación a fonemas naturales en español.
 */
const PHONETIC_MAP = [
  // Channel Brand & Broadcasting Acronyms
  [/\bHome\s+Channel\b/gi, 'Jom Chánel'],
  [/\bSci-?Fi\b/gi, 'Sai-Fai'],
  [/\bChronicles\b/gi, 'Krónikols'],
  [/\bNight\b/gi, 'Náit'],
  [/\bFlight\b/gi, 'Fláit'],
  [/\bCyber\b/gi, 'Sáiber'],
  [/\bWorld\b/gi, 'Güorld'],
  [/\bAction\b/gi, 'Ákshon'],
  [/\bLive\b/gi, 'Láiv'],
  [/\bShow\b/gi, 'Shou'],
  [/\bHD\b/gi, 'Hache Dé'],
  [/\bTV\b/gi, 'Te Vé'],
  [/\bFM\b/gi, 'Efe Eme'],
  [/\b24\/7\b/gi, 'Veinticuatro Siete'],
  [/\bThe\b/gi, 'De'],
  [/\bBig\b/gi, 'Big'],
  [/\bMovie\b/gi, 'Múvi'],
  [/\bClassic\b/gi, 'Klásic'],
  [/\bSpecial\b/gi, 'Espéshal'],
  [/\bSpotlight\b/gi, 'Spótláit'],
  [/\bHour\b/gi, 'Áuer'],
  [/\bZone\b/gi, 'Zóun'],
  [/\bEpisode\b/gi, 'Episodio'],
  [/\bSeason\b/gi, 'Temporada'],
  [/\bPart\s+(\d+)\b/gi, 'Parte $1']
];

function normalizeTitle(title) {
  let text = String(title || '').trim();
  for (const [pattern, replacement] of PHONETIC_MAP) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function formatSpokenTime(timeStr) {
  if (!timeStr) return '';
  const clean = String(timeStr).trim();
  const m = clean.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!m) return clean;

  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3] ? m[3].toUpperCase() : null;

  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;

  const h12 = h % 12 === 0 ? 12 : h % 12;

  const numWords = {
    1: 'la una', 2: 'las dos', 3: 'las tres', 4: 'las cuatro',
    5: 'las cinco', 6: 'las seis', 7: 'las siete', 8: 'las ocho',
    9: 'las nueve', 10: 'las diez', 11: 'las once', 12: 'las doce'
  };

  if (h === 0 && min === 0) return 'la medianoche';
  if (h === 12 && min === 0) return 'el mediodía';

  const baseH = numWords[h12] || ('las ' + h12);
  if (min === 0) return baseH;
  if (min === 30) return `${baseH} y media`;
  if (min === 15) return `${baseH} y cuarto`;
  if (min === 45) return `${baseH} y cuarenta y cinco`;
  return `${baseH} y ${min}`;
}

/**
 * Remueve etiquetas de expresión de audio estilo ElevenLabs v4/v3 ([excited], [short pause], etc.)
 * para garantizar compatibilidad con modelos antiguos o motores de respaldo como Audio8_TTS.
 */
function stripAudioTags(text) {
  return String(text || '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldUseExpressiveTags(expressiveParam) {
  if (typeof expressiveParam === 'boolean') return expressiveParam;
  if (process.env.NODE_ENV === 'test') return false;
  const model = (process.env.ELEVENLABS_MODEL_ID || DEFAULT_ELEVENLABS_MODEL).toLowerCase();
  const apiKey = (process.env.ELEVENLABS_API_KEY || '').trim();
  return !!apiKey && apiKey !== 'xxxxxxx' && (model.includes('v4') || model.includes('v3'));
}

/**
 * Guion para cartelera de 3 programas con horas.
 */
function buildBillboardScript(entries, channelBrand = (process.env.CHANNEL_NAME || 'Channel'), expressive = undefined) {
  const active = (entries || []).filter(e => !e.offAir).slice(0, 3);
  if (!active.length) return null;

  const brandSpoken = normalizeTitle(channelBrand);
  const useTags = shouldUseExpressiveTags(expressive);

  if (!useTags) {
    const parts = [`¡A continuación! Por ${brandSpoken}:`];
    active.forEach((e, idx) => {
      const t = formatSpokenTime(e.time);
      const title = normalizeTitle(e.title);
      if (idx === 0) {
        parts.push(`A ${t}: ${title}.`);
      } else if (idx === active.length - 1) {
        parts.push(`Y a ${t}: ${title}.`);
      } else {
        parts.push(`Más tarde, a ${t}: ${title}.`);
      }
    });
    parts.push(`¡Estás en ${brandSpoken}!`);
    return parts.join(' ');
  }

  // Versión expresiva con etiquetas de audio ElevenLabs v4 / v3
  const parts = [`[excited] ¡A continuación por ${brandSpoken}! [short pause]`];
  active.forEach((e, idx) => {
    const t = formatSpokenTime(e.time);
    const title = normalizeTitle(e.title);
    if (idx === 0) {
      parts.push(`A ${t}: [energetic] ${title}. [short pause]`);
    } else if (idx === active.length - 1) {
      parts.push(`Y a ${t}: [energetic] ${title}. [short pause]`);
    } else {
      parts.push(`Más tarde, a ${t}: [energetic] ${title}. [short pause]`);
    }
  });
  parts.push(`[playful] ¡Estás viviendo ${brandSpoken}!`);
  return parts.join(' ');
}

/**
 * Guion para cortinilla individual "A continuación".
 */
function buildNextUpScript({ showTitle, startTime, channelBrand = (process.env.CHANNEL_NAME || 'Channel'), expressive = undefined }) {
  const clean = normalizeTitle(showTitle);
  const brand = normalizeTitle(channelBrand);
  const useTags = shouldUseExpressiveTags(expressive);

  if (!useTags) {
    if (startTime) {
      const t = formatSpokenTime(startTime);
      return `¡A continuación!... ${clean}... a ${t}... solo aquí, por ${brand}.`;
    }
    return `¡A continuación!... ${clean}... solo aquí, por ${brand}.`;
  }

  // Versión expresiva con etiquetas de audio ElevenLabs v4 / v3
  if (startTime) {
    const t = formatSpokenTime(startTime);
    return `[excited] ¡A continuación!... [energetic] ${clean}... [short pause] a ${t}... [playful] solo aquí, por ${brand}.`;
  }
  return `[excited] ¡A continuación!... [energetic] ${clean}... [short pause] [playful] solo aquí, por ${brand}.`;
}

/**
 * Carpeta persistente para cachear locuciones de ElevenLabs y no gastar créditos
 * cuando la misma serie se anuncia en el mismo horario en días distintos.
 */
function getVoiceCacheDir(outputPath) {
  const base = outputPath ? path.resolve(path.dirname(outputPath), '..', 'voice_cache') : path.resolve(__dirname, '../../media/bumpers/voice_cache');
  try { fs.mkdirSync(base, { recursive: true }); } catch (e) {}
  return base;
}

function normalizeSearchName(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Resuelve el Voice ID de "El Faraón" en la cuenta de ElevenLabs del usuario,
 * o usa ELEVENLABS_VOICE_ID / el ID conocido de "El Faraón".
 */
async function resolveElevenLabsVoiceId(apiKey, preferredName = 'El Faraón') {
  if (cachedResolvedVoiceId) return cachedResolvedVoiceId;

  const envId = (process.env.ELEVENLABS_VOICE_ID || '').trim();
  if (envId && envId !== 'xxxxxxx') {
    cachedResolvedVoiceId = envId;
    return cachedResolvedVoiceId;
  }

  const targetNorm = normalizeSearchName(preferredName || process.env.ELEVENLABS_VOICE_NAME || 'El Faraon');

  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey }
    });
    if (res.ok) {
      const data = await res.json();
      const voices = Array.isArray(data.voices) ? data.voices : [];
      const match = voices.find(v => normalizeSearchName(v.name).includes(targetNorm) || normalizeSearchName(v.name).includes('faraon'));
      if (match && match.voice_id) {
        cachedResolvedVoiceId = match.voice_id;
        console.log(`[ElevenLabs] 🎙️ Voz encontrada en tu cuenta: "${match.name}" (${cachedResolvedVoiceId})`);
        return cachedResolvedVoiceId;
      }
      if (envId && voices.some(v => v.voice_id === envId)) {
        cachedResolvedVoiceId = envId;
        return cachedResolvedVoiceId;
      }
    }
  } catch (e) {
    console.warn(`[ElevenLabs] ⚠️ No se pudo consultar lista de voces (${e.message}), usando ID configurado.`);
  }

  cachedResolvedVoiceId = envId || DEFAULT_ELEVENLABS_VOICE_ID;
  return cachedResolvedVoiceId;
}

/**
 * Síntesis de voz mediante ElevenLabs API con caché persistente por guion.
 */
async function synthesizeWithElevenLabs({ text, voiceName, outputPath, timeoutMs = 60000 }) {
  loadDotEnvIfNeeded();
  const apiKey = (process.env.ELEVENLABS_API_KEY || '').trim();
  if (!apiKey || apiKey === 'xxxxxxx') return false;

  const modelId = (process.env.ELEVENLABS_MODEL_ID || DEFAULT_ELEVENLABS_MODEL).trim();
  const voiceId = await resolveElevenLabsVoiceId(apiKey, voiceName);

  // Si el modelo no es Eleven v4 o v3, remover audio tags para que no los lea literalmente
  const isTagAwareModel = /v[34]/i.test(modelId);
  const textToSend = isTagAwareModel ? text : stripAudioTags(text);

  const cacheDir = getVoiceCacheDir(outputPath);
  const hash = crypto.createHash('sha256').update(`elevenlabs:${voiceId}:${modelId}:${textToSend}`).digest('hex').slice(0, 20);
  const cachedFile = path.join(cacheDir, `eleven_${hash}.mp3`);

  if (fs.existsSync(cachedFile) && fs.statSync(cachedFile).size > 1000) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.copyFileSync(cachedFile, outputPath);
    console.log(`[ElevenLabs] 💾 Locución reutilizada desde caché (0 créditos): "${textToSend.slice(0, 60)}..."`);
    return true;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  console.log(`[ElevenLabs] 📜 Guion enviado a locución: "${textToSend}"`);

  try {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: textToSend,
        model_id: modelId,
        voice_settings: {
          stability: 0.40,
          similarity_boost: 0.85,
          style: 0.45,
          use_speaker_boost: true
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[ElevenLabs] ⚠️ Respuesta HTTP ${res.status} desde ElevenLabs: ${errBody.slice(0, 200)}`);
      return false;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 1000) {
      console.warn('[ElevenLabs] ⚠️ Audio recibido demasiado pequeño o inválido');
      return false;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(cachedFile, buffer);
    fs.writeFileSync(outputPath, buffer);
    const displayVoice = (voiceName && voiceName !== 'Mario') ? voiceName : (process.env.ELEVENLABS_VOICE_NAME || 'El Faraón');
    console.log(`[ElevenLabs] 🎙️ Locución generada con "${displayVoice}" (${voiceId}) [${modelId}] y guardada en caché.`);
    return true;
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[ElevenLabs] ⚠️ Error al sintetizar con ElevenLabs (${err.message}).`);
    return false;
  }
}

/**
 * Genera la locución en outputPath usando ElevenLabs (principal) o Audio8_TTS (respaldo).
 * Si falla o tarda más del timeout, retorna false de forma segura.
 */
async function synthesizeVoice({
  text,
  voiceName = DEFAULT_VOICE,
  outputPath,
  temperature = 0.35,
  topP = 0.9,
  seed = 77,
  timeoutMs = 150000
}) {
  if (!text || !outputPath) return false;

  // 1. Intentar primero con ElevenLabs si ELEVENLABS_API_KEY está configurada
  const elevenOk = await synthesizeWithElevenLabs({ text, voiceName, outputPath, timeoutMs: Math.min(timeoutMs, 60000) });
  if (elevenOk) return true;

  // 2. Respaldo: Audio8_TTS local si está configurado (remover tags de audio estilo v4)
  if (!AUDIO8_HOST) return false;

  const cleanText = stripAudioTags(text);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  console.log(`[Audio8Client] 📜 Guion enviado a locución (backup): "${cleanText}"`);

  try {
    const url = `${AUDIO8_HOST.replace(/\/+$/, '')}/api/tts`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleanText,
        voice_name: voiceName,
        temperature,
        top_p: topP,
        seed
      }),
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[Audio8Client] ⚠️ Respuesta HTTP ${res.status} desde Audio8_TTS`);
      return false;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length < 1000) {
      console.warn('[Audio8Client] ⚠️ Audio recibido es demasiado pequeño o inválido');
      return false;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    return true;
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[Audio8Client] ⚠️ No se pudo sintetizar locución (${err.message}). Continuando sin voz.`);
    return false;
  }
}

module.exports = {
  AUDIO8_HOST,
  DEFAULT_VOICE,
  PHONETIC_MAP,
  normalizeTitle,
  formatSpokenTime,
  stripAudioTags,
  buildBillboardScript,
  buildNextUpScript,
  synthesizeVoice
};
