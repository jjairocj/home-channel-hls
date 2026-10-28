import { i18n } from '../shared/i18n.js';
/**
 * Home Channel HLS // TELEVISIÓN ALTERNATIVA 90s — punto de entrada de la página pública.
 *
 * Arma los módulos y los conecta con un bus de eventos: StatusFeed publica el estado
 * de la emisión y cada parte de la página se suscribe a lo que necesita.
 */

import { $, on } from '../shared/dom.js';
import { EventBus } from '../shared/EventBus.js';
import { TvSet } from './tv/TvSet.js?v=20261028';
import { LivePlayer } from './tv/LivePlayer.js?v=20261028';
import { RadioTuner } from './tv/RadioTuner.js?v=20261028';
import { CrtOverlays } from './tv/overlays.js?v=20261028';
import { createCommands, bindControls } from './tv/commands.js';
import { GuideMagazine } from './guide/GuideMagazine.js';
import { StatusFeed } from './StatusFeed.js';
import { initTabs, openTab, paintSignal, paintOffline, paintNowPlaying, paintUrls, VideoLibrary } from './teletext.js';
import { initDesktop } from './desktop.js';

const GUIDE_REFRESH_MS = 5 * 60 * 1000;

function startClock() {
  const tick = () => {
    const time = new Date().toTimeString().split(' ')[0];
    for (const id of ['osdClock', 'tickerClock']) {
      const el = $(id);
      if (el) el.textContent = time;
    }
  };
  tick();
  setInterval(tick, 1000);
}

function start() {
  try {
    i18n.renderSwitcher('langSwitcherPublic');
    const bus = new EventBus();
    const tv = new TvSet();
    const guide = new GuideMagazine();
    const overlays = new CrtOverlays(() => guide.getTodayBlocks());
    const library = new VideoLibrary();
    const feed = new StatusFeed(bus);
    const radioTuner = new RadioTuner();

    startClock();
    tv.attachScreen();
    radioTuner.init();
    window._radioTuner = radioTuner;
    new LivePlayer(tv.video, () => tv.poweredOn).start();

    bindControls(createCommands({ tv, overlays, openGuide: () => openTab('tabSchedule') }));
    on('channelNameSelect', 'change', (e) => tv.tuneById(e.target.value));

    initTabs();
    library.init();
    guide.init();
    setInterval(() => guide.refreshToday(), GUIDE_REFRESH_MS);

    initDesktop({
      tv: () => $('tvWindow')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      fullscreen: () => tv.toggleFullscreen(),
      openTab
    }, () => {});

    bus.on('status', (status) => {
      paintSignal(status);
      paintNowPlaying(status);
      overlays.update(status);
      paintUrls(status.urls);
    });
    bus.on('programChanged', ({ title, isFirst }) => {
      library.setOnAir(title);
      // Cambió el programa al aire: actualizar la revista sin recargar la página
      if (!isFirst) guide.refreshToday();
    });
    bus.on('offline', paintOffline);
    feed.start();
  } catch (err) {
    console.error('[App] Error al inicializar:', err);
  }
}

// Los módulos se ejecutan con el DOM ya cargado (equivalen a "defer")
start();
