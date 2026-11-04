const test = require('node:test');
const assert = require('node:assert');
const { isColombianHoliday, getColombianHolidays } = require('../core/holidays');
const DailyEpisodes = require('../scheduling/DailyEpisodes');

test('holidays: detecta festivos fijos y Ley Emiliani en Colombia', () => {
  // Fijo: Año nuevo
  assert.strictEqual(isColombianHoliday('2026-01-01'), true);
  // Ley Emiliani: Todos los Santos (1 de nov trasladado al lunes 2 de nov)
  assert.strictEqual(isColombianHoliday('2026-11-02'), true);
  // Día normal (martes después de festivo)
  assert.strictEqual(isColombianHoliday('2026-11-03'), false);
  // Fijo: Navidad
  assert.strictEqual(isColombianHoliday('2026-12-25'), true);
  // Independencia de Cartagena (11 nov trasladado al 16 nov)
  assert.strictEqual(isColombianHoliday('2026-11-16'), true);
  assert.strictEqual(isColombianHoliday('2026-11-11'), false);
});

test('DailyEpisodes: isWeekendDay considera festivos como fin de semana', () => {
  assert.strictEqual(DailyEpisodes.isWeekendDay('2026-11-02'), true, 'Lunes 2 nov 2026 es festivo');
  assert.strictEqual(DailyEpisodes.isWeekendDay('2026-11-03'), false, 'Martes 3 nov 2026 es laboral');
  assert.strictEqual(DailyEpisodes.isWeekendDay('2026-11-07'), true, 'Sábado es fin de semana');
  assert.strictEqual(DailyEpisodes.isWeekendDay('2026-11-08'), true, 'Domingo es fin de semana');
});
