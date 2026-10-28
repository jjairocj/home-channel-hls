# 07. Legal Media Ingestion & Preparation

Home Channel HLS is committed to legal, ethical broadcasting. It is designed to broadcast media that you own, have licensed, or that resides in the public domain or under Creative Commons licenses.

---

## Approved Sources for Your Station

1. **Personal Productions & Home Archives:**
   - Home videos, wedding recordings, vlogs, vacation films, family celebrations.
2. **Community & Independent Filmmaking:**
   - Independent documentaries, short films, campus news, student animations.
3. **Creative Commons & Open Source Cinema:**
   - Works from Blender Open Projects (*Big Buck Bunny*, *Sintel*, *Cosmos Laundromat*, *Tears of Steel*).
4. **Public Domain Archives:**
   - Historical newsreels, early 20th-century classic cinema (via Internet Archive or Library of Congress).
5. **Live Closed-Circuit HDMI Feeds:**
   - Studio cameras, local gaming captures, or security monitors passed via capture cards.

---

## Ingest Methods

### 1. Browser Drag-and-Drop (Chunked Upload)
- Open Master Control (`/admin`) and navigate to the **Upload & Ingest** tab.
- Drag and drop your `.mp4`, `.mkv`, or `.mov` files.
- Chunked uploads automatically handle files of any size (even dozens of gigabytes) without web server timeouts.

### 2. Local Mount / Directory Scan
- Place your video files in the mounted folder `./data/ingest/`.
- In Master Control, select **Batch Import** to register and queue the folder's files into the transcode pipeline.

---

## Automatic Transcode & Normalization Standards

Every ingested file is automatically converted to broadcast standard:
- **Video:** H.264 High Profile, 1080p (1920x1080), progressive, 6000 kbps bitrate.
- **Audio:** AAC Stereo, 48 kHz, 192 kbps.
- **Loudness:** Normalized to **-16 LUFS** / **-1.0 dBTP** according to the EBU R128 standard, preventing sudden volume jumps between shows and commercials.
