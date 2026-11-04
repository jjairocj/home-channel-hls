const test = require('node:test');
const assert = require('node:assert');
const DailyEpisodes = require('../scheduling/DailyEpisodes');

test('DailyEpisodes: sequential mode advances each time instead of repeating', () => {
  const episodes = [
    { id: 'ep1', title: 'Episodio 1', duration: 1400 },
    { id: 'ep2', title: 'Episodio 2', duration: 1400 },
    { id: 'ep3', title: 'Episodio 3', duration: 1400 },
  ];
  let ptr = 0;
  const prog = { id: 'show_inuyasha', currentEpisodeIndex: 0, episodes };
  const resolver = {
    resolve: (ref, offset) => {
      const idx = (ptr + offset) % episodes.length;
      return { prog, episode: episodes[idx] };
    }
  };

  const daily = new DailyEpisodes({
    resolver,
    programs: [prog],
    records: {},
  });

  const ref = { key: 'saga:inuyasha', saga: { key: 'inuyasha', members: [prog] } };
  const dateMorning = new Date('2026-10-29T08:00:00');
  const dateAfternoon = new Date('2026-10-29T16:00:00');
  const dateNight = new Date('2026-10-29T22:00:00');

  // Sequential slot 1 at 08:00
  const u1 = daily.unit(ref, dateMorning, 0, { mode: 'next' });
  assert.strictEqual(u1[0].episode.id, 'ep1');
  assert.strictEqual(u1[0].repeat, false);

  // Sequential slot 2 on same day advances to ep2!
  const u2 = daily.unit(ref, dateAfternoon, 1, { mode: 'next' });
  assert.strictEqual(u2[0].episode.id, 'ep2');
  assert.strictEqual(u2[0].repeat, false);

  // Daily slot 3 at night repeats the first unit of the day (ep1)
  const u3 = daily.unit(ref, dateNight, 2, { mode: 'daily' });
  assert.strictEqual(u3[0].episode.id, 'ep1');
  assert.strictEqual(u3[0].repeat, true);
});
