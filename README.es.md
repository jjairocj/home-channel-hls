# 📺 Home Channel HLS

> **Motor de Emisión Lineal 24/7 y Estudio Master Control de Código Abierto**  
> *Transmite tu propio canal continuo de televisión con salida HLS, guía EPG automática, cortinillas dinámicas y tandas comerciales.*

[![Licencia: MIT](https://img.shields.io/badge/Licencia-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-22.x_LTS-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Listo-2496ED.svg)](https://www.docker.com/)
[![i18n](https://img.shields.io/badge/i18n-English_%7C_Espa%C3%B1ol-orange.svg)](./public/locales/)

[**[Read in English]**](./README.md) • [**[Guía para Desarrolladores e IA (AGENTS.md)]**](./AGENTS.md) • [**[Wiki de Documentación Completa]**](./docs/es/01-arquitectura.md)

---

## ✨ Características Principales

- 🛰️ **Emisión Continua HLS 24/7:** Transmisión lineal fluida de arranque rápido y baja latencia (low-buffer), compatible directamente con navegadores web, Smart TVs, Android TV, Apple TV y aplicaciones IPTV (VLC, Kodi, TiviMate).
- 🕒 **Sincronización Estricta de Reloj:** Bloques horarios exactos alineados a la hora en punto (`:00`) y a la media hora (`:30`). La programación nunca se desfasa a lo largo del día.
- 📼 **Compositor Inteligente de Cortes Comerciales:** Llena dinámicamente las pausas entre episodios con cortinillas de apertura (*"Estás viendo..."*), comerciales sin repetición consecutiva, idents temáticos y adelantos de cierre (*"A continuación..."*).
- 🎙️ **Carteleras y Locución Dinámica:** Genera gráficos vectoriales SVG en tiempo real y anuncia los próximos programas mediante voces neuronales (ElevenLabs API o síntesis local con edge-tts).
- 📻 **Emisora de Radio FM 24/7 Integrada:** Flujo de audio HLS dedicado con locutor DJ neuronal automatizado, rotación musical sin repetición consecutiva de artistas, jingles periódicos y sintonizador web retro estilo Hi-Fi de los 90 con display digital RDS.
- 📅 **Parrilla Semanal y EPG por Reglas:** Planificador visual de programación, avance automático de capítulos diarios, maratones de fin de semana y exportación de guía XMLTV (`/epg.xml`).
- ⚡ **Aceleración por Hardware Multiplataforma:** Soporte para NVIDIA NVENC, Intel QuickSync/VAAPI, Apple Silicon VideoToolbox y respaldo ultra-eficiente por CPU (`libx264`).
- 🎛️ **Estudio Web Master Control:** Panel de administración profesional para monitorear la señal en tiempo real, saltar contenidos al aire, gestionar la cola de codificación y ver métricas de audiencia.
- 🌐 **Internacionalización Bilingüe Integrada:** Interfaz 100% traducida a Español e Inglés, con un sistema de diccionarios JSON abierto para que cualquiera pueda traducirlo a su idioma.
- 📂 **Ingesta Legal de Medios:** Diseñado exclusivamente para producciones propias, archivos de video personales, capturas HDMI de circuito cerrado, material Creative Commons y de dominio público. Cero scrapers ni descargas no autorizadas.

---

## 🚀 Inicio Rápido (En Menos de 3 Minutos)

La forma más rápida y confiable de poner en marcha tu canal es mediante Docker Compose.

### 1. Clonar el repositorio
```bash
git clone https://github.com/jjairocj/home-channel-hls.git
cd home-channel-hls
```

### 2. Configurar Variables de Entorno
```bash
cp .env.example .env
```
Abre `.env` y define el nombre de tu estación y tus credenciales de administración:
```ini
CHANNEL_NAME="Mi Canal de TV"
ADMIN_PASSWORD="clave_secreta_aqui"
PUBLIC_BASE_URL="http://localhost:3000"
```

### 3. Iniciar el Motor
```bash
docker compose up -d
```
¡Listo! Tu estación de televisión está al aire:
- 📺 **Reproductor Web Público:** [http://localhost:3000](http://localhost:3000)
- 🎛️ **Master Control Studio:** [http://localhost:3000/admin](http://localhost:3000/admin)
- 📡 **Flujo TV HLS en Vivo:** `http://localhost:3000/live/channel.m3u8`
- 📻 **Flujo Radio FM en Vivo:** `http://localhost:3000/live/radio/main/radio.m3u8`
- 📑 **Guía de TV XMLTV (EPG):** `http://localhost:3000/epg.xml`
- 📋 **Lista IPTV M3U:** `http://localhost:3000/channel.m3u`

---

## 🏗️ Arquitectura del Sistema

```
                                  +-----------------------------+
                                  |    Panel Web Master Control |
                                  |    (Monitor en Vivo, Grilla)|
                                  +--------------+--------------+
                                                 |
                                     HTTP REST / Server Events
                                                 |
  +------------------+            +--------------v--------------+            +-------------------+
  |   Carpeta de     |            |                             |            |    PostgreSQL     |
  |  Ingesta Legal   +----------->+    Motor Playout Node.js    +<---------->+    Base de Datos  |
  | (Series/Spots)   |            |   (Compositor y Guía EPG)   |            |  (Reglas y Estado)|
  +------------------+            +--------------+--------------+            +-------------------+
                                                 |
                                     Tubería FFmpeg en Tiempo Real
                                 (NVENC / VAAPI / VideoToolbox / CPU)
                                                 |
                                   +--------------v--------------+
                                   |   Disco en RAM (/app/stream)|
                                   |   HLS: channel.m3u8 + .ts   |
                                   +--------------+--------------+
                                                 |
                                                 v
                               +----------------------------------+
                               |     Smart TVs / Reproductores    |
                               |    (VLC, Kodi, TiviMate, Web)    |
                               +----------------------------------+
```

---

## 📻 Emisora de Radio FM 24/7 Integrada

Además de la emisión televisiva, Home Channel HLS incluye una estación de radio FM automatizada e independiente:

- **Flujo de Audio HLS Dedicado:** Transmite audio puro (`/live/radio/main/radio.m3u8`) reproducible en navegadores web, dispositivos móviles y clientes IPTV.
- **Sintonizador Web Retro Hi-Fi:** El reproductor web permite conmutar entre TV y Radio. Incluye un dial analógico con aguja de frecuencia, indicadores de señal luminosos, potenciómetro de volumen y marquesina digital RDS con título y artista en tiempo real.
- **DJ Neuronal Automatizado:** Genera presentaciones habladas de las canciones utilizando síntesis de voz neuronal (`edge-tts` o ElevenLabs), con redacción dinámica y limpieza de guiones.
- **Rotación Musical Inteligente:** Algoritmo que evita la repetición consecutiva del mismo artista (`shuffleAvoidingArtist`) e introduce cortinillas (jingles) de identificación cada 4 pistas.
- **Estructura de Carpetas:**
  - `media/radio/music/` — Archivos de música (`.mp3`, `.flac`, `.m4a`, `.wav`).
  - `media/radio/jingles/` — Identificadores de estación y efectos de sonido.

---

## ⚙️ Guía de Aceleración por Hardware

Para reducir el uso de CPU al mínimo, habilita el codificador por hardware en `docker-compose.yml`:

### Opción A: GPU NVIDIA (NVENC)
Descomenta el bloque `deploy` en `docker-compose.yml`:
```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

### Opción B: Intel / AMD (VAAPI / QuickSync)
Mapea el dispositivo de renderizado en `docker-compose.yml`:
```yaml
devices:
  - /dev/dri:/dev/dri
```

### Opción C: Fallback por CPU
Por defecto, si no se detecta una GPU dedicada, el motor opera con `libx264` multi-hilo optimizado.

---

## 🌍 Cómo Agregar Nuevos Idiomas (i18n)

Home Channel HLS utiliza un sistema modular de diccionarios JSON en `public/locales/`:
1. Duplica `public/locales/es.json` (o `en.json`).
2. Renómbralo con el código ISO de tu idioma (ej: `fr.json` para francés, `pt.json` para portugués, `de.json` para alemán).
3. Traduce los textos correspondientes.
4. ¡El selector de idioma en la barra superior lo detectará automáticamente!

---

## 🧪 Suite de Pruebas Automatizadas y Calidad

Una transmisión continua 24/7 requiere cero desfase, rotación limpia de segmentos y sincronización estricta. El proyecto cuenta con **más de 110 pruebas automatizadas** que validan:
- Matemática de reloj y cumplimiento de fronteras horarias (`:00` y `:30`).
- Mantenimiento del búfer HLS, prioridad de codificación y fallback de hardware.
- Composición de cortes comerciales y reglas de enfriamiento anti-repetición.
- Escape de caracteres y precisión de formato en la guía XMLTV EPG.
- Normalización de sonoridad (EBU R128) y selección preferencial de pistas de audio.

Ejecuta las pruebas en cualquier momento:
```bash
npm test
```

---

## 🤖 Guía para Desarrolladores y Asistentes de IA (`AGENTS.md`)

Este repositorio incluye un manual técnico exhaustivo en [`AGENTS.md`](./AGENTS.md). Tanto para desarrolladores humanos que deseen auditar la arquitectura como para asistentes de código (ChatGPT, Claude, Cursor, Antigravity, Copilot), [`AGENTS.md`](./AGENTS.md) detalla los contratos del esquema de base de datos, algoritmos de sincronización y tuberías de transcodificación.

---

## 📖 Wiki de Documentación Detallada

- [01. Arquitectura y Pipeline de Emisión](./docs/es/01-arquitectura.md)
- [02. Guía de Instalación y Puesta en Marcha](./docs/es/02-inicio-rapido.md)
- [03. Configuración de Aceleración por Hardware](./docs/es/03-aceleracion-hardware.md)
- [04. Parrilla de Programación, Bloques y Reglas](./docs/es/04-parrilla-y-programacion.md)
- [05. Pausas Comerciales y Rotación de Cortinillas](./docs/es/05-comerciales-y-cortinillas.md)
- [06. Gráficas Vectoriales Dinámicas y Locución TTS](./docs/es/06-graficas-dinamicas-y-tts.md)
- [07. Ingesta Legal de Medios y Preparación](./docs/es/07-ingesta-legal-de-medios.md)
- [08. Internacionalización y Agregar Idiomas](./docs/es/08-i18n-y-traducciones.md)
- [09. Referencia Completa de Endpoints de la API](./docs/es/09-referencia-api.md)

---

## 📄 Licencia

Este proyecto es software libre bajo los términos de la [Licencia MIT](LICENSE).  
Creado y mantenido por Jhon Jairo Cruz.
