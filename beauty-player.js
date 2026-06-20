// ==UserScript==
// @name         视频播放器美化
// @namespace    http://tampermonkey.net/
// @version      2026-06-20
// @description  iOS 玻璃质感播放器
// @author       @520luo
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  if (window.__iosGlassPlayerInjected) return;
  window.__iosGlassPlayerInjected = true;

  const NS = 'iosgp';
  const PROCESSED_ATTR = `data-${NS}-done`;
  const SKIP_SECONDS = 10;
  const SEEK_STEP = 5;
  const MIN_SIZE = 80;
  const HIDE_DELAY = 2800;

  /* =========================================================
   * 1. 样式注入
   * =======================================================*/
  const STYLE_ID = `${NS}-style-tag`;
  const CSS_TEXT = `
.iosgp-wrapper {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  line-height: 0;
}
.iosgp-wrapper video {
  display: block;
  width: 100%;
  height: 100%;
}

.iosgp-wrapper.iosgp-fullscreen-active {
  position: fixed !important;
  top: 0; left: 0;
  width: 100vw !important;
  height: 100vh !important;
  z-index: 2147483647;
  margin: 0 !important;
  max-width: none !important;
  background: #000;
}

.iosgp-wrapper.iosgp-fullscreen-active video {
  object-fit: contain;
  width: 100% !important;
  height: 100% !important;
}

.iosgp-controls {
  position: absolute;
  inset: 0;
  z-index: 2147483000;
  opacity: 0;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  transition: opacity .28s cubic-bezier(.4,0,.2,1);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
}
.iosgp-controls.iosgp-visible {
  opacity: 1;
  pointer-events: auto;
}

.iosgp-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top,
    rgba(0,0,0,.45) 0%,
    rgba(0,0,0,0) 30%,
    rgba(0,0,0,0) 70%,
    rgba(0,0,0,.22) 100%);
  pointer-events: none;
}

.iosgp-center {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 28px;
  transform: translate(-50%, -50%) scale(.85);
  transition: transform .32s cubic-bezier(.34,1.56,.64,1);
}
.iosgp-visible .iosgp-center,
.iosgp-paused .iosgp-center {
  transform: translate(-50%, -50%) scale(1);
}

.iosgp-btn {
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid rgba(255,255,255,.28);
  margin: 0; padding: 0; outline: none;
  font-family: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  background: rgba(20,20,20,.38);
  box-shadow: 0 4px 18px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.18);
  transition: transform .18s cubic-bezier(.4,0,.2,1), background .18s ease;
}
.iosgp-btn:hover { background: rgba(46,46,46,.48); }
.iosgp-btn:active { transform: scale(.9); }
.iosgp-btn:focus-visible {
  outline: 2px solid rgba(255,255,255,.9);
  outline-offset: 2px;
}

.iosgp-btn-skip { width: 52px; height: 52px; }
.iosgp-btn-skip svg { width: 28px; height: 28px; }
.iosgp-btn-play { width: 68px; height: 68px; }
.iosgp-btn-play svg { width: 32px; height: 32px; }

.iosgp-btn-small {
  width: 36px; height: 36px;
}
.iosgp-btn-small svg {
  width: 17px; height: 17px;
}

.iosgp-bottom {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 56px 14px 56px;
  transform: translateY(8px);
  transition: transform .28s cubic-bezier(.4,0,.2,1);
}
.iosgp-visible .iosgp-bottom,
.iosgp-paused .iosgp-bottom { transform: translateY(0); }

.iosgp-time {
  flex: 0 0 auto;
  min-width: 38px;
  text-align: center;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 3px rgba(0,0,0,.5);
}

.iosgp-track {
  position: relative;
  flex: 1 1 auto;
  height: 7px;
  border-radius: 999px;
  background: rgba(255,255,255,.28);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  cursor: pointer;
  touch-action: none;
  transition: height .15s ease;
}
.iosgp-track:hover,
.iosgp-track.iosgp-dragging { height: 11px; }
.iosgp-track:focus-visible {
  outline: 2px solid rgba(255,255,255,.9);
  outline-offset: 3px;
}

.iosgp-buffered,
.iosgp-filled {
  position: absolute;
  top: 0; left: 0; height: 100%;
  width: 0%;
  border-radius: 999px;
  pointer-events: none;
}
.iosgp-buffered { background: rgba(255,255,255,.32); }
.iosgp-filled   { background: #ffffff; }

.iosgp-thumb {
  position: absolute;
  top: 50%; left: 0%;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 5px rgba(0,0,0,.45);
  transform: translate(-50%, -50%) scale(0);
  transition: transform .15s cubic-bezier(.34,1.56,.64,1);
  pointer-events: none;
}
.iosgp-track:hover .iosgp-thumb,
.iosgp-track.iosgp-dragging .iosgp-thumb {
  transform: translate(-50%, -50%) scale(1);
}

/* ---------- 更多菜单下拉 ---------- */
.iosgp-menu {
  position: absolute;
  right: 0;
  top: 42px;
  z-index: 2147483001;
  min-width: 160px;
  padding: 4px 0;
  border-radius: 12px;
  background: rgba(20,20,20,.78);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  box-shadow: 0 8px 24px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.1);
  border: 1px solid rgba(255,255,255,.18);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
  display: none;
}
.iosgp-menu.iosgp-menu-visible {
  display: block;
}
.iosgp-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: none;
  color: #fff;
  font-size: 14px;
  font-weight: 400;
  cursor: pointer;
  text-align: left;
  transition: background .15s ease;
  white-space: nowrap;
}
.iosgp-menu-item:hover {
  background: rgba(255,255,255,.12);
}
.iosgp-menu-item:disabled {
  color: rgba(255,255,255,.4);
  cursor: not-allowed;
  background: none;
}
.iosgp-menu-item svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  opacity: .85;
}

@media (prefers-reduced-motion: reduce) {
  .iosgp-controls, .iosgp-center, .iosgp-bottom,
  .iosgp-btn, .iosgp-track, .iosgp-thumb, .iosgp-menu-item {
    transition: none !important;
  }
}
`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS_TEXT;
    (document.head || document.documentElement).appendChild(style);
  }

  /* =========================================================
   * 2. 图标
   * =======================================================*/
  const ICONS = {
    play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z"/></svg>`,
    back10: `<svg viewBox="0 0 36 36">
      <path d="M18 6a12 12 0 1 0 8.49 3.51" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      <polyline points="27 2 26.5 9.5 19 9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="18" y="23.5" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" font-family="-apple-system,BlinkMacSystemFont,sans-serif">10</text>
    </svg>`,
    fwd10: `<svg viewBox="0 0 36 36">
      <path d="M18 6a12 12 0 1 1-8.49 3.51" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      <polyline points="9 2 9.5 9.5 17 9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="18" y="23.5" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" font-family="-apple-system,BlinkMacSystemFont,sans-serif">10</text>
    </svg>`,
    pip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2"/>
      <rect x="12.2" y="11.6" width="7.2" height="5.2" rx="1.1" fill="currentColor" stroke="none"/>
    </svg>`,
    fullscreenEnter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="15 3 21 3 21 9"/>
      <polyline points="9 21 3 21 3 15"/>
      <line x1="21" y1="3" x2="14" y2="10"/>
      <line x1="3" y1="21" x2="10" y2="14"/>
    </svg>`,
    fullscreenExit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="8 3 4 3 4 7"/>
      <polyline points="16 21 20 21 20 17"/>
      <line x1="4" y1="3" x2="12" y2="11"/>
      <line x1="20" y1="21" x2="12" y2="13"/>
      <polyline points="3 8 3 4 7 4"/>
      <polyline points="21 16 21 20 17 20"/>
    </svg>`,
    volumeOn: `<svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.47 4.47 0 0 0 2.5-3.5z"/>
    </svg>`,
    volumeOff: `<svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.5 12A4.5 4.5 0 0 0 14 8.5v2.18l2.5 2.5V12zM3 9v6h4l5 5V4L7 9H3zm17.36 1.64l-1.41 1.41L20.36 13l-1.41 1.41L17.54 13l-1.41 1.41L14.72 13l1.41-1.41-1.41-1.41L16.13 9l1.41 1.41L18.95 9l1.41 1.41z"/>
    </svg>`,
    more: `<svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.5"/>
      <circle cx="12" cy="12" r="1.5"/>
      <circle cx="12" cy="19" r="1.5"/>
    </svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>`,
    copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>`
  };

  /* =========================================================
   * 3. 工具函数
   * =======================================================*/
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function fmt(t) {
    if (!isFinite(t) || isNaN(t) || t < 0) return '0:00';
    t = Math.floor(t);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function makeButton(cls, svg, title, styleProps = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cls;
    btn.innerHTML = svg;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    Object.assign(btn.style, styleProps);
    return btn;
  }

  /** 判断视频源是否为可直接下载的媒体格式 */
  function isDirectMediaSrc(src) {
    if (!src || src.startsWith('blob:')) return false;
    try {
      const url = new URL(src, location.href);
      const ext = (url.pathname.split('.').pop() || '').toLowerCase();
      const directFormats = ['mp4', 'mkv', 'webm', 'ogg', 'mov', 'avi', 'flv', 'wmv', 'mpg', 'mpeg', 'm4v', '3gp'];
      return directFormats.includes(ext);
    } catch {
      return false;
    }
  }

  const enhancedWrappers = [];

  function updateAllFullscreenIcons() {
    const active = document.fullscreenElement || document.webkitFullscreenElement;
    for (const item of enhancedWrappers) {
      const isFull = active === item.wrapper;
      item.fullscreenBtn.innerHTML = isFull ? ICONS.fullscreenExit : ICONS.fullscreenEnter;
      item.fullscreenBtn.title = isFull ? '退出全屏' : '全屏';
    }
  }

  function handleFullscreenChange() {
    updateAllFullscreenIcons();
    for (const item of enhancedWrappers) {
      const isFull = (document.fullscreenElement || document.webkitFullscreenElement) === item.wrapper;
      item.wrapper.classList.toggle('iosgp-fullscreen-active', isFull);
    }
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
      }
    }
  }

  /* =========================================================
   * 4. 构建控制层 DOM
   * =======================================================*/
  function buildControls() {
    const controls = document.createElement('div');
    controls.className = 'iosgp-controls';

    const scrim = document.createElement('div');
    scrim.className = 'iosgp-scrim';

    const center = document.createElement('div');
    center.className = 'iosgp-center';
    const backBtn = makeButton('iosgp-btn iosgp-btn-skip', ICONS.back10, '后退 10 秒');
    const playBtn = makeButton('iosgp-btn iosgp-btn-play', ICONS.play, '播放');
    const fwdBtn = makeButton('iosgp-btn iosgp-btn-skip', ICONS.fwd10, '快进 10 秒');
    center.append(backBtn, playBtn, fwdBtn);

    const bottom = document.createElement('div');
    bottom.className = 'iosgp-bottom';
    const curTime = document.createElement('span');
    curTime.className = 'iosgp-time';
    curTime.textContent = '0:00';
    const track = document.createElement('div');
    track.className = 'iosgp-track';
    track.tabIndex = 0;
    track.setAttribute('role', 'slider');
    track.setAttribute('aria-label', '播放进度');
    const buffered = document.createElement('div');
    buffered.className = 'iosgp-buffered';
    const filled = document.createElement('div');
    filled.className = 'iosgp-filled';
    const thumb = document.createElement('div');
    thumb.className = 'iosgp-thumb';
    track.append(buffered, filled, thumb);
    const durTime = document.createElement('span');
    durTime.className = 'iosgp-time';
    durTime.textContent = '0:00';
    bottom.append(curTime, track, durTime);

    // 四角按钮（内联定位）
    const pipBtn = makeButton('iosgp-btn iosgp-btn-small', ICONS.pip, '画中画', {
      position: 'absolute', left: '14px', top: '14px'
    });
    const moreBtn = makeButton('iosgp-btn iosgp-btn-small', ICONS.more, '更多', {
      position: 'absolute', right: '14px', top: '14px'
    });
    const muteBtn = makeButton('iosgp-btn iosgp-btn-small', ICONS.volumeOn, '静音', {
      position: 'absolute', left: '14px', bottom: '14px'
    });
    const fullscreenBtn = makeButton('iosgp-btn iosgp-btn-small', ICONS.fullscreenEnter, '全屏', {
      position: 'absolute', right: '14px', bottom: '14px'
    });

    // 更多菜单
    const menu = document.createElement('div');
    menu.className = 'iosgp-menu';
    const downloadItem = document.createElement('button');
    downloadItem.className = 'iosgp-menu-item';
    downloadItem.innerHTML = `${ICONS.download} 下载视频`;
    const copyItem = document.createElement('button');
    copyItem.className = 'iosgp-menu-item';
    copyItem.innerHTML = `${ICONS.copy} 复制视频链接`;
    menu.append(downloadItem, copyItem);
    moreBtn.appendChild(menu);

    controls.append(scrim, center, bottom, pipBtn, moreBtn, muteBtn, fullscreenBtn);

    return {
      controls, scrim,
      backBtn, playBtn, fwdBtn,
      track, buffered, filled, thumb,
      curTime, durTime,
      pipBtn, moreBtn, muteBtn, fullscreenBtn,
      menu, downloadItem, copyItem
    };
  }

  /* =========================================================
   * 5. 事件绑定
   * =======================================================*/
  function wireEvents(video, wrapper, refs) {
    const {
      controls, scrim,
      backBtn, playBtn, fwdBtn,
      track, buffered, filled, thumb,
      curTime, durTime,
      pipBtn, moreBtn, muteBtn, fullscreenBtn,
      menu, downloadItem, copyItem
    } = refs;

    let manualHidden = false;
    let hideTimer = null;

    function showControls() {
      controls.classList.add('iosgp-visible');
      manualHidden = false;
      scheduleHide();
    }

    function hideControls() {
      controls.classList.remove('iosgp-visible');
      clearTimeout(hideTimer);
      manualHidden = true;
    }

    function toggleControls() {
      if (controls.classList.contains('iosgp-visible')) {
        hideControls();
      } else {
        showControls();
      }
    }

    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!video.paused && !manualHidden) {
          controls.classList.remove('iosgp-visible');
        }
      }, HIDE_DELAY);
    }

    wrapper.addEventListener('mouseenter', () => {
      if (!manualHidden) showControls();
    });
    wrapper.addEventListener('mousemove', () => {
      if (!manualHidden) showControls();
    });
    wrapper.addEventListener('mouseleave', () => {
      clearTimeout(hideTimer);
      if (!video.paused && !manualHidden) {
        controls.classList.remove('iosgp-visible');
      }
    });

    wrapper.addEventListener('click', toggleControls);

    /* ---- 播放/暂停 ---- */
    function syncPlayState() {
      const paused = video.paused || video.ended;
      wrapper.classList.toggle('iosgp-paused', paused);
      playBtn.innerHTML = paused ? ICONS.play : ICONS.pause;
      playBtn.title = paused ? '播放' : '暂停';
      if (paused) {
        clearTimeout(hideTimer);
        if (!manualHidden) {
          controls.classList.add('iosgp-visible');
        }
      } else {
        if (!manualHidden) {
          scheduleHide();
        }
      }
    }
    video.addEventListener('play', syncPlayState);
    video.addEventListener('pause', syncPlayState);
    video.addEventListener('ended', syncPlayState);
    syncPlayState();

    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.paused ? video.play().catch(() => {}) : video.pause();
    });

    backBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.currentTime = clamp(video.currentTime - SKIP_SECONDS, 0, video.duration || Infinity);
      showControls();
    });
    fwdBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.currentTime = clamp(video.currentTime + SKIP_SECONDS, 0, video.duration || Infinity);
      showControls();
    });

    /* ---- 进度条 ---- */
    function updateProgress() {
      const d = video.duration;
      if (isFinite(d) && d > 0) {
        const pct = clamp(video.currentTime / d, 0, 1) * 100;
        filled.style.width = pct + '%';
        thumb.style.left = pct + '%';
        track.setAttribute('aria-valuenow', String(Math.round(video.currentTime)));
        track.setAttribute('aria-valuemax', String(Math.round(d)));
        curTime.textContent = fmt(video.currentTime);
        durTime.textContent = fmt(d);
      }
      if (video.buffered && video.buffered.length) {
        const end = video.buffered.end(video.buffered.length - 1);
        if (isFinite(d) && d > 0) buffered.style.width = clamp(end / d, 0, 1) * 100 + '%';
      }
    }
    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('progress', updateProgress);
    video.addEventListener('loadedmetadata', updateProgress);
    video.addEventListener('durationchange', updateProgress);
    updateProgress();

    let dragging = false;
    function seekFromEvent(e) {
      const rect = track.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
      const d = video.duration;
      if (isFinite(d) && d > 0) {
        video.currentTime = pct * d;
        filled.style.width = pct * 100 + '%';
        thumb.style.left = pct * 100 + '%';
        curTime.textContent = fmt(video.currentTime);
      }
    }
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      track.classList.remove('iosgp-dragging');
      try { track.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    track.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      dragging = true;
      track.classList.add('iosgp-dragging');
      try { track.setPointerCap
