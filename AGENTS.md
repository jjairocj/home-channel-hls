# AGENTS.md — AI Developer & Assistant Instructions
*Home Channel HLS — 24/7 Linear Playout Engine*

> This document contains comprehensive architecture details, file maps, runtime contracts, and operational guidelines for AI Coding Assistants (ChatGPT, Claude, Antigravity, GitHub Copilot, Cursor, etc.). When a user asks you to configure, debug, customize, or extend this application, read and follow these specifications.

---

## 1. Project Overview & Mission

**Home Channel HLS** is an open-source, production-grade 24/7 linear broadcast playout engine designed for personal, home, community, or educational television channels. It ingests legally obtained media (personal videos, home archives, licensed media, Creative Commons, and public domain material), normalizes it to broadcast quality (1080p H.264 + EBU R128 audio), organizes it into strict clock-aligned broadcast slots (30 or 60 minutes), composes commercial breaks with anti-repetition rules, generates dynamic on-screen bumpers, and streams continuous HLS (`.m3u8` / `.ts`) along with XMLTV EPG data.

### Core Architectural Axioms
1. **Clock-Aligned Slots:** Broadcast slots strictly synchronize to the real-world clock (`:00` and `:30`). Playout never drifts across hours.
2. **Seamless HLS Streaming:** Live segments are generated into a RAM disk (`/app/stream` tmpfs) to avoid SSD wear and ensure zero-latency delivery to IPTV, Smart TVs, and web players.
3. **Resilient Dual Storage:** Metadata is stored in PostgreSQL as the source of truth, with an automatic in-memory cache and atomic local JSON backup (`data/db.json`). If PostgreSQL disconnects, the channel continues broadcasting uninterrupted from memory.
4. **Automated Interstitials:** Commercial breaks open with a bumper (`break_in`), fill the remaining time budget with non-repeating spots, and close with an upcoming preview (`break_out`).
5. **Privacy & Security:** Full `X-Robots-Tag: noindex` blocking on all routes, reverse-proxy IP trust validation, session-token cookie authentication, and path traversal guards (`safeJoin`).

---

## 2. Directory Structure & File Map

```
home-channel-hls/
├── server.js                   # Application entry point & Express HTTP server
├── scheduler.js                # Top-level timeline planner & slot orchestrator
├── transcoder.js               # Background video transcoder facade
├── Dockerfile                  # Production container definition (Node 22 + FFmpeg + edge-tts)
├── docker-compose.yml          # 1-click Docker stack (Engine + PostgreSQL 16)
├── .env.example                # Documented configuration template
├── AGENTS.md                   # AI Assistant instructions (this file)
│
├── core/
│   └── time.js                 # High-precision time parsing, slot calculations, and timecode formatting
│
├── database/                   # Database subsystem
│   ├── index.js                # High-level database facade (backward-compatible API)
│   ├── PgConnection.js         # Resilient PostgreSQL pool with automatic reconnection
│   ├── PgSync.js               # Bidirectional memory ⇄ PostgreSQL synchronization
│   ├── LocalJsonStore.js       # Atomic in-memory & disk JSON fallback
│   ├── sql.js                  # Centralized PostgreSQL queries & prepared statements
│   ├── migrations.js           # Automated schema migrations
│   ├── init.sql                # Complete schema definition for new PostgreSQL installations
│   └── repositories/           # Domain aggregates (shows, commercials, rules, airing logs, audience)
│
├── playout/                    # Real-time video playout engine
│   ├── PlayoutEngine.js        # FFmpeg process lifecycle, clock resync, item switching
│   ├── PlayoutQueue.js         # Circular queue of 24h planned broadcast blocks
│   ├── FfmpegHlsProcess.js     # Low-level FFmpeg spawn with HLS segmenting & NVENC/VAAPI/CPU encoders
│   ├── EncoderFactory.js       # Hardware encoder detection (NVENC, VAAPI, VideoToolbox, libx264)
│   ├── SegmentJanitor.js       # Cleans expired HLS segments (.ts) from RAM disk
│   ├── StatusPresenter.js      # Formats public /api/status payload
│   └── LowerThirds.js          # On-screen graphics overlay management
│
├── scheduling/                 # Linear schedule & break composition
│   ├── Scheduler.js            # Main scheduling engine & 24h timeline generator
│   ├── SchedulePlanner.js      # Slot calculator based on active programming rules
│   ├── BlockComposer.js        # Fills 30/60 min slots with main show + bumpers + commercials
│   ├── CommercialRotation.js   # Anti-repetition algorithm with cooling-down windows
│   ├── DailyEpisodes.js        # Tracks episodic progression & prevents intraday repeats
│   ├── NextUpDecorator.js      # Inserts dynamic "Next Up" cards into commercial breaks
│   └── XmltvExporter.js        # Generates standard XMLTV EPG data
│
├── programming/                # Rule-based programming engine
│   ├── ScheduleService.js      # CRUD service for weekly grid rules
│   ├── ProgrammingManager.js   # Proposal engine for auto-scheduling weekly shows
│   └── sagas.js                # Automatic detection and progression of show seasons/sagas
│
├── library/                    # Media catalogs & dynamic bumper generators
│   ├── MediaLibrary.js         # Show and episode indexing
│   ├── BumperCatalog.js        # Categorized bumper deck with role rotation & cooldown
│   ├── DurationCatalog.js      # Fast ffprobe duration cache
│   ├── billboardTemplate.js    # SVG generator for daily TV schedule cards
│   ├── nextUpTemplate.js       # SVG generator for "Next Up" bumper slides
│   └── audio8Client.js         # ElevenLabs / edge-tts client for dynamic announcer voiceovers
│
├── transcoding/                # Media ingestion & video normalization
│   ├── Transcoder.js           # Transcode queue management
│   ├── TranscodeJobRunner.js   # Executes FFmpeg (1080p, 30/60fps, EBU R128 loudnorm)
│   └── AudioTrackSelector.js   # Selects preferred audio tracks from multilingual MKVs
│
├── audience/                   # Anonymous analytics
│   ├── AudienceTracker.js      # Concurrent viewer counter from HLS manifest requests
│   └── AudienceStats.js        # Aggregations, peak viewers, and session durations
│
├── routes/                     # Express REST API routes
│   ├── public.js               # Public endpoints: /live, /channel.m3u8, /epg.xml, /api/status
│   ├── admin.js                # Master Control endpoints: shows, commercials, playout control
│   ├── imports.js              # Ingestion: chunked browser upload, local folder scanning
│   └── programmer.js           # Schedule grid & rule editor endpoints
│
└── public/                     # Frontend user interface
    ├── index.html              # Retro TV web player & viewer interface
    ├── locales/                # Internationalization JSON dictionaries (en.json, es.json)
    ├── shared/i18n.js          # Client-side i18n translation manager
    └── admin/                  # Web-based Master Control Studio (desktop UI)
        ├── index.html          # Master Control dashboard
        ├── login.html          # Admin authentication screen
        └── js/                 # Modular frontend controllers
```

