/**
 * Home Channel HLS - Emisión: motor (PlayoutEngine) y sus piezas.
 *   PlayoutEngine     orquestador (eventos: 'episodeFinished')
 *   FfmpegHlsProcess  proceso FFmpeg → HLS, con su posición real
 *   PlayoutQueue      cola al aire, tiempos de cada elemento y lista ffconcat
 *   StatusPresenter   estado para /api/status (P100, admin)
 *   EncoderFactory    perfiles VideoToolbox / NVENC / x264
 */
module.exports = require('./PlayoutEngine');
