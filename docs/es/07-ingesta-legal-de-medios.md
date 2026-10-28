# 07. Ingesta Legal de Medios y Preparación

Home Channel HLS está comprometido con la difusión legal y ética de contenidos. La plataforma está pensada para emitir videos propios, producciones con licencia o material de dominio público y Creative Commons.

---

## Fuentes de Contenido Recomendadas

1. **Grabaciones y Archivos Personales:**
   - Videos familiares, bodas, eventos, vlogs y recuerdos personales.
2. **Producciones Independientes y Comunitarias:**
   - Cortometrajes independientes, documentales locales, noticias comunitarias o podcasts en video.
3. **Cine Abierto y Creative Commons:**
   - Proyectos de animación abierta de la Fundación Blender (*Sintel*, *Big Buck Bunny*, *Tears of Steel*, *Sprite Fright*).
4. **Archivos de Dominio Público:**
   - Archivos históricos, películas clásicas de dominio público y noticiarios antiguos libres de derechos.
5. **Captura Directa por HDMI:**
   - Cámaras de estudio, conferencias en vivo o eventos en circuito cerrado capturados mediante tarjetas de video.

---

## Métodos de Ingesta

### 1. Subida por Navegador (Subida por Bloques)
- En el panel de control (`/admin`), ve a la pestaña **Subida e Ingesta**.
- Arrastra tus archivos `.mp4`, `.mkv` o `.mov`.
- El sistema de subida por fragmentos (*chunked upload*) permite subir archivos de gran tamaño (varios gigabytes) sin cortes ni caídas de conexión.

### 2. Carpeta de Ingesta Local
- Copia tus archivos directamente en la carpeta `./data/ingest/` del servidor.
- En el panel de administración, ejecuta **Importación en Lote** para procesar los archivos y añadirlos al catálogo.

---

## Estándar de Codificación y Normalización

Cada video que ingresa es procesado automáticamente por FFmpeg para cumplir con los estándares de emisión:
- **Video:** H.264 High Profile, 1080p (1920x1080), progresivo, 6000 kbps.
- **Audio:** AAC Estéreo, 48 kHz, 192 kbps.
- **Sonoridad:** Normalizado a **-16 LUFS** / **-1.0 dBTP** según la norma EBU R128, evitando cambios bruscos de volumen entre programas y comerciales.
