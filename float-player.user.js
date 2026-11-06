// ==UserScript==
// @name         悬浮媒体播放器 (iOS 玻璃质感)
// @namespace    https://github.com/520luo/js/float-player
// @version      26.11.06.1
// @description  识别到页面里的 M3U8 / MP4 / WebM 后，自动在顶部悬浮出 iOS 玻璃质感播放器（默认暂停，可点 ✕ 关闭）；油猴菜单可开关「自动悬浮播放器」
// @icon         https://raw.githubusercontent.com/520LUO/icons/refs/heads/main/player.png
// @author       520LUO
// @match        *://*/*
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// @require      https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const IS_TOP = window.top === window.self;
  const MSG = '__mf_float_player__';
  const MAX_ITEMS = 12;
  const SKIP_SECONDS = 10;
  const SEEK_STEP = 5;
  const HIDE_DELAY = 3800;
  const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const AD_RE = /(doubleclick|googlesyndication|googleadservices|adservice|adsystem|[\/_.\-]ads?[\/_.\-]|preroll|\/vast|beacon|tracking)/i;

  /* =========================================================
   * 0. 设置：自动悬浮开关（油猴菜单切换，GM 存储持久化）
   * =======================================================*/
  const AUTO_KEY = 'mf_float_player_auto';
  let autoFloat = true;
  try { if (typeof GM_getValue === 'function') autoFloat = GM_getValue(AUTO_KEY, true) !== false; } catch (_) {}
  let menuIds = [];

  function pageToast(message) {
    if (!document.documentElement) return;
    let t = document.getElementById('mf-float-player-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'mf-float-player-toast';
      Object.assign(t.style, {
        position: 'fixed', left: '50%', bottom: '24px', transform: 'translate(-50%, 12px)', opacity: '0',
        zIndex: '2147483647', padding: '10px 16px', borderRadius: '12px', color: '#fff',
        background: 'rgba(25,25,30,.88)', border: '1px solid rgba(255,255,255,.18)',
        boxShadow: '0 6px 24px rgba(0,0,0,.28)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        font: '13px/1.4 system-ui,sans-serif', pointerEvents: 'none', transition: 'opacity .2s, transform .2s',
        maxWidth: 'min(86vw, 420px)', textAlign: 'center'
      });
      document.documentElement.appendChild(t);
    }
    t.textContent = message;
    t.style.opacity = '1'; t.style.transform = 'translate(-50%, 0)';
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translate(-50%, 12px)'; }, 1900);
  }

  function registerMenu() {
    if (!IS_TOP || typeof GM_registerMenuCommand !== 'function') return;
    if (typeof GM_unregisterMenuCommand === 'function') {
      for (const id of menuIds) { try { GM_unregisterMenuCommand(id); } catch (_) {} }
    }
    menuIds = [];
    try {
      const id = GM_registerMenuCommand(autoFloat ? '✅ 自动悬浮播放器-ON' : '🚫 自动悬浮播放器-OFF', () => {
        autoFloat = !autoFloat;
        try { if (typeof GM_setValue === 'function') GM_setValue(AUTO_KEY, autoFloat); } catch (_) {}
        registerMenu();
        pageToast(autoFloat ? '自动悬浮播放器已开启' : '自动悬浮播放器已关闭');
        if (autoFloat) maybeAutoOpen();
      });
      if (id !== undefined) menuIds.push(id);
    } catch (_) {}
  }

  /* =========================================================
   * 1. 媒体识别：video 元素 + fetch / XHR / Resource Timing 嗅探
   * =======================================================*/
  const found = new Map(); // url -> { url, type, from, t }
  const dismissed = new Set(); // 用户点 ✕ 关掉过的地址：自动悬浮不再打扰

  function typeOf(url) {
    let p;
    try { p = new URL(url).pathname.toLowerCase(); } catch (_) { return null; }
    if (/\.m3u8$/.test(p)) return 'hls';
    if (/\.(mp4|m4v|webm|mov|ogv)$/.test(p)) return 'file';
    return null;
  }

  function addFound(raw, from) {
    let url;
    try { url = new URL(raw, location.href).href; } catch (_) { return; }
    if (!/^https?:/i.test(url)) return;
    const type = typeOf(url);
    if (!type || AD_RE.test(url)) return;
    if (!IS_TOP) {
      try { window.top.postMessage({ [MSG]: 1, url, from }, '*'); } catch (_) {}
      return;
    }
    const old = found.get(url);
    if (old) { old.t = Date.now(); return; }
    found.set(url, { url, type, from, t: Date.now() });
    if (found.size > MAX_ITEMS) {
      const oldest = [...found.values()].sort((a, b) => a.t - b.t)[0];
      found.delete(oldest.url);
    }
    refreshBall();
    maybeAutoOpen();
  }

  function scanVideo(v) {
    try {
      const s = v.currentSrc || v.src;
      if (s && !s.startsWith('blob:')) addFound(s, 'video');
      v.querySelectorAll('source[src]').forEach((x) => addFound(x.src, 'source'));
    } catch (_) {}
  }

  try {
    const rawFetch = window.fetch;
    if (typeof rawFetch === 'function') {
      window.fetch = function (input) {
        try { addFound(typeof input === 'string' ? input : (input && input.url) || String(input), 'fetch'); } catch (_) {}
        return rawFetch.apply(this, arguments);
      };
    }
    const rawOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      try { addFound(String(u), 'xhr'); } catch (_) {}
      return rawOpen.apply(this, arguments);
    };
  } catch (_) {}

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (typeOf(e.name) === 'file' && e.encodedBodySize > 0 && e.encodedBodySize < 300 * 1024) continue;
        addFound(e.name, 'net');
      }
    }).observe({ type: 'resource', buffered: true });
  } catch (_) {}

  document.addEventListener('loadstart', (e) => { if (e.target && e.target.tagName === 'VIDEO') scanVideo(e.target); }, true);
  document.addEventListener('playing', (e) => { if (e.target && e.target.tagName === 'VIDEO') scanVideo(e.target); }, true);
  if (IS_TOP) {
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (d && d[MSG] === 1 && typeof d.url === 'string') addFound(d.url, d.from || 'frame');
    });
  }

  function pickBest(excludeDismissed) {
    let list = [...found.values()];
    if (excludeDismissed) list = list.filter((i) => !dismissed.has(i.url));
    if (!list.length) return null;
    const pv = [...document.querySelectorAll('video')].find((v) => !v.paused && v.currentSrc);
    if (pv) { const it = list.find((i) => i.url === pv.currentSrc); if (it) return it; }
    list.sort((a, b) => b.t - a.t);
    return list.find((i) => i.type === 'hls') || list[0];
  }

  function shortName(url) {
    try {
      const u = new URL(url);
      return `${u.hostname}/${u.pathname.split('/').filter(Boolean).slice(-2).join('/')}`;
    } catch (_) { return url; }
  }

  /* =========================================================
   * 2. 样式（沿用原「原生视频播放器美化」的 iOS 玻璃材质）+ 悬浮所需补充样式
   * =======================================================*/
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
  object-fit: contain;
  background: #000;
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

