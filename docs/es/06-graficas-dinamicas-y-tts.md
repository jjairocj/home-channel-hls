# 06. Gráficas Vectoriales Dinámicas y Locución TTS

Home Channel HLS puede generar automáticamente gráficos en pantalla y locuciones sintetizadas para anunciar los próximos programas y carteleras del día.

---

## Flujo de Generación de Gráficas

```
+---------------------+     +----------------------+     +----------------------+
|   NextUpDecorator   | --> |  Plantilla SVG Din.  | --> |   @resvg/resvg-js    |
| (Lee Próximos Shows)|     | (billboard / nextUp) |     | (Rasterizado Rápido) |
+---------------------+     +----------------------+     +----------+-----------+
                                                                    |
                                                                    v
+---------------------+     +----------------------+     +----------v-----------+
|   ElevenLabs API /  | --> | Normalización Audio  | --> |    Montaje FFmpeg    |
|    edge-tts Local   |     | (EBU R128 -16 LUFS)  |     | (1080p, Video+Audio) |
+---------------------+     +----------------------+     +----------------------+
```

---

## Cartelera del Día ("Hoy en el Canal")
- Presenta en pantalla los 3 programas siguientes con su horario correspondiente.
- El diseño SVG se adapta automáticamente al nombre y colores configurados para el canal.

## Cortinillas "A Continuación"
- Se colocan al cierre de la tanda comercial, justo antes del programa siguiente.
- Muestran el título y hora acompañados de locución:
  *"¡A continuación!... Crónicas Sci-Fi... a las ocho... solo aquí, por Home Channel."*

---

## Configuración de Voces (TTS)

En el archivo `.env`:

```ini
# Opción 1: ElevenLabs (Voz neuronal de alta expresividad)
ELEVENLABS_API_KEY="tu_clave_de_api"
ELEVENLABS_VOICE_ID="id_de_voz"

# Opción 2: edge-tts (Integrado, libre y gratuito, no requiere clave)
# Si no defines ELEVENLABS_API_KEY, el sistema usa edge-tts de forma transparente.
```
