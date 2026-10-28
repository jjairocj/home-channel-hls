# 03. Configuración de Aceleración por Hardware

Home Channel HLS detecta automáticamente el codificador de hardware disponible mediante `EncoderFactory.js`. Esto descarga la CPU y aprovecha la GPU para mantener una emisión 24/7 fluida y silenciosa.

---

## Codificadores Compatibles

| Hardware | Códec de Codificación | Plataformas |
| :--- | :--- | :--- |
| **GPU NVIDIA** | `h264_nvenc` | Linux, Windows (WSL2), Docker con NVIDIA Toolkit |
| **Intel / AMD** | `h264_vaapi` / `h264_qsv` | Linux, Docker mapeando `/dev/dri` |
| **Apple Silicon** | `h264_videotoolbox` | macOS Nativo (chips M1/M2/M3/M4) |
| **CPU Universal** | `libx264` | Cualquier máquina (optimizado con `-preset veryfast`) |

---

## Habilitación en Docker Compose

### Para Tarjetas NVIDIA
Descomenta el bloque de recursos en `docker-compose.yml`:
```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

### Para Gráficos Intel / AMD (QuickSync o VAAPI)
Mapea el dispositivo de aceleración de video en `docker-compose.yml`:
```yaml
devices:
  - /dev/dri:/dev/dri
```

---

## Verificación del Codificador Activo

En el panel de Master Control (`/admin`), la barra de estado superior muestra el códec en uso:
- `Encoder: h264_nvenc (NVIDIA GPU)`
- `Encoder: h264_vaapi (Intel/AMD GPU)`
- `Encoder: libx264 (CPU)`