/* 顶部/底部轻微暗角，保证白色文字与图标在任何画面上都清晰可读 */
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

/* ---------- 中部：后退 / 播放暂停 / 快进 ---------- */
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
.iosgp-visible .iosgp-center {
  transform: translate(-50%, -50%) scale(1);
}

.iosgp-btn {
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid rgba(255,255,255,.28);
  margin: 0;
  padding: 0;
  outline: none;
  font-family: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  --mag: 1;   /* 靠近时的放大倍数，由 JS 根据鼠标距离实时设置 */
  --press: 1; /* 按下时的轻微缩小，由 JS 在 pointerdown/up 时切换 */
  --glow: 0;  /* 靠近时的高光强度 0~1，由 JS 实时设置 */
  background: rgba(20, 20, 20, calc(.4 - var(--glow) * .14));
  border-color: rgba(255, 255, 255, calc(.28 + var(--glow) * .55));
  transform: scale(calc(var(--mag) * var(--press)));
  box-shadow:
    0 4px 18px rgba(0,0,0,.25),
    inset 0 1px 0 rgba(255,255,255,.18),
    0 0 calc(var(--glow) * 14px) calc(var(--glow) * 4px) rgba(255,255,255, calc(var(--glow) * .95)),
    0 0 calc(var(--glow) * 46px) calc(var(--glow) * 18px) rgba(255,255,255, calc(var(--glow) * .85)),
    0 0 0 calc(var(--glow) * 3px) rgba(255,255,255, calc(var(--glow) * .55));
  transition: transform .22s cubic-bezier(.34,1.56,.64,1), background .15s ease, border-color .15s ease, box-shadow .15s ease;
}
.iosgp-btn:hover { background: rgba(46,46,46,.5); }
.iosgp-btn:focus-visible {
  outline: 2px solid rgba(255,255,255,.9);
  outline-offset: 2px;
}

.iosgp-btn-skip { width: 52px; height: 52px; }
.iosgp-btn-skip svg { width: 28px; height: 28px; }
.iosgp-btn-play { width: 68px; height: 68px; }
.iosgp-btn-play svg { width: 32px; height: 32px; }
.iosgp-corner-btn { width: 36px; height: 36px; }
.iosgp-corner-btn svg { width: 17px; height: 17px; }


/* ---------- 底部：时间 + 加粗胶囊进度条 ---------- */
.iosgp-bottom {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 104px 14px 58px; /* 左侧让出静音按钮，右侧让出画中画 + 全屏两个按钮 */
  transform: translateY(8px);
  transition: transform .28s cubic-bezier(.4,0,.2,1);
}
.iosgp-visible .iosgp-bottom { transform: translateY(0); }

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

