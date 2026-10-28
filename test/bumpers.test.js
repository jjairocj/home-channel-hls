const test = require('node:test');
const assert = require('node:assert');
const BumperCatalog = require('../library/BumperCatalog');
const BlockComposer = require('../scheduling/BlockComposer');
const CommercialRotation = require('../scheduling/CommercialRotation');

test('BumperCatalog: rotación anti-repetición consecutiva y exclusión en tanda', () => {
  const mockBumpers = [
    { id: 'b_shonen', name: 'Home Channel Station ID - Shonen', filename: 'bumper_01_station_id_shonen.mp4', duration: 15 },
    { id: 'b_culto', name: 'Home Channel Station ID - Culto', filename: 'bumper_01_station_id_culto.mp4', duration: 15 },
    { id: 'b_adult', name: 'Home Channel Station ID - Adult', filename: 'bumper_01_station_id_adult.mp4', duration: 15 },
    { id: 'b_aventura', name: 'Home Channel Station ID - Aventura', filename: 'bumper_01_station_id_aventura.mp4', duration: 15 },
    { id: 'b_original', name: 'Home Channel: Station ID Mosaico', filename: 'bumper_01_animestation.mp4', duration: 15 }
  ];

  const catalog = new BumperCatalog(() => mockBumpers);

  // 1. En 5 llamadas sucesivas debe recorrer las 5 opciones distintas sin repetir ninguna
  const seenFirstCycle = new Set();
  for (let i = 0; i < 5; i++) {
    const picked = catalog.forRole('intro');
    assert.ok(picked, 'debe devolver un bumper');
    assert.strictEqual(seenFirstCycle.has(picked.id), false, `No debe repetir ${picked.id} en el mismo ciclo`);
    seenFirstCycle.add(picked.id);
  }
  assert.strictEqual(seenFirstCycle.size, 5, 'Debió recorrer los 5 bumpers en el primer ciclo');

  // 2. Nunca debe devolver dos veces consecutivas el mismo bumper
  let prevId = null;
  for (let i = 0; i < 30; i++) {
    const picked = catalog.forRole('intro');
    assert.notStrictEqual(picked.id, prevId, `Repitió consecutivamente ${picked.id}`);
    prevId = picked.id;
  }

  // 3. Exclusión explícita (ej. usado en el mismo bloque o tanda)
  const excludeSet = new Set(['b_shonen', 'b_culto', 'b_adult', 'b_aventura']);
  const onlyOriginal = catalog.forRole('intro', { exclude: excludeSet });
  assert.strictEqual(onlyOriginal.id, 'b_original', 'Debe respetar el conjunto de excluidos');
});

test('BumperCatalog.regular: no incluye transiciones habladas ni cortinillas de función', () => {
  const allBumpers = [
    { id: 'b0', name: 'Home Channel: Sincronizador Horario', filename: 'bumper_00_sincronizador_ident.mp4', duration: 46 },
    { id: 'b1', name: 'Home Channel Station ID', filename: 'bumper_01_animestation.mp4', duration: 15 },
    { id: 'b2', name: 'Home Channel: A Continuación', filename: 'bumper_02_a_continuacion.mp4', duration: 13 },
    { id: 'b3', name: 'Home Channel: Estás Viendo', filename: 'bumper_03_estas_viendo.mp4', duration: 6 },
    { id: 'b4', name: 'Cierre de Emisión', filename: 'bumper_04_cierre_emision_nocturno.mp4', duration: 61 }
  ];
  const catalog = new BumperCatalog(() => allBumpers);
  const regular = catalog.regular();
  assert.strictEqual(regular.length, 0, 'Ninguna cortinilla funcional con locución o rol debe ser bumper regular de relleno');
});

test('BlockComposer: episodio corto llena el hueco con comerciales y no repite A continuación', () => {
  const named = {
    break_in: { id: 'in', name: 'Home Channel: Estás Viendo', filename: 'bumper_03_estas_viendo.mp4', duration: 6 },
    break_out: { id: 'out', name: 'Home Channel: A Continuación', filename: 'bumper_02_a_continuacion.mp4', duration: 13 },
    sync_pad: { id: 'pad', name: 'Sincronizador Horario', filename: 'bumper_00_sincronizador_ident.mp4', duration: 46 },
    intro: { id: 'station', name: 'Home Channel Station ID', filename: 'bumper_01_animestation.mp4', duration: 15 }
  };
  const bumpers = new BumperCatalog(() => Object.values(named));
  const commercials = Array.from({ length: 25 }, (_, i) => ({ id: `comm_${i}`, name: `Spot ${i}`, duration: 30 }));
  const rotation = new CommercialRotation(() => commercials, { config: { minSeparationBlocks: 6, maxSpotsPerBreak: 5 } });

  const composer = new BlockComposer({
    bumpers,
    rotation,
    getCommercials: () => commercials,
    bumpersDir: '/tmp'
  });

  // Episodio de 20 minutos (1200s) en bloque de 1800s -> quedan 600s
  const block = composer.compose({ id: 'ep1', name: 'Sabrina 1x01', duration: 1200 }, 1800);

  // 1. Debe haber un solo 'A continuación' en la tanda (outro_bumper), NUNCA duplicado
  const breakOuts = block.items.filter(it => it.role === 'outro_bumper' || it.role === 'next_up_bumper');
  assert.strictEqual(breakOuts.length, 1, 'Debe haber exactamente un solo A continuación');

  // 2. Debe haber un solo 'Estás viendo'
  const breakIns = block.items.filter(it => it.role === 'mid_bumper_in');
  assert.strictEqual(breakIns.length, 1, 'Debe haber exactamente un solo Estás viendo');

  // 3. El espacio grande debe estar ocupado por comerciales (no por 20 fillers repetidos)
  const commsCount = block.items.filter(it => it.role === 'commercial').length;
  assert.ok(commsCount >= 10, `Debió llenar el hueco con comerciales (puso ${commsCount})`);

  // 4. El relleno de sincronización final no debe tener más de 2 piezas (sincronizador satelital)
  const fillers = block.items.filter(it => it.role === 'filler_pad');
  assert.ok(fillers.length <= 2, `No debe inflar con decenas de fillers (puso ${fillers.length})`);
  assert.ok(fillers.every(f => f.filename === 'bumper_00_sincronizador_ident.mp4'), 'Solo debe rellenar con el sincronizador oficial');
});
