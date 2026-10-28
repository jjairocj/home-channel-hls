import { i18n } from '/shared/i18n.js';
/**
 * Home Channel HLS // MASTER CONTROL STUDIO — punto de entrada del panel de administración.
 *
 * Cada pestaña es un módulo que se suscribe al store; aquí solo se arman, se cargan
 * los datos iniciales y se programan los sondeos.
 */

import { reload } from './store.js';
import { initTabs, onTabOpen } from './tabs.js';
import { initShows } from './shows.js';
import { initCommercials } from './commercials.js';
import { initUpload } from './upload.js';
import { initTranscode, refreshTranscode } from './transcode.js';
import { refreshScheduleBlocks, initScheduleBlocks } from './schedule/blocks.js';
import { initLive, refreshLiveStatus, monitor } from './live.js';
import { AudiencePanel } from './audience.js';
import { initRecordingsImport } from './imports/recordings.js';
import { initBatchImport } from './imports/batch.js';
import { initProgramming } from './programming.js';
import { initProgrammer } from './programmer/index.js';
import { initEpisodes, refreshUpcoming } from './episodes.js';
import { initBumpers, refreshBumpers } from './bumpers.js';
import { initLayout } from './layout.js';
import { initShell } from './shell.js';

const POLL = { transcode: 2000, live: 3000, downloads: 3000, programming: 60000, audience: 15000 };

let audience = null;
const refreshLive = () => refreshLiveStatus();

async function loadAll() {
  await reload('episodic');
  await reload('shows');
  await reload('commercials');
  await reload('programming');
  await reload('week');
  await refreshScheduleBlocks();
  await refreshTranscode();
  await refreshLive();
  }

function start() {
  initShell();
  i18n.renderSwitcher("langSwitcherAdmin");
  initTabs();
  onTabOpen('tabPlayout', () => { if (!monitor.started) monitor.start(); });
    onTabOpen('tabEpisodes', refreshUpcoming);
  onTabOpen('tabBumpers', refreshBumpers);

  initLayout(loadAll);
  initShows();
  initCommercials();
  initBumpers();
  initUpload();
  initTranscode();
  initLive();
  initRecordingsImport();
    initBatchImport();
    initProgramming();
  audience = new AudiencePanel();
  initProgrammer();
  initEpisodes();
  initScheduleBlocks();

  loadAll();
  const whenVisible = (fn) => () => { if (!document.hidden) fn(); };
  setInterval(whenVisible(refreshTranscode), POLL.transcode);
  setInterval(whenVisible(refreshLive), POLL.live);
    setInterval(whenVisible(() => reload('programming')), POLL.programming);
  audience.refresh();
  setInterval(whenVisible(() => audience.refresh()), POLL.audience);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshLive();
      refreshTranscode();
      audience.refresh();
    }
  });
}

start();