/* ---------- 右下角：画中画 + 全屏 ---------- */
.iosgp-corner-actions {
  position: absolute;
  right: 14px;
  bottom: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ---------- 左下角：静音 ---------- */
.iosgp-corner-actions-left {
  position: absolute;
  left: 14px;
  bottom: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ---------- 左上角：返回（全屏时显示，用于退出全屏） ---------- */
.iosgp-top-actions-left {
  position: absolute;
  left: 14px;
  top: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ---------- 右上角：更多菜单（下载视频 / 复制视频链接） ---------- */
.iosgp-top-actions-right {
  position: absolute;
  right: 14px;
  top: 14px;
}
.iosgp-menu-wrap {
  position: relative;
}
.iosgp-menu {
  position: absolute;
  top: 44px;
  right: 0;
  min-width: calc(160px + 52px * var(--iosgp-scale, 1));
  border-radius: 14px;
  overflow: hidden;
  background: rgba(28,28,30,.55);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255,255,255,.22);
  box-shadow: 0 14px 32px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.15);
  opacity: 0;
  transform: translateY(-6px) scale(.96);
  transform-origin: top right;
  pointer-events: none;
  transition: opacity .18s cubic-bezier(.4,0,.2,1), transform .22s cubic-bezier(.34,1.56,.64,1);
}
.iosgp-menu.iosgp-menu-open {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
.iosgp-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: calc(8px + 4px * var(--iosgp-scale, 1)) calc(10px + 4px * var(--iosgp-scale, 1));
  margin: 0;
  border: none;
  background: transparent;
  color: #fff;
  font-size: calc(10px + 3px * var(--iosgp-scale, 1));
  font-weight: 500;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  transition: background .12s ease;
}
.iosgp-menu-item + .iosgp-menu-item {
  border-top: 1px solid rgba(255,255,255,.12);
}
.iosgp-menu-item:hover:not(:disabled) { background: rgba(255,255,255,.12); }
.iosgp-menu-item:active:not(:disabled) { background: rgba(255,255,255,.22); }
.iosgp-menu-item:disabled {
  color: rgba(255,255,255,.32);
  cursor: not-allowed;
}
.iosgp-menu-item svg {
  width: calc(12px + 4px * var(--iosgp-scale, 1));
  height: calc(12px + 4px * var(--iosgp-scale, 1));
  flex: 0 0 auto;
}
.iosgp-menu-item:disabled svg { opacity: .5; }

.iosgp-menu-speed-label {
  padding: calc(7px + 2px * var(--iosgp-scale, 1)) calc(10px + 4px * var(--iosgp-scale, 1)) calc(3px + 2px * var(--iosgp-scale, 1));
  border-top: 1px solid rgba(255,255,255,.12);
  font-size: calc(8px + 3px * var(--iosgp-scale, 1));
  font-weight: 600;
  letter-spacing: .03em;
  color: rgba(255,255,255,.55);
}
.iosgp-menu-speed-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: calc(4px + 3px * var(--iosgp-scale, 1));
  padding: calc(4px + 2px * var(--iosgp-scale, 1)) calc(8px + 4px * var(--iosgp-scale, 1)) calc(8px + 4px * var(--iosgp-scale, 1));
}
.iosgp-speed-chip {
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid rgba(255,255,255,.22);
  margin: 0;
  background: rgba(255,255,255,.1);
  color: #fff;
  font-family: inherit;
  font-size: calc(10px + 4px * var(--iosgp-scale, 1));
  font-weight: 600;
  padding: calc(5px + 4px * var(--iosgp-scale, 1)) 0;
  border-radius: calc(7px + 3px * var(--iosgp-scale, 1));
  cursor: pointer;
  text-align: center;
  transition: background .12s ease, border-color .12s ease, color .12s ease;
}
.iosgp-speed-chip:hover { background: rgba(255,255,255,.2); }
.iosgp-speed-chip:active { background: rgba(255,255,255,.3); }
.iosgp-speed-chip.iosgp-speed-active {
  background: #fff;
  color: #111;
  border-color: #fff;
}

@media (prefers-reduced-motion: reduce) {
  .iosgp-controls, .iosgp-center, .iosgp-bottom,
  .iosgp-btn, .iosgp-corner-actions, .iosgp-corner-actions-left,
  .iosgp-top-actions-left, .iosgp-menu, .iosgp-track, .iosgp-thumb {
    transition: none !important;
  }
}
`;

  const EXTRA_CSS = `
.iosgp-wrapper { width: 100%; aspect-ratio: 16 / 9; border-radius: 18px; background: #000;
  box-shadow: 0 12px 38px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.12); }
