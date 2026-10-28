# 01. System Architecture & Playout Pipeline

**Home Channel HLS** is designed as a carrier-grade linear television broadcast system running on consumer or workstation hardware. It decouples high-level timeline planning from low-level real-time video encoding.

---

## High-Level Topology

```
+-------------------------------------------------------------------------+
|                              Master Control Room                        |
|                                                                         |
|  [ Web Admin Studio ] <==== WebSocket / REST ====> [ Express Server ]   |
+-------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------+
|                           Core Orchestration Layer                      |
|                                                                         |
|  - Scheduler: Computes exact 30/60 minute clock-aligned slots           |
|  - BlockComposer: Assembles Main Show + Break-In + Ads + Break-Out      |
|  - Database: PostgreSQL (Primary Source of Truth) + In-Memory Fallback  |
+-------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------+
|                        Real-Time Playout Subsystem                      |
|                                                                         |
|  - PlayoutEngine: Manages the active 24-hour circular playback queue    |
|  - FfmpegHlsProcess: Spawns FFmpeg with dynamic concat/filter graph     |
|  - EncoderFactory: Auto-detects NVIDIA NVENC, Intel VAAPI, or CPU       |
|  - ClockSync: Aligns slot boundaries to real-world :00 / :30            |
+-------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------+
|                             Output Delivery                             |
|                                                                         |
|  - RAM Disk (/app/stream): Generates .ts segments and channel.m3u8      |
|  - EPG Generator: Serves XMLTV guide at /epg.xml                        |
|  - M3U Generator: Serves IPTV playlist at /channel.m3u                  |
+-------------------------------------------------------------------------+
```

---

## Playout Pipeline Breakdown

### 1. Slot Assembly & Math
Linear television requires programs to begin predictably at `:00` or `:30`. When an episode has a duration of 21 minutes and 30 seconds, `BlockComposer` calculates:
$$\text{Remaining Time} = 1800\text{s} - 1290\text{s} = 510\text{s}$$
It automatically fills this 510-second gap with:
- An opening bumper (`break_in`, ~5s)
- Commercial spots selected via a cooling-down rotation algorithm
- A closing "Coming Up Next" card (`break_out`, ~10s)

### 2. FFmpeg HLS Pipeline
The active playlist is fed to an optimized FFmpeg process that converts video to 1080p H.264 video with AAC stereo audio normalized to the EBU R128 broadcast loudness standard (-16 LUFS). Video segments (`.ts`) are stored in an in-memory `tmpfs` RAM disk to guarantee high-throughput read/write without SSD wear.

### 3. Database Resilience
PostgreSQL stores show metadata, episode pointers, schedules, and audience logs. If the database connection is interrupted:
- The engine seamlessly continues broadcasting from an in-memory replica.
- Changes are batched to a local JSON cache (`data/db.json`).
- When PostgreSQL reconnects, transactions are synchronized automatically without interrupting the live stream.
