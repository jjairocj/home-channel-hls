# 09. Referencia Completa de Endpoints de la API

Home Channel HLS ofrece una API REST para reproductores de video públicos, aplicaciones IPTV y automatización del Master Control.

---

## Endpoints Públicos (No Requieren Autenticación)

| Endpoint | Método | Formato | Descripción |
| :--- | :--- | :--- | :--- |
| `/live/channel.m3u8` | `GET` | Manifiesto HLS | Lista maestra para reproductores de streaming |
| `/live/:segmento.ts` | `GET` | MPEG-TS | Segmentos individuales de video |
| `/channel.m3u` | `GET` | Lista M3U | Lista IPTV con metadatos EPG y logotipo |
| `/epg.xml` | `GET` | XMLTV | Guía electrónica de programación de 3 días |
| `/api/status` | `GET` | JSON | Estado actual de emisión, programa al aire y tiempo restante |
| `/api/schedule` | `GET` | JSON | Programación del día o proyectada (`?day=lunes`) |
| `/api/schedule/clock-status` | `GET` | JSON | Información del bloque horario actual y segundos faltantes |

---

## Endpoints de Administración (Requieren Sesión de Admin)

### Control de Emisión
- `POST /api/admin/restart`: Reinicia el proceso de codificación de FFmpeg.
- `POST /api/admin/skip`: Salta inmediatamente el clip que se encuentra al aire.
- `POST /api/admin/resync`: Fuerza la sincronización de reloj con el inicio del bloque.

### Gestión de Programas
- `GET /api/admin/shows`: Obtiene la lista completa de series y sus episodios.
- `POST /api/admin/shows`: Crea una nueva serie en el catálogo.
- `DELETE /api/admin/shows/:id`: Elimina una serie y sus episodios asociados.
- `POST /api/admin/shows/:id/episodes`: Registra un nuevo capítulo.

### Comerciales y Cortinillas
- `GET /api/admin/commercials`: Lista los comerciales y cortinillas en rotación.
- `POST /api/admin/commercials`: Modifica el estado o rol de una pieza.
- `DELETE /api/admin/commercials/:id`: Retira un comercial de la emisión.

### Ingesta y Transcodificación
- `POST /api/admin/upload-chunk`: Sube un fragmento de video de gran tamaño.
- `POST /api/admin/upload-complete`: Ensambla los fragmentos e inicia la codificación.
- `GET /api/admin/transcode/jobs`: Devuelve la cola de trabajos activos y recientes.
- `POST /api/admin/batch-import`: Importa en lote los archivos de la carpeta local.
