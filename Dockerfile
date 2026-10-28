# ====================================================================
# Home Channel HLS - 24/7 Linear Playout Engine
# Multi-arch (amd64 / arm64), hardware-accelerated video broadcaster
# ====================================================================

FROM node:22-bookworm-slim

# System dependencies: FFmpeg, Python, certificates, and edge-tts for dynamic synthetic voiceovers
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    python3 \
    python3-pip \
    curl \
    fonts-dejavu-core \
    && pip3 install --no-cache-dir --break-system-packages edge-tts==7.3.1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node.js production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . ./

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
# High UV_THREADPOOL_SIZE for seamless non-blocking I/O during heavy background transcode
ENV UV_THREADPOOL_SIZE=16

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/schedule/clock-status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
