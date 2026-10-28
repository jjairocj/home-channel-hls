# 09. REST API & Endpoints Reference

Home Channel HLS exposes an intuitive REST API for public video players, IPTV applications, and Master Control automation.

---

## Public Endpoints (No Authentication Required)

| Endpoint | Method | Format | Description |
| :--- | :--- | :--- | :--- |
| `/live/channel.m3u8` | `GET` | HLS Manifest | Live stream master playlist for players |
| `/live/:segment.ts` | `GET` | Video MPEG-TS | Individual video transport segments |
| `/channel.m3u` | `GET` | IPTV Playlist | M3U channel playlist with EPG and logo tags |
| `/epg.xml` | `GET` | XMLTV | 3-day electronic programming guide |
| `/api/status` | `GET` | JSON | Real-time broadcast status, current show, and elapsed time |
| `/api/schedule` | `GET` | JSON | Today's timeline or projected days (`?day=monday`) |
| `/api/schedule/clock-status` | `GET` | JSON | Current broadcast slot info and seconds remaining |

---

## Admin Endpoints (Require Session Cookie)

### Broadcast Control
- `POST /api/admin/restart`: Restarts the underlying FFmpeg playout pipeline.
- `POST /api/admin/skip`: Skips the currently playing video clip immediately.
- `POST /api/admin/resync`: Triggers a clock resynchronization to the top of the slot.

### Shows & Content
- `GET /api/admin/shows`: Retrieves all registered shows and their episodes.
- `POST /api/admin/shows`: Creates a new show.
- `DELETE /api/admin/shows/:id`: Removes a show and its associated database records.
- `POST /api/admin/shows/:id/episodes`: Registers a new episode for a show.

### Commercials & Interstitials
- `GET /api/admin/commercials`: Lists all active commercial spots and bumpers.
- `POST /api/admin/commercials`: Updates spot status or rotation parameters.
- `DELETE /api/admin/commercials/:id`: Removes a spot from circulation.

### Ingestion & Transcoding
- `POST /api/admin/upload-chunk`: Uploads a file fragment for large video ingestion.
- `POST /api/admin/upload-complete`: Reassembles uploaded chunks and queues transcode.
- `GET /api/admin/transcode/jobs`: Returns the active and recent transcode jobs.
- `POST /api/admin/batch-import`: Scans and ingests media from the local storage folder.
