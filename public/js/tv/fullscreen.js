/**
 * Home Channel HLS - Pantalla completa conservando el filtro CRT.
 *
 * Escritorio, Android e iPad: el contenedor CRT (con scanlines). iPhone: Safari solo
 * permite pantalla completa nativa sobre el <video> (webkitEnterFullscreen).
 */

function isFullscreen(video) {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement ||
    document.msFullscreenElement || video.webkitDisplayingFullscreen);
}

function exitFullscreen(video) {
  if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
  else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
  else if (document.msExitFullscreen) document.msExitFullscreen();
  else if (video.webkitExitFullscreen) video.webkitExitFullscreen();
}

function enterVideoFullscreen(video) {
  if (video.requestFullscreen) return video.requestFullscreen().catch(() => {});
  if (typeof video.webkitEnterFullscreen === 'function') {
    try {
      video.webkitEnterFullscreen();
    } catch (e) {
      console.warn('[Player] No se pudo activar fullscreen:', e);
    }
  }
}

function enterCrtFullscreen(wrapper, video) {
  const iosOnly = typeof video.webkitEnterFullscreen === 'function' && !wrapper.requestFullscreen && !wrapper.webkitRequestFullscreen;
  if (iosOnly) return enterVideoFullscreen(video);

  if (wrapper.requestFullscreen) {
    wrapper.requestFullscreen().catch(err => {
      console.warn('[Player] Fallback de fullscreen CRT a video:', err);
      enterVideoFullscreen(video);
    });
  } else if (wrapper.webkitRequestFullscreen) wrapper.webkitRequestFullscreen();
  else if (wrapper.mozRequestFullScreen) wrapper.mozRequestFullScreen();
  else if (wrapper.msRequestFullscreen) wrapper.msRequestFullscreen();
  else enterVideoFullscreen(video);
}

export function toggleFullscreen(wrapper, video) {
  if (!wrapper || !video) return;
  if (isFullscreen(video)) exitFullscreen(video);
  else enterCrtFullscreen(wrapper, video);
}
