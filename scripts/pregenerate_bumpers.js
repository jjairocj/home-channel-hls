/**
 * Home Channel HLS - Pre-generate Dynamic Bumpers & Billboards
 * Scans active weekly schedule and renders upcoming Next-Up and Billboard clips in advance.
 */

const path = require('path');
const fs = require('fs');

const Database = require('../database');
const Scheduler = require('../scheduler');

async function main() {
  const channelName = process.env.CHANNEL_NAME || 'Home Channel';
  console.log('================================================================');
  console.log(`🚀 Pre-generating Dynamic Interstitials // ${channelName}`);
  console.log('================================================================\n');

  const db = new Database();
  const scheduler = new Scheduler(db);

  scheduler.scanMedia();
  const shows = db.getShows();
  console.log(`📺 Total registered shows: ${shows.length}\n`);

  const manager = scheduler.dynamicBumperManager;
  if (!manager) {
    console.log('No dynamic bumper manager initialized. Exiting.');
    return;
  }

  console.log('🗓️ Planning weekly schedule blocks (7 days)...');
  const now = new Date();
  scheduler.planBlocks(now, 48 * 7, { withItems: true });
  console.log(`📋 Queued bumper jobs: ${manager.generationQueue.length}`);

  if (manager.generationQueue.length > 0) {
    console.log('⚡ Processing queue...');
    await manager.processQueue();
    console.log('✅ Generation complete!');
  } else {
    console.log('All bumpers are already cached.');
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Error pre-generating bumpers:', err);
    process.exit(1);
  });
}

module.exports = { main };