---

## 3. Environment Variables Reference

When helping users configure `.env`, consult this table:

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `CHANNEL_NAME` | `Home Channel` | Channel name displayed on EPG, M3U playlist, and bumpers |
| `CHANNEL_CALLSIGN`| `CH-01` | Short callsign for station identification |
| `PORT` | `3000` | HTTP listening port for Express server |
| `TZ` | `America/Bogota` | Timezone for clock synchronization and EPG times |
| `PUBLIC_BASE_URL` | `http://localhost:3000`| Canonical public URL used in HLS manifests and M3U playlists |
| `ADMIN_PASSWORD` | `admin123` | Initial password for accessing `/admin` Master Control |
| `ADMIN_SECRET` | *random string* | Secret key for signing authenticated session cookies |
| `PG_HOST` | `db` (or `localhost`) | PostgreSQL hostname |
| `PG_PORT` | `5432` | PostgreSQL port |
| `PG_USER` | `channel_user` | PostgreSQL username |
| `PG_PASSWORD` | `channel_password` | PostgreSQL password |
| `PG_DATABASE` | `homechannel` | PostgreSQL database name |
| `VIDEO_ENCODER` | `auto` | Encoders: `auto`, `h264_nvenc`, `h264_vaapi`, `h264_videotoolbox`, `libx264` |
| `ELEVENLABS_API_KEY`| *(optional)* | ElevenLabs API key for dynamic TTS voiceovers |
| `ELEVENLABS_VOICE_ID`| *(optional)* | Announcer Voice ID |

---

## 4. Key Workflows for AI Assistants

### A. How to Add or Organize Content (Shows & Commercials)
1. **Shows / Series:**
   - Placed in `data/media/shows/<show_id>/`.
   - Episodes follow naming convention: `Show Title - S01E01 - Episode Name.mp4`.
   - Registered in database via `db.createShow()` and `db.addEpisodeToShow()`.
2. **Commercials & Bumpers:**
   - Placed in `data/media/commercials/` or `data/media/bumpers/`.
   - Identified by roles: `break_in` (opens break), `break_out` (closes break), `commercial` (ad spot), `station_id` (thematic ident), `filler` (short cushion).
   - Ingested files are automatically queued in `transcode_jobs` to convert them to broadcast standard (1080p, 6000k video, EBU R128 -16 LUFS normalized audio).

### B. How Clock Synchronization Works (`PlayoutEngine`)
- Linear broadcast requires shows to start at exact top of the hour or half-hour (`:00` or `:30`).
- If an episode runs 22 minutes, `BlockComposer` computes a remaining budget of 8 minutes (480s).
- It opens with a 5s `break_in` bumper ("You're watching..."), selects commercials based on cooldown history, and closes with a `break_out` bumper ("Coming up next...").
- At slot boundaries (`:00` / `:30`), `PlayoutEngine.syncToClock()` ensures the video stream perfectly matches the real-world clock time.

### C. How to Add a New UI Language
1. Copy `public/locales/en.json` to `public/locales/<lang_code>.json` (e.g., `fr.json`, `de.json`, `pt.json`).
2. Translate all value strings.
3. In HTML, mark elements with `data-i18n="section.key"`.
4. In JavaScript, call `i18n.t('section.key', { varName: 'val' })`.

### D. Running Unit Tests
- The project includes comprehensive tests covering scheduling, EPG generation, clock math, commercial rotation, audio normalization, and security.
- Run tests with:
  ```bash
  npm test
  ```
- All test files are located in `test/*.test.js` using Node.js built-in test runner (`node --test`).

---

## 5. Security & Legal Guardrails
- **Never include illegal scraping or download tools:** Ingestion is exclusively designed for user-owned files, local recording mounts, and public domain archives.
- **Never hardcode passwords or database credentials in source code:** Always read credentials from `process.env`.
- **Never bypass `safeJoin`:** Any file path received from user requests must be sanitized using `safeJoin(baseDir, userInput)` to prevent path traversal attacks.
- **No copyright infringement:** Generic placeholders must be used in documentation and examples.
