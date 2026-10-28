# 01. Arquitectura del Sistema y Tubería de Emisión

**Home Channel HLS** está diseñado como un sistema de transmisión de televisión lineal continuo de alta disponibilidad, capaz de operar tanto en servidores domésticos como en estaciones de trabajo dedicadas.

---

## Topología General

```
+-------------------------------------------------------------------------+
|                        Sala de Control Maestro (MCR)                    |
|                                                                         |
|  [ Panel Web Admin ] <==== WebSocket / REST ====> [ Servidor Express ]  |
+-------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------+
|                          Capa de Orquestación                           |
|                                                                         |
|  - Scheduler: Planifica bloques de 30/60 min alineados al reloj real    |
|  - BlockComposer: Ensambla Programa + Apertura + Comerciales + Cierre   |
|  - Base de Datos: PostgreSQL (Fuente Oficial) + Caché en Memoria        |
+-------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------+
|                        Subsistema de Emisión Real                       |
|                                                                         |
|  - PlayoutEngine: Controla la cola circular de emisión de 24 horas      |
|  - FfmpegHlsProcess: Ejecuta el proceso FFmpeg con segmentación HLS     |
|  - EncoderFactory: Detecta hardware NVIDIA NVENC, Intel VAAPI o CPU     |
|  - ClockSync: Sincroniza los cambios de bloque al minuto :00 / :30      |
+-------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------+
|                           Salida y Distribución                         |
|                                                                         |
|  - Disco en RAM (/app/stream): Genera segmentos .ts y channel.m3u8      |
|  - Generador EPG: Guía XMLTV para IPTV en /epg.xml                      |
|  - Generador M3U: Lista de reproducción IPTV en /channel.m3u            |
+-------------------------------------------------------------------------+
```

---

## Componentes Clave

### 1. Cálculo y Composición de Bloques
La televisión lineal requiere que los programas comiencen exactamente en la hora en punto (`:00`) o en la media hora (`:30`). Si un episodio dura 21 minutos con 30 segundos, el `BlockComposer` calcula:
$$\text{Tiempo Restante} = 1800\text{s} - 1290\text{s} = 510\text{s}$$
Este espacio de 510 segundos se cubre automáticamente con:
- Una cortinilla de apertura (`break_in`, ~5 s: *"Estás viendo..."*).
- Anuncios y piezas comerciales seleccionados mediante algoritmo de enfriamiento cíclico.
- Una cortinilla de cierre (`break_out`, ~10 s: *"A continuación..."*).

### 2. Segmentación HLS en Disco RAM
Los segmentos `.ts` se escriben en un sistema de archivos en memoria RAM (`tmpfs`), garantizando lecturas instantáneas para los reproductores web y aplicaciones de IPTV, eliminando el desgaste por escritura continua en discos SSD.

### 3. Tolerancia a Fallos de Base de Datos
PostgreSQL almacena las series, reglas y el historial. Si la base de datos se desconecta temporalmente, el motor continúa emitiendo sin interrupciones desde su copia en memoria y guarda cambios en un archivo JSON atómico (`data/db.json`). Al reanudarse la conexión, sincroniza automáticamente los datos.
