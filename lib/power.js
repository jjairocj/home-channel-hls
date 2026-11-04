/**
 * Home Channel HLS - Telemetría de consumo eléctrico (Netdata + nvidia-smi / RAPL)
 *
 * Solo para el Master Control. Diseñado para no castigar el servidor:
 * - Las consultas a Netdata se hacen en paralelo.
 * - Peticiones simultáneas comparten la misma consulta en vuelo.
 * - Lo instantáneo se cachea 5 s; los promedios de hoy / 24 h / 7 días, 10 min.
 * - nvidia-smi se ejecuta de forma asíncrona.
 */

const fs = require('fs');
const path = require('path');
const { execFileAsync } = require('./ffmpeg');

const INSTANT_TTL_MS = 5000;
const AGGREGATE_TTL_MS = 10 * 60 * 1000;

function formatBytes(b) {
  if (b >= 10 ** 12) return `${(b / 10 ** 12).toFixed(2)} TB`;
  if (b >= 10 ** 9) return `${(b / 10 ** 9).toFixed(1)} GB`;
  if (b >= 10 ** 6) return `${(b / 10 ** 6).toFixed(1)} MB`;
  return `${b} B`;
}

class PowerTelemetry {
  constructor(env = process.env) {
    this.host = env.NETDATA_HOST || env.PG_HOST || 'localhost';
    this.port = env.NETDATA_PORT || '19999';
    this.cpuChart = env.NETDATA_CPU_CHART || 'cpu.powercap_intel_rapl_zone_package-0';
    this.gpuChart = env.NETDATA_GPU_CHART || '';
    this.baseWatts = parseFloat(env.POWER_BASE_WATTS || '25');
    this.device = {
      cpuModel: env.HW_CPU_MODEL || 'CPU (Intel/AMD RAPL)',
      gpuModel: env.HW_GPU_MODEL || 'GPU (NVIDIA NVENC / Hardware Encoder)'
    };

    this.instantCache = null;
    this.instantAt = 0;
    this.aggregateCache = null;
    this.aggregateAt = 0;
    this.inFlight = null;
  }

