const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeTitle,
  formatSpokenTime,
  stripAudioTags,
  buildBillboardScript,
  buildNextUpScript
} = require('../library/audio8Client');

test('audio8Client: normaliza términos en inglés a fonemas en español', () => {
  assert.strictEqual(normalizeTitle('Sci-Fi Chronicles'), 'Sai-Fai Krónikols');
  assert.strictEqual(normalizeTitle('Action Live'), 'Ákshon Láiv');
  assert.strictEqual(normalizeTitle('HD TV 24/7'), 'Hache Dé Te Vé Veinticuatro Siete');
  assert.strictEqual(normalizeTitle('The Big Show'), 'De Big Shou');
  assert.strictEqual(normalizeTitle('Night Flight'), 'Náit Fláit');
  assert.strictEqual(normalizeTitle('Cyber World'), 'Sáiber Güorld');
});

test('audio8Client: formatea horas a lenguaje hablado natural', () => {
  assert.strictEqual(formatSpokenTime('20:00'), 'las ocho');
  assert.strictEqual(formatSpokenTime('20:30'), 'las ocho y media');
  assert.strictEqual(formatSpokenTime('00:00'), 'la medianoche');
  assert.strictEqual(formatSpokenTime('01:00'), 'la una');
  assert.strictEqual(formatSpokenTime('13:30'), 'la una y media');
  assert.strictEqual(formatSpokenTime('8:30 PM'), 'las ocho y media');
});

test('audio8Client: genera guion de cartelera con 3 programas (estándar y expresivo v4)', () => {
  const entries = [
    { time: '20:00', title: 'Sci-Fi Chronicles' },
    { time: '20:30', title: 'Cyber World' },
    { time: '21:00', title: 'Night Flight' }
  ];

  // Modo estándar (sin tags de audio, marca Home Channel)
  const scriptStd = buildBillboardScript(entries, 'Home Channel', false);
  assert.match(scriptStd, /¡A continuación! Por Jom Chánel:/);
  assert.match(scriptStd, /A las ocho: Sai-Fai Krónikols\./);
  assert.match(scriptStd, /Más tarde, a las ocho y media: Sáiber Güorld\./);
  assert.match(scriptStd, /Y a las nueve: Náit Fláit\./);
  assert.match(scriptStd, /¡Estás en Jom Chánel!/);

  // Modo expresivo (con tags ElevenLabs v4 [excited], [energetic], etc.)
  const scriptExp = buildBillboardScript(entries, 'Home Channel', true);
  assert.match(scriptExp, /\[excited\]/);
  assert.match(scriptExp, /\[energetic\]/);
  assert.match(scriptExp, /\[short pause\]/);
  assert.strictEqual(stripAudioTags(scriptExp).includes('['), false);
});

test('audio8Client: genera guion de cortinilla A continuación (estándar y expresivo v4)', () => {
  const scriptStd = buildNextUpScript({
    showTitle: 'Sci-Fi Chronicles',
    startTime: '21:00',
    channelBrand: 'Home Channel',
    expressive: false
  });
  assert.strictEqual(
    scriptStd,
    '¡A continuación!... Sai-Fai Krónikols... a las nueve... solo aquí, por Jom Chánel.'
  );

  const scriptExp = buildNextUpScript({
    showTitle: 'Sci-Fi Chronicles',
    startTime: '21:00',
    channelBrand: 'Home Channel',
    expressive: true
  });
  assert.strictEqual(
    scriptExp,
    '[excited] ¡A continuación!... [energetic] Sai-Fai Krónikols... [short pause] a las nueve... [playful] solo aquí, por Jom Chánel.'
  );
  assert.strictEqual(stripAudioTags(scriptExp), scriptStd);
});
