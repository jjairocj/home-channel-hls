# 06. Dynamic SVG Graphics & TTS Voiceover

Home Channel HLS can dynamically generate vector graphics overlays and neural voice announcements for on-screen bumpers and daily schedule billboards.

---

## Architecture of Dynamic Graphics

```
+---------------------+     +----------------------+     +----------------------+
|  NextUpDecorator    | --> |  SVG Template Render | --> |   @resvg/resvg-js    |
| (Reads Next Shows)  |     | (billboard / nextUp) |     |  (Fast PNG raster)   |
+---------------------+     +----------------------+     +----------+-----------+
                                                                    |
                                                                    v
+---------------------+     +----------------------+     +----------v-----------+
|   ElevenLabs API /  | --> | Audio Normalization  | --> |   FFmpeg MP4 Encode  |
|   Local edge-tts    |     | (EBU R128 -16 LUFS)  |     | (1080p, Video+Audio) |
+---------------------+     +----------------------+     +----------------------+
```

---

## Billboard ("Today's Schedule")
- Renders an on-screen billboard listing the next 3 programs with their air times.
- Background graphics and text layout adapt based on channel branding.

## Next-Up Bumpers ("Coming Up Next")
- Placed immediately before an upcoming show.
- Displays the upcoming title with animated background and audio announcement:
  *"Coming up next... Sci-Fi Chronicles... at eight o'clock... only on Home Channel."*

---

## Configuring TTS Voiceover

In `.env`, configure your preferred speech engine:

```ini
# Option 1: ElevenLabs Neural Voice (Highest Quality)
ELEVENLABS_API_KEY="your_api_key_here"
ELEVENLABS_VOICE_ID="QpDQJR3frbDwOhTIo8nW"

# Option 2: Local edge-tts (Built-in, No API key required)
# If ELEVENLABS_API_KEY is omitted, edge-tts is used automatically.
```