  async netdataAvg(chart, afterSec) {
    try {
      const url = `http://${this.host}:${this.port}/api/v1/data?chart=${encodeURIComponent(chart)}&after=-${Math.max(10, Math.floor(afterSec))}&group=average&points=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(1800) });
      if (!res.ok) return null;
      const json = await res.json();
      const v = json.data && json.data[0] ? json.data[0][1] : null;
      return v === null || v === undefined ? null : Number(v);
    } catch (e) {
      return null;
    }
  }

  async gpuFromSmi() {
    try {
      const out = await execFileAsync('nvidia-smi', ['--query-gpu=power.draw', '--format=csv,noheader,nounits'], { timeout: 1500 });
      const v = parseFloat(String(out).trim());
      return isNaN(v) ? null : v;
    } catch (e) {
      return null;
    }
  }

  async fetchInstant() {
    let [cpu, gpu] = await Promise.all([
      this.netdataAvg(this.cpuChart, 10),
      this.netdataAvg(this.gpuChart, 10)
    ]);
    if (gpu === null) gpu = await this.gpuFromSmi();
    const finalCpu = cpu !== null && cpu !== undefined ? Math.round(Number(cpu) * 10) / 10 : 30;
    const finalGpu = gpu !== null && gpu !== undefined ? Math.round(Number(gpu) * 10) / 10 : 30;
    return { cpu: finalCpu, gpu: finalGpu };
  }

  async fetchAggregates(instant) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    const secondsToday = Math.max(60, Math.floor(Date.now() / 1000 - startOfDay));

    const [cpuToday, gpuToday, cpu24h, gpu24h, cpu7d, gpu7d] = await Promise.all([
      this.netdataAvg(this.cpuChart, secondsToday),
      this.netdataAvg(this.gpuChart, secondsToday),
      this.netdataAvg(this.cpuChart, 86400),
      this.netdataAvg(this.gpuChart, 86400),
      this.netdataAvg(this.cpuChart, 604800),
      this.netdataAvg(this.gpuChart, 604800)
    ]);

    const ct = cpuToday ?? instant.cpu;
    const gt = gpuToday ?? instant.gpu;
    const c24 = cpu24h ?? ct;
    const g24 = gpu24h ?? gt;
    const c7 = cpu7d ?? c24;
    const g7 = gpu7d ?? g24;

    return { secondsToday, todayWatts: ct + gt + this.baseWatts, d24Watts: c24 + g24 + this.baseWatts, d7Watts: c7 + g7 + this.baseWatts };
  }

  async refresh() {
    const now = Date.now();
    if (!this.instantCache || now - this.instantAt > INSTANT_TTL_MS) {
      this.instantCache = await this.fetchInstant();
      this.instantAt = Date.now();
    }
    if (!this.aggregateCache || now - this.aggregateAt > AGGREGATE_TTL_MS) {
      this.aggregateCache = await this.fetchAggregates(this.instantCache);
      this.aggregateAt = Date.now();
    }
  }

  async get() {
    const now = Date.now();
    const fresh = this.instantCache && this.aggregateCache &&
      now - this.instantAt <= INSTANT_TTL_MS && now - this.aggregateAt <= AGGREGATE_TTL_MS;

    if (!fresh) {
      if (!this.inFlight) {
        this.inFlight = this.refresh().finally(() => { this.inFlight = null; });
      }
      try {
        await this.inFlight;
      } catch (e) {
        if (!this.instantCache) {
          this.instantCache = { cpu: 30, gpu: 30 };
          this.instantAt = Date.now();
        }
      }
    }
    return this.format();
  }

  getDiskStats() {
    let hostStats = null;
    const mediaDir = process.env.MEDIA_DIR || '/app/media';
    const statsFile = path.join(mediaDir, 'data', 'disk_stats.json');
    if (fs.existsSync(statsFile)) {
      try {
        hostStats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
      } catch (e) {}
    }

    let primary = null;
    try {
      const targetDir = fs.existsSync(mediaDir) ? mediaDir : process.cwd();
      const st = fs.statfsSync(targetDir);
      const total = st.blocks * st.bsize;
      const free = st.bavail * st.bsize;
      const used = total - (st.bfree * st.bsize);
      primary = {
        id: 'primary',
        label: 'Locomotion 2TB (Media)',
        description: 'HDD Principal',
        total,
        used,
        free,
        totalFormatted: formatBytes(total),
        usedFormatted: formatBytes(used),
        freeFormatted: formatBytes(free),
        usedPercent: total > 0 ? Math.round(((total - free) / total) * 1000) / 10 : 0
      };
    } catch (e) {}

    if (hostStats && hostStats.pool && primary) {
      hostStats.pool.free = primary.free;
      hostStats.pool.freeFormatted = primary.freeFormatted;
      hostStats.pool.usedPercent = primary.usedPercent;
    }

    return hostStats || {
      primary,
      disks: primary ? [primary] : [],
      total: primary,
      updatedAt: new Date().toISOString()
    };
  }

  format() {
    const r1 = (n) => Math.round(n * 10) / 10;
    const r2 = (n) => Math.round(n * 100) / 100;
    const inst = this.instantCache || { cpu: 50, gpu: 45 };
    const agg = this.aggregateCache || { secondsToday: 3600, todayWatts: inst.cpu + inst.gpu + this.baseWatts, d24Watts: inst.cpu + inst.gpu + this.baseWatts, d7Watts: inst.cpu + inst.gpu + this.baseWatts };

    return {
      instant: {
        totalWatts: r1(inst.cpu + inst.gpu + this.baseWatts),
        cpuWatts: r1(inst.cpu),
        gpuWatts: r1(inst.gpu),
        baseWatts: this.baseWatts
      },
      today: {
        hours: r1(agg.secondsToday / 3600),
        avgWatts: r1(agg.todayWatts),
        kwh: r2((agg.todayWatts * (agg.secondsToday / 3600)) / 1000)
      },
      last24h: { avgWatts: r1(agg.d24Watts), kwh: r2((agg.d24Watts * 24) / 1000) },
      last7days: { avgWatts: r1(agg.d7Watts), kwh: r2((agg.d7Watts * 168) / 1000) },
      device: this.device,
      disk: this.getDiskStats(),
      updatedAt: new Date(Math.max(this.instantAt, this.aggregateAt) || Date.now()).toISOString()
    };
  }
}

module.exports = PowerTelemetry;
