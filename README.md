# 📺 Home Channel HLS

> **Open-Source 24/7 Linear Broadcast Playout Engine & Master Control Studio**  
> *Stream your own continuous TV channel with HLS, automated EPG grid, dynamic bumpers, and commercial breaks.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-22.x_LTS-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-Hardware_Accelerated-007808.svg)](https://ffmpeg.org/)
[![i18n](https://img.shields.io/badge/i18n-English_%7C_Espa%C3%B1ol-orange.svg)](./public/locales/)

[**[Leer en Español]**](./README.es.md) • [**[AI Agent Guide (AGENTS.md)]**](./AGENTS.md) • [**[Full Documentation Wiki]**](./docs/en/01-architecture.md)

---

## ✨ Features

- 🛰️ **24/7 Continuous HLS Stream:** Zero-buffer linear broadcasting with instant playback on web browsers, Smart TVs, Android TV, Apple TV, and IPTV apps (VLC, Kodi, TiviMate).
- 🕒 **Strict Clock-Aligned Slots:** Automatically synchronizes shows to exact half-hour and hour marks (`:00` and `:30`). Never drifts across the broadcast day.
- 📼 **Intelligent Interstitial Composer:** Dynamically fills commercial breaks between episodes with intro bumpers (*"You're watching..."*), non-repeating ad spots, station idents, and closing previews (*"Coming up next..."*).
- 🎙️ **Dynamic Next-Up Graphics & Voiceovers:** Renders on-the-fly vector SVG billboards and announces upcoming shows using neural TTS (ElevenLabs API or local edge-tts).
- 📅 **Rule-Based Weekly Grid & EPG:** Intuitive drag-and-drop schedule planner, automated daily episode progression, weekend marathons, and XMLTV EPG export (`/epg.xml`).
- ⚡ **Multi-Platform Hardware Acceleration:** Supports NVIDIA NVENC, Intel QuickSync/VAAPI, Apple Silicon VideoToolbox, and high-efficiency CPU fallback (`libx264`).
- 🎛️ **Web Master Control Studio:** Desktop-grade admin control room to monitor stream health, override items on air, manage transcode queues, and inspect viewer analytics.
- 🌐 **Built-in Bilingual i18n:** Full English and Spanish localization out of the box, with an extensible JSON dictionary system to easily add any language.
- 📂 **Legal Media Ingest:** Purely designed for personal video archives, creative commons, public domain content, camera recordings, and local HDMI captures. No scrapers or copyright infringement.

---

## 🚀 Quick Start (Under 3 Minutes)

The fastest and most reliable way to run Home Channel HLS is with Docker Compose.

### 1. Clone the repository
```bash
git clone https://github.com/jjairocj/home-channel-hls.git
cd home-channel-hls
```

### 2. Configure Environment
```bash
cp .env.example .env
```
Open `.env` and set your desired channel name and admin credentials:
```ini
CHANNEL_NAME="My Home Channel"
ADMIN_PASSWORD="super_secret_password"
PUBLIC_BASE_URL="http://localhost:3000"
```

### 3. Start the Engine
```bash
docker compose up -d
```
That's it! Your station is now live:
- 📺 **Public TV Player:** [http://localhost:3000](http://localhost:3000)
- 🎛️ **Master Control Studio:** [http://localhost:3000/admin](http://localhost:3000/admin)
- 📡 **Live HLS Stream:** `http://localhost:3000/live/channel.m3u8`
- 📑 **XMLTV EPG Guide:** `http://localhost:3000/epg.xml`
- 📋 **IPTV M3U Playlist:** `http://localhost:3000/channel.m3u`

---

## 🏗️ System Architecture

```
                                  +-----------------------------+
                                  |   Master Control Web UI     |
                                  |    (Live Monitor, Grid)     |
                                  +--------------+--------------+
                                                 |
                                     HTTP REST / Server Events
                                                 |
  +------------------+            +--------------v--------------+            +-------------------+
  |   Legal Media    |            |                             |            |    PostgreSQL     |
  |  Ingest Folder   +----------->+    Node.js Playout Engine   +<---------->+  Database Engine  |
  | (Shows/Spots)    |            |   (Slot Composer & EPG)     |            |  (Rules & History)|
  +------------------+            +--------------+--------------+            +-------------------+
                                                 |
                                       FFmpeg Encoding Pipe
                                 (NVENC / VAAPI / VideoToolbox / CPU)
                                                 |
                                  +--------------v--------------+
                                  |  RAM Disk (/app/stream)     |
                                  |   HLS: channel.m3u8 + .ts   |
                                  +--------------+--------------+
                                                 |
                                                 v
                               +----------------------------------+
                               |     Smart TVs / IPTV Players     |
                               |    (VLC, Kodi, TiviMate, Web)    |
                               +----------------------------------+
```

---

## ⚙️ Hardware Acceleration Guide

Enable hardware transcoding in `docker-compose.yml` to minimize CPU usage:

### Option A: NVIDIA GPU (NVENC)
Uncomment the `deploy` block in `docker-compose.yml`:
```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

### Option B: Intel / AMD (VAAPI / QuickSync)
Map the host render device in `docker-compose.yml`:
```yaml
devices:
  - /dev/dri:/dev/dri
```

### Option C: CPU Fallback
By default, the engine gracefully falls back to optimized `libx264` multi-threading when no dedicated GPU is detected.

---

## 🌍 Adding New Languages (i18n)

Home Channel HLS supports multiple languages via simple JSON dictionaries located in `public/locales/`:
1. Duplicate `public/locales/en.json`.
2. Rename it to your ISO language code (e.g., `fr.json`, `de.json`, `pt.json`).
3. Translate the strings.
4. The UI language selector will automatically detect and allow users to select your language!

---

## 🤖 AI Assistant Support (`AGENTS.md`)

This repository is built with first-class AI Agent compatibility. If you are using ChatGPT, Claude, Cursor, Antigravity, or Copilot to manage or customize your channel, point the assistant to [`AGENTS.md`](./AGENTS.md) for full context on architecture, database schema, and operational commands.

---

## 📖 Detailed Documentation Wiki

- [01. Architecture & Core Playout Pipeline](./docs/en/01-architecture.md)
- [02. Getting Started & Setup Guide](./docs/en/02-getting-started.md)
- [03. Hardware Acceleration Profiles](./docs/en/03-hardware-acceleration.md)
- [04. Programming Grid, Slots & Rules](./docs/en/04-grid-and-scheduling.md)
- [05. Commercial Breaks & Bumper Rotation](./docs/en/05-commercials-and-bumpers.md)
- [06. Dynamic SVG Graphics & TTS Voiceover](./docs/en/06-dynamic-graphics-and-tts.md)
- [07. Legal Media Ingestion & Preparation](./docs/en/07-legal-media-ingest.md)
- [08. Internationalization & Adding Languages](./docs/en/08-i18n-and-translations.md)
- [09. REST API & Endpoints Reference](./docs/en/09-api-reference.md)

---

## 📄 License

This project is open-source software licensed under the [MIT License](LICENSE).
Created and maintained by Jhon Jairo Cruz.
