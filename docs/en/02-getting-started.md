# 02. Getting Started & Setup Guide

This guide will walk you through setting up and running your own 24/7 TV station from scratch.

---

## Prerequisites

- **Docker & Docker Compose:** Installed on Linux, macOS, or Windows (WSL2).
- **Video Media:** Personal MP4/MKV video files ready for broadcast.
- *(Optional)* **GPU Drivers:** NVIDIA Container Toolkit (for NVENC) or `/dev/dri` access for Intel/AMD QuickSync.

---

## Step 1: Clone & Configure

```bash
git clone https://github.com/jjairocj/home-channel-hls.git
cd home-channel-hls
cp .env.example .env
```

Edit `.env` with your settings:
```ini
CHANNEL_NAME="My Studio Network"
CHANNEL_CALLSIGN="ST-01"
TZ="America/New_York"
ADMIN_PASSWORD="ChooseAStrongPassword123"
```

---

## Step 2: Launch the Stack

Run Docker Compose to spin up the playout engine and bundled PostgreSQL container:
```bash
docker compose up -d
```

Verify that the containers are healthy:
```bash
docker compose ps
```

---

## Step 3: Access Master Control Studio

Open your browser and navigate to:
```
http://localhost:3000/admin
```
Log in using the password configured in `ADMIN_PASSWORD`.

From the Master Control room you can:
1. **Upload Shows & Episodes:** Add series names and drag-and-drop video files.
2. **Configure Commercials & Bumpers:** Upload bumpers and ad spots to run between shows.
3. **Set the Schedule Grid:** Assign your shows to specific time slots on each day of the week.
4. **Monitor the Live Feed:** View the real-time HLS broadcast and current clock sync status.
