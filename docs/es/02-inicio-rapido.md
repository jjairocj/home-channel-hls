# 02. Guía de Instalación y Puesta en Marcha

Esta guía explica paso a paso cómo desplegar tu canal de televisión 24/7 en minutos.

---

## Requisitos Previos

- **Docker y Docker Compose:** Instalado en Linux, macOS o Windows (WSL2).
- **Archivos de Video:** Tus videos propios en formato MP4 o MKV.
- *(Opcional)* **Controladores de GPU:** NVIDIA Container Toolkit (para NVENC) o acceso a `/dev/dri` para Intel/AMD QuickSync.

---

## Paso 1: Clonar y Configurar

```bash
git clone https://github.com/jjairocj/home-channel-hls.git
cd home-channel-hls
cp .env.example .env
```

Edita `.env` con los datos de tu canal:
```ini
CHANNEL_NAME="Mi Canal Personal"
CHANNEL_CALLSIGN="CANAL-1"
TZ="America/Bogota"
ADMIN_PASSWORD="EligeUnaClaveSegura123"
```

---

## Paso 2: Iniciar el Canal

Ejecuta Docker Compose para levantar el motor de emisión junto con la base de datos PostgreSQL:
```bash
docker compose up -d
```

Verifica el estado de los contenedores:
```bash
docker compose ps
```

---

## Paso 3: Ingreso a la Sala de Control Maestro

Ingresa en tu navegador a:
```
http://localhost:3000/admin
```
Inicia sesión con la clave definida en `ADMIN_PASSWORD`.

Desde el panel de control podrás:
1. **Subir Series y Episodios:** Crear series y arrastrar capítulos para codificarlos automáticamente.
2. **Gestionar Comerciales y Cortinillas:** Subir spots publicitarios e intros de estación.
3. **Organizar la Parrilla Semanal:** Asignar los programas a sus respectivos horarios.
4. **Monitorear la Señal:** Ver el reproductor en vivo y el estado de sincronización horaria.