.iosgp-wrapper.iosgp-fs { width: 100vw; height: 100dvh; aspect-ratio: auto; border-radius: 0; box-shadow: none; }
.iosgp-menu { max-height: 60vh; overflow-y: auto; }
.iosgp-menu-src { display: block; width: 100%; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iosgp-menu-src.iosgp-on { background: rgba(255,255,255,.22); }
.iosgp-spin { position: absolute; left: 50%; top: 50%; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
  border: 3px solid rgba(255,255,255,.25); border-top-color: #fff; animation: iosgp-spin .8s linear infinite; display: none; pointer-events: none; z-index: 3; }
.iosgp-spin.iosgp-show { display: block; }
@keyframes iosgp-spin { to { transform: rotate(360deg); } }
.iosgp-toast { position: absolute; left: 50%; top: 56px; transform: translateX(-50%); padding: 7px 12px; border-radius: 11px; font-size: 12px;
  line-height: 1.4; color: #fff; background: rgba(20,20,30,.82); display: none; max-width: 86%; text-align: center; z-index: 4;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
.iosgp-toast.iosgp-show { display: block; }
`;

  /* =========================================================
   * 3. 图标
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
    fullscreen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
      <path d="M16 3h3a2 2 0 0 1 2 2v3"/>
      <path d="M8 21H5a2 2 0 0 1-2-2v-3"/>
      <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
    </svg>`,
    fullscreenExit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 3v3a2 2 0 0 1-2 2H4"/>
      <path d="M15 3v3a2 2 0 0 0 2 2h3"/>
      <path d="M9 21v-3a2 2 0 0 0-2-2H4"/>
      <path d="M15 21v-3a2 2 0 0 1 2-2h3"/>
    </svg>`,
    volumeOn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 9.5v5h4l5 4.5v-14L7 9.5H3z" fill="currentColor" stroke="none"/>
      <path d="M15.5 8.5a5 5 0 0 1 0 7"/>
      <path d="M18.3 6a9 9 0 0 1 0 12"/>
    </svg>`,
    volumeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 9.5v5h4l5 4.5v-14L7 9.5H3z" fill="currentColor" stroke="none"/>
      <line x1="15.5" y1="9.5" x2="21" y2="14.5"/>
      <line x1="21" y1="9.5" x2="15.5" y2="14.5"/>
    </svg>`,
    back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15 5l-7 7 7 7"/>
    </svg>`,
    more: `<svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.9"/>
      <circle cx="12" cy="12" r="1.9"/>
      <circle cx="19" cy="12" r="1.9"/>
    </svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v12"/>
      <path d="M7 10l5 5 5-5"/>
      <path d="M4 19h16"/>
    </svg>`,
    link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 15l6-6"/>
      <path d="M11 6.5l1-1a4 4 0 0 1 5.5 5.5l-1.5 1.5"/>
      <path d="M13 17.5l-1 1a4 4 0 0 1-5.5-5.5l1.5-1.5"/>
    </svg>`
  };
  ICONS.close = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

  /* =========================================================
   * 4. 工具函数
   * =======================================================*/
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function fmt(t) {
    if (!isFinite(t) || isNaN(t) || t < 0) return '0:00';
    t = Math.floor(t);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m), ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  function makeButton(cls, svg, title) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = cls; btn.innerHTML = svg; btn.title = title;
    btn.setAttribute('aria-label', title);
    return btn;
  }
  function makeMenuItem(svg, label) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'iosgp-menu-item';
    btn.innerHTML = `${svg}<span class="iosgp-menu-label">${label}</span>`;
    return btn;
  }
  function chipGrid(values, labelOf) {
    const grid = document.createElement('div');
    grid.className = 'iosgp-menu-speed-grid';
    values.forEach((v) => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'iosgp-speed-chip';
      chip.textContent = labelOf(v); chip.dataset.v = String(v);
      grid.appendChild(chip);
    });
    return grid;
  }
  function menuLabel(text) {
    const d = document.createElement('div');
    d.className = 'iosgp-menu-speed-label'; d.textContent = text;
    return d;
  }

  /* =========================================================
   * 5. 控制层 DOM（布局与原脚本一致；左上角新增 ✕ 关闭，菜单新增清晰度 / 视频源）
   * =======================================================*/
  function buildControls() {
    const controls = document.createElement('div');
    controls.className = 'iosgp-controls';
    const scrim = document.createElement('div'); scrim.className = 'iosgp-scrim';

    const center = document.createElement('div'); center.className = 'iosgp-center';
    const backBtn = makeButton('iosgp-btn iosgp-btn-skip', ICONS.back10, '后退 10 秒');
    const playBtn = makeButton('iosgp-btn iosgp-btn-play', ICONS.play, '播放');
    const fwdBtn = makeButton('iosgp-btn iosgp-btn-skip', ICONS.fwd10, '快进 10 秒');
    center.append(backBtn, playBtn, fwdBtn);

    const bottom = document.createElement('div'); bottom.className = 'iosgp-bottom';
    const curTime = document.createElement('span'); curTime.className = 'iosgp-time'; curTime.textContent = '0:00';
    const track = document.createElement('div'); track.className = 'iosgp-track'; track.tabIndex = 0;
    track.setAttribute('role', 'slider'); track.setAttribute('aria-label', '播放进度');
    const buffered = document.createElement('div'); buffered.className = 'iosgp-buffered';
    const filled = document.createElement('div'); filled.className = 'iosgp-filled';
    const thumb = document.createElement('div'); thumb.className = 'iosgp-thumb';
    track.append(buffered, filled, thumb);
    const durTime = document.createElement('span'); durTime.className = 'iosgp-time'; durTime.textContent = '0:00';
    bottom.append(curTime, track, durTime);

    const pipBtn = makeButton('iosgp-btn iosgp-corner-btn', ICONS.pip, '画中画');
    const fullscreenBtn = makeButton('iosgp-btn iosgp-corner-btn', ICONS.fullscreen, '全屏');
    const cornerActions = document.createElement('div'); cornerActions.className = 'iosgp-corner-actions';
    cornerActions.append(pipBtn, fullscreenBtn);

    const muteBtn = makeButton('iosgp-btn iosgp-corner-btn', ICONS.volumeOn, '静音');
    const cornerActionsLeft = document.createElement('div'); cornerActionsLeft.className = 'iosgp-corner-actions-left';
    cornerActionsLeft.append(muteBtn);

    // 左上角：未全屏时是 ✕（关闭悬浮播放器），全屏时是 ‹（退出全屏）
    const closeBtn = makeButton('iosgp-btn iosgp-corner-btn', ICONS.close, '关闭');
    const returnBtn = makeButton('iosgp-btn iosgp-corner-btn', ICONS.back, '退出全屏');
    returnBtn.style.display = 'none';
    const topActionsLeft = document.createElement('div'); topActionsLeft.className = 'iosgp-top-actions-left';
    topActionsLeft.append(closeBtn, returnBtn);

    const moreBtn = makeButton('iosgp-btn iosgp-corner-btn', ICONS.more, '更多');
    const downloadItem = makeMenuItem(ICONS.download, '下载视频');
    const copyItem = makeMenuItem(ICONS.link, '复制视频链接');
    const speedGrid = chipGrid(SPEED_OPTIONS, (r) => `${r}x`);
    const qualityLabel = menuLabel('清晰度');
    const qualityBox = document.createElement('div');
    const sourceLabel = menuLabel('视频源');
    const sourceBox = document.createElement('div');
    const menu = document.createElement('div'); menu.className = 'iosgp-menu';
    menu.append(downloadItem, copyItem, menuLabel('播放速度'), speedGrid, qualityLabel, qualityBox, sourceLabel, sourceBox);
    const menuWrap = document.createElement('div'); menuWrap.className = 'iosgp-menu-wrap';
    menuWrap.append(moreBtn, menu);
    const topActionsRight = document.createElement('div'); topActionsRight.className = 'iosgp-top-actions-right';
    topActionsRight.append(menuWrap);

    const spin = document.createElement('div'); spin.className = 'iosgp-spin';
    const toastEl = document.createElement('div'); toastEl.className = 'iosgp-toast';

    controls.append(scrim, center, bottom, cornerActions, cornerActionsLeft, topActionsLeft, topActionsRight, spin, toastEl);
    return {
      controls, backBtn, playBtn, fwdBtn, track, buffered, filled, thumb, curTime, durTime, pipBtn, fullscreenBtn,
      muteBtn, closeBtn, returnBtn, moreBtn, menu, downloadItem, copyItem, speedGrid, qualityLabel, qualityBox,
      sourceLabel, sourceBox, spin, toastEl
    };
  }

  /* =========================================================
   * 6. 悬浮播放器
   * =======================================================*/
  let P = null; // 当前播放器实例（同一时间只有一个）

  const HOST_STYLE = 'all:initial;position:fixed;top:max(8px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);' +
    'width:min(94vw,560px);z-index:2147483646;display:block;';
  const HOST_STYLE_FS = 'all:initial;position:fixed;inset:0;width:100vw;height:100dvh;z-index:2147483647;display:block;background:#000;';

  async function copyText(text) {
    if (typeof GM_setClipboard !== 'undefined') { try { GM_setClipboard(text, 'text'); return true; } catch (_) {} }
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
      document.body.appendChild(ta); ta.focus({ preventScroll: true }); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (_) {}
    return false;
  }

  function openPlayer(item, opts) {
    opts = opts || {};
    if (!item || P || !document.body) return;

    const host = document.createElement('div');
    host.setAttribute('data-mf-float-player', '');
    host.style.cssText = HOST_STYLE;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS_TEXT}${EXTRA_CSS}</style>
      <div class="iosgp-wrapper"><video playsinline webkit-playsinline preload="metadata"></video></div>`;
    const wrapper = root.querySelector('.iosgp-wrapper');
    const video = root.querySelector('video');
    const refs = buildControls();
    wrapper.appendChild(refs.controls);
    const {
      controls, backBtn, playBtn, fwdBtn, track, buffered, filled, thumb, curTime, durTime, pipBtn, fullscreenBtn,
      muteBtn, closeBtn, returnBtn, moreBtn, menu, downloadItem, copyItem, speedGrid, qualityLabel, qualityBox,
      sourceLabel, sourceBox, spin, toastEl
    } = refs;

    P = { host, video, hls: null, current: item, closed: false };
    const cleanups = [];
    const onDoc = (ev, fn) => { document.addEventListener(ev, fn); cleanups.push(() => document.removeEventListener(ev, fn)); };
    document.documentElement.appendChild(host);
    refreshBall();

    let toastTimer = 0;
    const toast = (msg) => {
      toastEl.textContent = msg; toastEl.classList.add('iosgp-show');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('iosgp-show'), 2600);
    };

    /* ---- 显示 / 隐藏控制层（默认暂停：控制层常驻） ---- */
    let hideTimer = 0;
    const scheduleHide = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { if (!video.paused && !menu.classList.contains('iosgp-menu-open')) controls.classList.remove('iosgp-visible'); }, HIDE_DELAY);
    };
    const showControls = () => { controls.classList.add('iosgp-visible'); scheduleHide(); };
    const hideControlsNow = () => { clearTimeout(hideTimer); controls.classList.remove('iosgp-visible'); };
    controls.classList.add('iosgp-visible');
    wrapper.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showControls(); });
    wrapper.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') showControls(); });
    wrapper.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { clearTimeout(hideTimer); if (!video.paused) controls.classList.remove('iosgp-visible'); } });
    wrapper.addEventListener('click', () => { controls.classList.contains('iosgp-visible') ? hideControlsNow() : showControls(); });

    /* ---- 播放 / 暂停 ---- */
    const syncPlayState = () => {
      const paused = video.paused || video.ended;
      playBtn.innerHTML = paused ? ICONS.play : ICONS.pause;
      playBtn.title = paused ? '播放' : '暂停';
      if (paused) { clearTimeout(hideTimer); controls.classList.add('iosgp-visible'); } else scheduleHide();
    };
    video.addEventListener('play', () => {
      // 播放器开始播放时，暂停页面上其他视频，避免两路声音
      document.querySelectorAll('video').forEach((v) => { if (!v.paused) { try { v.pause(); } catch (_) {} } });
      syncPlayState();
    });
    video.addEventListener('pause', syncPlayState);
    video.addEventListener('ended', syncPlayState);
    syncPlayState();
    playBtn.addEventListener('click', (e) => { e.stopPropagation(); video.paused ? video.play().catch(() => {}) : video.pause(); });
    video.addEventListener('waiting', () => spin.classList.add('iosgp-show'));
    for (const ev of ['playing', 'canplay', 'seeked', 'loadeddata']) video.addEventListener(ev, () => spin.classList.remove('iosgp-show'));

    /* ---- 静音 ---- */
    const syncMuteIcon = () => {
      const m = video.muted || video.volume === 0;
      muteBtn.innerHTML = m ? ICONS.volumeOff : ICONS.volumeOn;
      muteBtn.title = m ? '取消静音' : '静音';
    };
    muteBtn.addEventListener('click', (e) => { e.stopPropagation(); video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 1; });
    video.addEventListener('volumechange', syncMuteIcon);
    syncMuteIcon();

    /* ---- 快进 / 快退 ---- */
    backBtn.addEventListener('click', (e) => { e.stopPropagation(); video.currentTime = clamp(video.currentTime - SKIP_SECONDS, 0, video.duration || Infinity); showControls(); });
    fwdBtn.addEventListener('click', (e) => { e.stopPropagation(); video.currentTime = clamp(video.currentTime + SKIP_SECONDS, 0, video.duration || Infinity); showControls(); });

    /* ---- 进度条 ---- */
    const updateProgress = () => {
      const d = video.duration;
      if (isFinite(d) && d > 0) {
        const pct = clamp(video.currentTime / d, 0, 1) * 100;
        filled.style.width = pct + '%'; thumb.style.left = pct + '%';
        curTime.textContent = fmt(video.currentTime); durTime.textContent = fmt(d);
      }
      if (video.buffered && video.buffered.length && isFinite(d) && d > 0) {
        buffered.style.width = clamp(video.buffered.end(video.buffered.length - 1) / d, 0, 1) * 100 + '%';
      }
    };
    for (const ev of ['timeupdate', 'progress', 'loadedmetadata', 'durationchange']) video.addEventListener(ev, updateProgress);

    let dragging = false;
    const seekFromEvent = (e) => {
      const rect = track.getBoundingClientRect();
      const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1), d = video.duration;
      if (isFinite(d) && d > 0) {
        video.currentTime = pct * d;
        filled.style.width = pct * 100 + '%'; thumb.style.left = pct * 100 + '%'; curTime.textContent = fmt(video.currentTime);
      }
    };
    const endDrag = (e) => { if (!dragging) return; dragging = false; track.classList.remove('iosgp-dragging'); try { track.releasePointerCapture(e.pointerId); } catch (_) {} };
    track.addEventListener('pointerdown', (e) => { e.stopPropagation(); dragging = true; track.classList.add('iosgp-dragging'); try { track.setPointerCapture(e.pointerId); } catch (_) {} seekFromEvent(e); showControls(); });
    track.addEventListener('pointermove', (e) => { if (dragging) seekFromEvent(e); });
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('click', (e) => e.stopPropagation());
    track.addEventListener('keydown', (e) => {
      const d = video.duration || Infinity;
      if (e.key === 'ArrowRight') { video.currentTime = clamp(video.currentTime + SEEK_STEP, 0, d); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { video.currentTime = clamp(video.currentTime - SEEK_STEP, 0, d); e.preventDefault(); }
    });

    /* ---- 画中画 ---- */
    if (!(document.pictureInPictureEnabled && !video.disablePictureInPicture)) pipBtn.style.display = 'none';
    else pipBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { document.pictureInPictureElement === video ? await document.exitPictureInPicture() : await video.requestPictureInPicture(); } catch (_) {}
    });

    /* ---- 全屏：对 host 请求全屏（Shadow DOM 里的播放器整体进入全屏） ---- */
    const isFs = () => document.fullscreenElement === host || document.webkitFullscreenElement === host;
    const applyFs = () => {
      const fs = isFs();
      host.style.cssText = fs ? HOST_STYLE_FS : HOST_STYLE;
      wrapper.classList.toggle('iosgp-fs', fs);
      if (!fs) applyAspect();
      closeBtn.style.display = fs ? 'none' : 'flex';
      returnBtn.style.display = fs ? 'flex' : 'none';
      fullscreenBtn.innerHTML = fs ? ICONS.fullscreenExit : ICONS.fullscreen;
      fullscreenBtn.title = fs ? '退出全屏' : '全屏';
      try {
        if (fs) { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); }
        else screen.orientation && screen.orientation.unlock && screen.orientation.unlock();
      } catch (_) {}
    };
    const exitFs = async () => { try { if (document.exitFullscreen) await document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (_) {} };
    if (!(host.requestFullscreen || host.webkitRequestFullscreen)) { fullscreenBtn.style.display = 'none'; }
    fullscreenBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        if (isFs()) await exitFs();
        else if (host.requestFullscreen) await host.requestFullscreen();
        else host.webkitRequestFullscreen();
      } catch (_) { toast('无法进入全屏'); }
    });
    returnBtn.addEventListener('click', (e) => { e.stopPropagation(); exitFs(); });
    onDoc('fullscreenchange', applyFs);
    onDoc('webkitfullscreenchange', applyFs);

    // 按视频真实比例调整悬浮窗：竖屏视频不会撑得过高
    function applyAspect() {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh || isFs()) return;
      const ratio = vw / vh;
      wrapper.style.aspectRatio = String(ratio);
      host.style.width = `min(94vw, 560px, calc(62vh * ${ratio.toFixed(4)}))`;
    }
    video.addEventListener('loadedmetadata', applyAspect);

    /* ---- 更多菜单 ---- */
    const closeMenu = () => { menu.classList.remove('iosgp-menu-open'); root.removeEventListener('click', closeMenu); };
    function renderMenu() {
      const cur = P.current;
      // 下载：直链文件可下载；m3u8 清单不是完整视频，置灰
      downloadItem.disabled = cur.type !== 'file';
      copyItem.disabled = false;
      // 倍速
      speedGrid.querySelectorAll('.iosgp-speed-chip').forEach((c) => c.classList.toggle('iosgp-speed-active', Math.abs(parseFloat(c.dataset.v) - video.playbackRate) < 0.001));
      // 清晰度（仅 HLS 多码率）
      qualityBox.innerHTML = '';
      const hls = P.hls;
      const levels = hls && hls.levels && hls.levels.length > 1 ? hls.levels : null;
      qualityLabel.style.display = qualityBox.style.display = levels ? '' : 'none';
      if (levels) {
        const ids = [-1, ...levels.map((_, i) => i).sort((a, b) => (levels[b].height || 0) - (levels[a].height || 0))];
        const grid = chipGrid(ids, (i) => i === -1 ? '自动' : (levels[i].height ? levels[i].height + 'p' : Math.round((levels[i].bitrate || 0) / 1000) + 'k'));
        grid.querySelectorAll('.iosgp-speed-chip').forEach((c) => {
          const i = parseInt(c.dataset.v, 10);
          c.classList.toggle('iosgp-speed-active', i === -1 ? hls.autoLevelEnabled : (!hls.autoLevelEnabled && hls.currentLevel === i));
          c.addEventListener('click', (e) => { e.stopPropagation(); hls.currentLevel = i; closeMenu(); });
        });
        qualityBox.appendChild(grid);
      }
      // 视频源
      sourceBox.innerHTML = '';
      const list = [...found.values()].sort((a, b) => b.t - a.t);
      sourceLabel.style.display = sourceBox.style.display = list.length > 1 ? '' : 'none';
      list.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'iosgp-menu-item iosgp-menu-src' + (it.url === cur.url ? ' iosgp-on' : '');
        b.textContent = (it.type === 'hls' ? 'HLS · ' : '文件 · ') + shortName(it.url);
        b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); if (it.url !== P.current.url) load(it, video.currentTime, !video.paused); });
        sourceBox.appendChild(b);
      });
    }
    function openMenu() {
      renderMenu();
      menu.style.maxHeight = Math.max(120, wrapper.clientHeight - 64) + 'px';
      menu.classList.add('iosgp-menu-open');
      setTimeout(() => root.addEventListener('click', closeMenu), 0);
    }
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.contains('iosgp-menu-open') ? closeMenu() : openMenu(); });
    menu.addEventListener('click', (e) => e.stopPropagation());
    speedGrid.querySelectorAll('.iosgp-speed-chip').forEach((chip) => chip.addEventListener('click', (e) => {
      e.stopPropagation(); video.playbackRate = parseFloat(chip.dataset.v); closeMenu();
    }));
    copyItem.addEventListener('click', async (e) => {
      e.stopPropagation();
      const label = copyItem.querySelector('.iosgp-menu-label'), original = label.textContent;
      const ok = await copyText(P.current.url);
      label.textContent = ok ? '已复制 ✓' : '复制失败';
      setTimeout(() => { label.textContent = original; closeMenu(); }, 900);
    });
    downloadItem.addEventListener('click', (e) => {
      e.stopPropagation();
      if (downloadItem.disabled) return;
      try {
        const a = document.createElement('a');
        a.href = P.current.url; a.download = decodeURIComponent(new URL(P.current.url).pathname.split('/').pop() || 'video.mp4'); a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
      } catch (_) {}
      closeMenu();
    });

    /* ---- 菜单自适应缩放 ---- */
    const ro = new ResizeObserver(([entry]) => {
      const scale = Math.max(0.55, Math.min(entry.contentRect.width / 640, 1.3));
      controls.style.setProperty('--iosgp-scale', scale.toFixed(3));
    });
    ro.observe(wrapper);

    /* ---- 加载媒体（默认不自动播放） ---- */
    let startTime = 0, triedNative = false;
    const destroyHls = () => { if (P && P.hls) { try { P.hls.destroy(); } catch (_) {} P.hls = null; } };
    video.addEventListener('loadedmetadata', () => {
      if (startTime > 1 && isFinite(video.duration) && startTime < video.duration - 2) video.currentTime = startTime;
      startTime = 0;
    });
    video.addEventListener('error', () => { if (P && !P.hls) { spin.classList.remove('iosgp-show'); toast('视频加载失败，可在 ⋯ 菜单里换一个源'); } });

    function load(it, resumeAt, autoplay) {
      destroyHls();
      P.current = it; startTime = resumeAt || 0; triedNative = false;
      spin.classList.add('iosgp-show');
      video.removeAttribute('src'); video.load();
      const useNative = () => { triedNative = true; destroyHls(); video.src = it.url; };
      if (it.type === 'hls') {
        const H = window.Hls;
        if (H && H.isSupported && H.isSupported()) {
          const hls = new H({ enableWorker: true, maxBufferLength: 40 });
          P.hls = hls;
          hls.loadSource(it.url); hls.attachMedia(video);
          let retry = 0;
          hls.on(H.Events.ERROR, (_, d) => {
            if (!d.fatal) return;
            if (d.type === H.ErrorTypes.NETWORK_ERROR && retry++ < 3) { hls.startLoad(); return; }
            if (d.type === H.ErrorTypes.MEDIA_ERROR && retry++ < 3) { hls.recoverMediaError(); return; }
            if (!triedNative && video.canPlayType('application/vnd.apple.mpegurl')) { useNative(); return; }
            spin.classList.remove('iosgp-show');
            toast('播放失败：' + (d.details || d.type));
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) useNative();
        else { spin.classList.remove('iosgp-show'); toast('当前环境不支持 HLS 播放'); return; }
      } else video.src = it.url;
      if (autoplay) video.play().catch(() => {});
    }

    /* ---- 关闭 ---- */
    function close(byUser) {
      if (!P || P.closed) return;
      P.closed = true;
      clearTimeout(hideTimer); clearTimeout(toastTimer);
      cleanups.forEach((f) => f());
      ro.disconnect();
      destroyHls();
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {}
      try { if (document.pictureInPictureElement === video) document.exitPictureInPicture(); } catch (_) {}
      try { if (isFs()) document.exitFullscreen(); } catch (_) {}
      try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (_) {}
      host.remove();
      // 用户点 ✕：当前已识别的地址都不再自动悬浮（之后出现的新地址仍会）
      if (byUser) found.forEach((_, url) => dismissed.add(url));
      P = null;
      refreshBall();
    }
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(true); });
    for (const ev of ['keydown', 'keyup', 'keypress']) host.addEventListener(ev, (e) => e.stopPropagation());

    /* ---- 靠近 / 触摸按钮时放大 + 高光（沿用原脚本的 Dock 磁性效果） ---- */
    const magnetic = [backBtn, playBtn, fwdBtn, pipBtn, fullscreenBtn, muteBtn, closeBtn, returnBtn, moreBtn];
    let magnetFrame = null, lastPointer = null;
    const applyMagnet = () => {
      magnetFrame = null;
      if (!lastPointer) return;
      magnetic.forEach((btn) => {
        if (!btn || btn.style.display === 'none') return;
        const r = btn.getBoundingClientRect();
        const dist = Math.hypot(lastPointer.x - (r.left + r.width / 2), lastPointer.y - (r.top + r.height / 2));
        const t = clamp(1 - dist / 95, 0, 1), eased = t * t * (3 - 2 * t);
        btn.style.setProperty('--mag', (1 + eased * 0.22).toFixed(3));
        btn.style.setProperty('--glow', eased.toFixed(3));
      });
    };
    const resetMagnet = () => { lastPointer = null; magnetic.forEach((b) => { b.style.setProperty('--mag', '1'); b.style.setProperty('--glow', '0'); }); };
    const updatePointer = (e) => { lastPointer = { x: e.clientX, y: e.clientY }; if (magnetFrame == null) magnetFrame = requestAnimationFrame(applyMagnet); };
    wrapper.addEventListener('pointermove', updatePointer);
    wrapper.addEventListener('pointerdown', updatePointer);
    wrapper.addEventListener('pointerleave', resetMagnet);
    wrapper.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') resetMagnet(); });
    wrapper.addEventListener('pointercancel', (e) => { if (e.pointerType !== 'mouse') resetMagnet(); });
    magnetic.forEach((btn) => {
      btn.addEventListener('pointerdown', () => btn.style.setProperty('--press', '0.9'));
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, () => btn.style.setProperty('--press', '1')));
    });

    load(item, 0, !!opts.autoplay);
  }

  /* =========================================================
   * 7. 自动悬浮 + 手动入口小球
   * =======================================================*/
  let autoTimer = 0;
  function maybeAutoOpen() {
    if (!IS_TOP || !autoFloat || P) return;
    clearTimeout(autoTimer);
    // 稍作防抖：同一页面常常连续冒出好几个地址，等一下再选最合适的那个
    autoTimer = setTimeout(() => {
      if (!autoFloat || P || !document.body) { if (autoFloat && !P && !document.body) maybeAutoOpen(); return; }
      const best = pickBest(true);
      if (best) openPlayer(best, { autoplay: false });
    }, 500);
  }

  let ball = null, ballBadge = null;
  function ensureBall() {
    if (ball || !IS_TOP || !document.body) return;
    ball = document.createElement('div');
    ball.setAttribute('data-mf-float-ball', '');
    ball.style.cssText = 'position:fixed;left:8px;bottom:140px;width:38px;height:38px;border-radius:50%;display:none;align-items:center;justify-content:center;' +
      'z-index:2147483644;background:rgba(20,20,30,.65);color:#fff;cursor:pointer;user-select:none;touch-action:none;' +
      '-webkit-backdrop-filter:blur(16px) saturate(180%);backdrop-filter:blur(16px) saturate(180%);border:1px solid rgba(255,255,255,.28);' +
      'box-shadow:0 4px 18px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.18)';
    ball.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>' +
      '<span style="position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:#30d158;color:#fff;font:600 10px/16px system-ui,sans-serif;text-align:center"></span>';
    ballBadge = ball.querySelector('span');
    document.body.appendChild(ball);
    let drag = false, moved = false, sy = 0, sTop = 0;
    ball.addEventListener('pointerdown', (e) => { drag = true; moved = false; sy = e.clientY; sTop = ball.getBoundingClientRect().top; ball.setPointerCapture(e.pointerId); });
    ball.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = e.clientY - sy;
      if (Math.abs(dy) > 6) moved = true;
      if (moved) { ball.style.bottom = 'auto'; ball.style.top = clamp(sTop + dy, 0, innerHeight - 38) + 'px'; }
    });
    ball.addEventListener('pointerup', () => { const was = moved; drag = false; if (!was) openPlayer(pickBest(false), { autoplay: true }); });
  }
  function refreshBall() {
    if (!IS_TOP) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', refreshBall, { once: true }); return; }
    ensureBall();
    ball.style.display = (found.size && !P) ? 'flex' : 'none';
    ballBadge.textContent = String(found.size);
  }

  registerMenu();
  const initialScan = () => { document.querySelectorAll('video').forEach(scanVideo); refreshBall(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialScan); else initialScan();
  window.addEventListener('load', initialScan);
})();
