# 03. Hardware Acceleration Profiles

Home Channel HLS includes automatic hardware encoder detection via `EncoderFactory.js`. When hardware encoders are available, GPU utilization replaces heavy CPU video transcoding, ensuring fluid 24/7 playback with minimal host load.

---

## Supported Encoders

| Hardware | Encoder Codec | Supported Platforms |
| :--- | :--- | :--- |
| **NVIDIA GPU** | `h264_nvenc` | Linux, Windows (WSL2), Docker with NVIDIA Toolkit |
| **Intel / AMD** | `h264_vaapi` / `h264_qsv` | Linux, Docker with `/dev/dri` passed |
| **Apple Silicon** | `h264_videotoolbox` | macOS Bare-metal (M1/M2/M3/M4) |
| **Universal CPU** | `libx264` | Any platform (optimized with `-preset veryfast`) |

---

## Enabling Hardware Acceleration in Docker

### NVIDIA GPU Configuration
Ensure `nvidia-container-toolkit` is installed on your host. In `docker-compose.yml`, uncomment the GPU reservation block:
```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

### Intel QuickSync / VAAPI Configuration
Ensure `/dev/dri` exists on your host machine. Add the device mapping to your service in `docker-compose.yml`:
```yaml
devices:
  - /dev/dri:/dev/dri
```

---

## Verifying Active Encoder

In the Master Control Studio (`/admin`), the top status bar displays the active encoder:
- `Encoder: h264_nvenc (NVIDIA GPU)`
- `Encoder: h264_vaapi (Intel/AMD GPU)`
- `Encoder: libx264 (CPU)`
