// ==UserScript==
// @name         原生视频播放器美化
// @namespace    https://githb.com/520luo/js
// @version      1.9.1
// @description  iOS 风格高斯模糊玻璃视频控件，倍速菜单自适应视频大小，m3u8嗅探
// @author       520LUO
// @icon         https://raw.githubusercontent.com/520LUO/icons/refs/heads/main/player.png
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @license      MIT
// ==/UserScript==

/**
 * iOS 玻璃质感视频播放器美化扩展
 * ------------------------------------------------------------
 * 功能：
 *   - 接管页面上的原生 <video>，隐藏浏览器默认控制条
 *   - 叠加一层 iOS 风格的高斯模糊玻璃材质控制层
 *   - 中部：后退 10s / 播放暂停 / 快进 10s 按钮
 *   - 底部：加粗的胶囊形进度条（含缓冲区、拖拽 seek）
 *   - 右下角：画中画（Picture-in-Picture）+ 全屏按钮
 *   - 所有按钮支持鼠标靠近时放大并出现周围高光（类似 Dock 磁性效果）
 *   - 自动适配页面中动态插入的 <video>（含 SPA / 懒加载）
 *
 * 使用：作为 content script 注入即可，无需额外依赖。
 * ------------------------------------------------------------
 */
(function () {
  'use strict';

  // 防止脚本被重复注入（比如部分浏览器对同一页面多次执行 content script）
  if (window.__iosGlassPlayerInjected) return;
  window.__iosGlassPlayerInjected = true;

  const NS = 'iosgp';
  const PROCESSED_ATTR = `data-${NS}-done`;
  const SKIP_SECONDS = 10;     // 快进/快退秒数
  const SEEK_STEP = 5;         // 进度条键盘左右键的步进秒数
  const MIN_SIZE = 130;         // 低于此尺寸（px）的 video 视为装饰性/不可见，跳过美化
  const HIDE_DELAY = 3800;     // 播放中无操作多久后自动隐藏控制层（ms）
  const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]; // 更多菜单里的倍速选项

  /* =========================================================
   * 1. 样式注入（iOS 高斯模糊玻璃材质）
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

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS_TEXT;
    (document.head || document.documentElement).appendChild(style);
  }

  /* =========================================================
   * 2. 图标（内联 SVG，模拟 SF Symbols 观感）
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

  function makeButton(cls, svg, title) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cls;
    btn.innerHTML = svg;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    return btn;
  }

  function makeMenuItem(svg, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'iosgp-menu-item';
    btn.innerHTML = `${svg}<span class="iosgp-menu-label">${label}</span>`;
    return btn;
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

    const pipBtn = makeButton('iosgp-btn iosgp-corner-btn', ICONS.pip, '画中画');
    const fullscreenBtn = makeButton('iosgp-btn iosgp-corner-btn', ICONS.fullscreen, '全屏');

    const cornerActions = document.createElement('div');
    cornerActions.className = 'iosgp-corner-actions';
    cornerActions.append(pipBtn, fullscreenBtn);

    const muteBtn = makeButton('iosgp-btn iosgp-corner-btn', ICONS.volumeOn, '静音');
    const cornerActionsLeft = document.createElement('div');
    cornerActionsLeft.className = 'iosgp-corner-actions-left';
    cornerActionsLeft.append(muteBtn);

    // 左上角：返回（仅全屏时显示，用于退出全屏）
    const returnBtn = makeButton('iosgp-btn iosgp-corner-btn', ICONS.back, '返回');
    returnBtn.style.display = 'none';
    const topActionsLeft = document.createElement('div');
    topActionsLeft.className = 'iosgp-top-actions-left';
    topActionsLeft.append(returnBtn);

    // 右上角：更多菜单（下载视频 / 复制视频链接 / 倍速）
    const moreBtn = makeButton('iosgp-btn iosgp-corner-btn', ICONS.more, '更多');
    const downloadItem = makeMenuItem(ICONS.download, '下载视频');
    const copyItem = makeMenuItem(ICONS.link, '复制视频链接');
    downloadItem.disabled = true;
    copyItem.disabled = true;

    const speedLabel = document.createElement('div');
    speedLabel.className = 'iosgp-menu-speed-label';
    speedLabel.textContent = '播放速度';

    const speedGrid = document.createElement('div');
    speedGrid.className = 'iosgp-menu-speed-grid';
    SPEED_OPTIONS.forEach((rate) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'iosgp-speed-chip';
      chip.textContent = `${rate}x`;
      chip.dataset.rate = String(rate);
      speedGrid.appendChild(chip);
    });

    const menu = document.createElement('div');
    menu.className = 'iosgp-menu';
    menu.append(downloadItem, copyItem, speedLabel, speedGrid);

    const menuWrap = document.createElement('div');
    menuWrap.className = 'iosgp-menu-wrap';
    menuWrap.append(moreBtn, menu);

    const topActionsRight = document.createElement('div');
    topActionsRight.className = 'iosgp-top-actions-right';
    topActionsRight.append(menuWrap);

    controls.append(scrim, center, bottom, cornerActions, cornerActionsLeft, topActionsLeft, topActionsRight);

    return {
      controls, scrim, backBtn, playBtn, fwdBtn, track, buffered, filled, thumb, curTime, durTime,
      pipBtn, fullscreenBtn, muteBtn, returnBtn, moreBtn, menu, downloadItem, copyItem, speedGrid
    };
  }

  /* =========================================================
   * 5. 事件绑定
   * =======================================================*/
  function wireEvents(video, wrapper, refs) {
    const {
      controls, scrim, backBtn, playBtn, fwdBtn, track, buffered, filled, thumb, curTime, durTime,
      pipBtn, fullscreenBtn, muteBtn, returnBtn, moreBtn, menu, downloadItem, copyItem, speedGrid
    } = refs;

    /* ---- 显示/隐藏控制层 ---- */
    let hideTimer = null;
    function showControls() {
      controls.classList.add('iosgp-visible');
      scheduleHide();
    }
    function hideControlsNow() {
      clearTimeout(hideTimer);
      controls.classList.remove('iosgp-visible');
    }
    function toggleControlsVisibility() {
      if (controls.classList.contains('iosgp-visible')) hideControlsNow();
      else showControls();
    }
    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!video.paused) controls.classList.remove('iosgp-visible');
      }, HIDE_DELAY);
    }
    // 只对真实鼠标悬停生效（pointerType === 'mouse'），避免触摸设备的合成 mousemove 事件
    // 干扰点击切换逻辑（这正是之前“隐藏后要等几秒才能再呼出”的原因）。
    wrapper.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showControls(); });
    wrapper.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') showControls(); });
    wrapper.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(hideTimer);
      if (!video.paused) controls.classList.remove('iosgp-visible');
    });
    // 点击/触摸空白处（视频画面本身，或控制层里没有单独处理点击的区域）：
    // 有控件就隐藏，没有就呼出——绑定在 wrapper 上，不管控制层当前是否可见都能收到点击。
    wrapper.addEventListener('click', toggleControlsVisibility);

    /* ---- 播放 / 暂停 ---- */
    function syncPlayState() {
      const paused = video.paused || video.ended;
      wrapper.classList.toggle('iosgp-paused', paused);
      playBtn.innerHTML = paused ? ICONS.play : ICONS.pause;
      playBtn.title = paused ? '播放' : '暂停';
      if (paused) {
        clearTimeout(hideTimer);
        controls.classList.add('iosgp-visible');
      } else {
        scheduleHide();
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

    /* ---- 静音（只做开关切换，不做音量大小条） ---- */
    function syncMuteIcon() {
      const isMuted = video.muted || video.volume === 0;
      muteBtn.innerHTML = isMuted ? ICONS.volumeOff : ICONS.volumeOn;
      muteBtn.title = isMuted ? '取消静音' : '静音';
    }
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.muted = !video.muted;
      // 如果之前音量被网站自己调成了 0，取消静音也听不到声音，这里顺手恢复到可听见的音量
      if (!video.muted && video.volume === 0) video.volume = 1;
    });
    video.addEventListener('volumechange', syncMuteIcon);
    syncMuteIcon();

    /* ---- 更多菜单：下载视频 / 复制视频链接 ---- */
    const DOWNLOADABLE_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv', 'ogg', 'flv', '3gp'];

    function isStreamingUrl(url) {
      const u = (url || '').toLowerCase();
      return u.includes('.m3u8') || u.includes('.mpd');
    }

    // 从各种来源尝试取到真实的视频地址（针对 blob: 这类 MSE/HLS 播放器）
    function getRealUrl() {
      // 1. 直接可用的非 blob 地址
      const direct = video.currentSrc || video.src;
      if (direct && !direct.startsWith('blob:')) return direct;

      // 2. <source> 子元素
      const srcEl = video.querySelector('source[src]');
      if (srcEl && srcEl.src && !srcEl.src.startsWith('blob:')) return srcEl.src;

      // 3. Performance Resource Timing API（最可靠！）
      //    任何 HLS/DASH 播放器在开始播放前都必须通过 HTTP 取一次 .m3u8/.mpd 清单，
      //    这条请求会被浏览器记录在 performance.getEntriesByType('resource') 里。
      //    取最近加载的那条——在当前页面打开了多个视频时，最新的那条最可能对应当前视频。
      try {
        const entries = performance.getEntriesByType('resource');
        // 优先找 .m3u8，其次 .mpd，取 initiatorType 为 xmlhttprequest/fetch（播放器拉取方式）
        const streamEntry = [...entries].reverse().find((e) =>
          isStreamingUrl(e.name) && (e.initiatorType === 'xmlhttprequest' || e.initiatorType === 'fetch')
        );
        if (streamEntry) return streamEntry.name;
        // 部分播放器用 <link>/<script> 加载，再宽松找一次
        const anyStream = [...entries].reverse().find((e) => isStreamingUrl(e.name));
        if (anyStream) return anyStream.name;
      } catch (_) { /* 隐私模式可能不支持 Performance API，静默忽略 */ }

      // 4. video 元素上的常见 data-* 属性
      const dataKeys = ['src', 'hls-src', 'hls', 'm3u8', 'stream', 'url', 'video-src',
                        'source', 'manifest', 'stream-url', 'video-url'];
      for (const k of dataKeys) {
        const v = video.dataset[k] || video.getAttribute(`data-${k}`);
        if (v && v.startsWith('http')) return v;
      }

      // 5. hls.js 实例（常挂在 video._hls / video.__hls 上）
      for (const k of ['_hls', '__hls', 'hlsInstance']) {
        try { if (video[k] && video[k].url) return video[k].url; } catch (_) {}
      }

      // 6. 实在找不到真实地址，退回 blob:（复制意义不大，但至少不是 undefined）
      return direct || '';
    }

    function guessFilename(url, fallbackExt) {
      try {
        const path = new URL(url, location.href).pathname;
        const last = path.split('/').pop();
        if (last) return decodeURIComponent(last);
      } catch (_) {}
      return fallbackExt ? `video.${fallbackExt}` : 'video';
    }

    function triggerDownload(url, filename) {
      try {
        const a = document.createElement('a');
        a.href = url;
        if (filename) a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (_) {}
    }

    async function copyTextToClipboard(text) {
      // 1. Tampermonkey 原生剪贴板（最可靠，不受页面焦点和权限策略限制）
      if (typeof GM_setClipboard !== 'undefined') {
        try { GM_setClipboard(text, 'text'); return true; } catch (_) {}
      }
      // 2. 现代浏览器 Clipboard API（需要页面焦点和权限）
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {}
      // 3. execCommand 降级：元素必须移到屏幕外（不能用 opacity:0，否则无法 focus/select），
      //    并且要先 focus() 再 select()，最后检查 execCommand 的返回值
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
        document.body.appendChild(ta);
        ta.focus({ preventScroll: true });
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (_) {}
      return false;
    }

    let blobSniffToken = 0;
    function updateMenuState() {
      const url = getRealUrl();
      const myToken = ++blobSniffToken;

      copyItem.disabled = !url;
      if (!url) { downloadItem.disabled = true; return; }

      // m3u8 / mpd → 链接可以复制，但下载置灰（清单文件不是完整视频）
      if (isStreamingUrl(url)) {
        downloadItem.disabled = true;
        return;
      }

      if (url.startsWith('blob:')) {
        // 还是 blob:（连 Performance API 都没找到真实地址）→ 异步嗅探 mime type
        downloadItem.disabled = true;
        fetch(url)
          .then((r) => r.blob())
          .then((blob) => {
            if (myToken !== blobSniffToken) return;
            const t = (blob.type || '').toLowerCase();
            const isStream = ['mpegurl', 'mp2t', 'x-mpegts', 'dash'].some((k) => t.includes(k));
            const isFile = ['mp4', 'webm', 'matroska', 'quicktime'].some((k) => t.includes(k));
            downloadItem.disabled = isStream || !isFile;
          })
          .catch(() => { if (myToken === blobSniffToken) downloadItem.disabled = true; });
        return;
      }

      // 普通 HTTP URL → 按后缀名判断
      let ext = '';
      try {
        ext = (new URL(url, location.href).pathname.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
      } catch (_) {}
      downloadItem.disabled = !DOWNLOADABLE_EXT.includes(ext);
    }

    function closeMenu() {
      menu.classList.remove('iosgp-menu-open');
      document.removeEventListener('click', closeMenu);
    }
    function openMenu() {
      updateMenuState();
      menu.classList.add('iosgp-menu-open');
      setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.contains('iosgp-menu-open') ? closeMenu() : openMenu();
    });
    menu.addEventListener('click', (e) => e.stopPropagation());

  /* ---- 替换原有的 copyItem 和 downloadItem 事件监听（在 wireEvents 函数内部） ---- */

// 下载视频（修复：直接从 getRealUrl 获取链接，不再依赖未设置的 dataset.url）
downloadItem.addEventListener('click', (e) => {
  e.stopPropagation();
  if (downloadItem.disabled) return;
  const url = getRealUrl();
  if (!url) return;
  let ext = '';
  try { ext = (new URL(url, location.href).pathname.match(/\.([a-z0-9]+)$/) || [])[1] || ''; } catch (_) {}
  triggerDownload(url, guessFilename(url, ext || 'mp4'));
  closeMenu();
});

// 复制视频链接（修复：函数名从 getVideoSourceUrl 改为 getRealUrl）
copyItem.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (copyItem.disabled) return;
  const url = getRealUrl(); // 原为 getVideoSourceUrl，导致 url 为 undefined
  const label = copyItem.querySelector('.iosgp-menu-label');
  if (!url) {
    // 万一菜单状态失效（虽 disabled 已处理，但加上兜底）
    if (label) {
      const original = label.textContent;
      label.textContent = '无链接';
      setTimeout(() => { label.textContent = original; closeMenu(); }, 900);
    } else {
      closeMenu();
    }
    return;
  }
  try {
    const ok = await copyTextToClipboard(url);
    if (label) {
      const original = label.textContent;
      label.textContent = ok ? '已复制 ✓' : '复制失败';
      setTimeout(() => {
        label.textContent = original;
        closeMenu();
      }, 900);
    } else {
      closeMenu();
    }
  } catch (err) {
    if (label) {
      const original = label.textContent;
      label.textContent = '复制出错';
      setTimeout(() => { label.textContent = original; closeMenu(); }, 900);
    } else {
      closeMenu();
    }
  }
});
    /* ---- 倍速（0.5x ~ 3x） ---- */
    const speedChips = Array.from(speedGrid.querySelectorAll('.iosgp-speed-chip'));
    function syncSpeedChips() {
      const rate = video.playbackRate;
      speedChips.forEach((chip) => {
        chip.classList.toggle('iosgp-speed-active', Math.abs(parseFloat(chip.dataset.rate) - rate) < 0.001);
      });
    }
    speedChips.forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        video.playbackRate = parseFloat(chip.dataset.rate);
        syncSpeedChips();
        closeMenu();
      });
    });
    video.addEventListener('ratechange', syncSpeedChips);
    syncSpeedChips();

    /* ---- 菜单自适应缩放：ResizeObserver 监听 wrapper 宽度，写入 --iosgp-scale ---- */
    // 参考宽度 640px → scale=1.0；小视频缩小，大/全屏视频按比例放大，最小 0.55 最大 1.3
    const scaleObserver = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      const scale = Math.max(0.55, Math.min(w / 640, 1.3));
      controls.style.setProperty('--iosgp-scale', scale.toFixed(3));
    });
    scaleObserver.observe(wrapper);

    /* ---- 快进 / 快退 ---- */
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

    /* ---- 进度条：展示 ---- */
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
        if (isFinite(d) && d > 0) {
          buffered.style.width = clamp(end / d, 0, 1) * 100 + '%';
        }
      }
    }
    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('progress', updateProgress);
    video.addEventListener('loadedmetadata', updateProgress);
    video.addEventListener('durationchange', updateProgress);
    updateProgress();

    /* ---- 进度条：拖拽 seek ---- */
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
      try { track.setPointerCapture(e.pointerId); } catch (_) {}
      seekFromEvent(e);
      showControls();
    });
    track.addEventListener('pointermove', (e) => { if (dragging) seekFromEvent(e); });
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('click', (e) => e.stopPropagation());
    track.addEventListener('keydown', (e) => {
      const d = video.duration || Infinity;
      if (e.key === 'ArrowRight') {
        video.currentTime = clamp(video.currentTime + SEEK_STEP, 0, d);
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        video.currentTime = clamp(video.currentTime - SEEK_STEP, 0, d);
        e.preventDefault();
      }
    });

    /* ---- 画中画 ---- */
    const pipSupported = typeof document.pictureInPictureEnabled !== 'undefined'
      && document.pictureInPictureEnabled
      && !video.disablePictureInPicture;

    if (!pipSupported) {
      pipBtn.style.display = 'none';
    } else {
      pipBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          if (document.pictureInPictureElement === video) {
            await document.exitPictureInPicture();
          } else {
            await video.requestPictureInPicture();
          }
        } catch (_) { /* 部分网站的 video 可能限制 PiP，静默忽略 */ }
      });
    }

    /* ---- 全屏：对 wrapper（而非 video 本身）请求全屏，这样自定义控制层会一起进入全屏 ---- */
    const fsSupported = !!(wrapper.requestFullscreen || wrapper.webkitRequestFullscreen);
    if (!fsSupported) {
      fullscreenBtn.style.display = 'none';
      returnBtn.style.display = 'none';
    } else {
      const isFullscreen = () =>
        document.fullscreenElement === wrapper || document.webkitFullscreenElement === wrapper;
      const syncFsIcon = () => {
        fullscreenBtn.innerHTML = isFullscreen() ? ICONS.fullscreenExit : ICONS.fullscreen;
        fullscreenBtn.title = isFullscreen() ? '退出全屏' : '全屏';
      };
      const doExitFullscreen = async () => {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      };
      fullscreenBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          if (isFullscreen()) {
            await doExitFullscreen();
          } else if (wrapper.requestFullscreen) {
            await wrapper.requestFullscreen();
          } else if (wrapper.webkitRequestFullscreen) {
            wrapper.webkitRequestFullscreen();
          }
        } catch (_) { /* 部分网站可能拦截全屏请求，静默忽略 */ }
      });

      // 左上角的「返回」：只在全屏时出现，效果等同于退出全屏（类似 iOS 全屏播放器的返回箭头）
      const syncReturnButton = () => {
        returnBtn.style.display = isFullscreen() ? 'flex' : 'none';
      };
      returnBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await doExitFullscreen(); } catch (_) {}
      });
      document.addEventListener('fullscreenchange', syncReturnButton);
      document.addEventListener('webkitfullscreenchange', syncReturnButton);
      syncReturnButton();

      // 如果 video 本身被直接全屏（比如浏览器右键菜单「全屏」、网站自己的双击事件、
      // 或者其它脚本直接调用了 video.requestFullscreen），自动改为让 wrapper 全屏，
      // 这样无论用户从哪里触发全屏，看到的都是同一套 iOS 控制层。
      const redirectRawVideoFullscreen = () => {
        const rawVideoFs = document.fullscreenElement === video || document.webkitFullscreenElement === video;
        if (!rawVideoFs) return;
        const reenter = () => {
          if (wrapper.requestFullscreen) return wrapper.requestFullscreen();
          if (wrapper.webkitRequestFullscreen) return Promise.resolve(wrapper.webkitRequestFullscreen());
        };
        Promise.resolve()
          .then(reenter)
          .catch(() => {
            // 部分引擎要求先退出当前全屏元素，才能让另一个元素进入全屏
            const exit = document.exitFullscreen
              ? document.exitFullscreen()
              : Promise.resolve(document.webkitExitFullscreen && document.webkitExitFullscreen());
            Promise.resolve(exit).then(reenter).catch(() => {});
          });
      };
      document.addEventListener('fullscreenchange', redirectRawVideoFullscreen);
      document.addEventListener('webkitfullscreenchange', redirectRawVideoFullscreen);

      // 进入全屏自动锁定横屏，退出时解锁（主要对移动端有效，桌面端会静默失败，不影响其它功能）
      const syncOrientation = () => {
        try {
          if (isFullscreen()) {
            if (screen.orientation && screen.orientation.lock) {
              screen.orientation.lock('landscape').catch(() => {});
            }
          } else if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
          }
        } catch (_) { /* 部分浏览器/桌面端不支持横竖屏锁定，静默忽略 */ }
      };
      document.addEventListener('fullscreenchange', syncOrientation);
      document.addEventListener('webkitfullscreenchange', syncOrientation);

      document.addEventListener('fullscreenchange', syncFsIcon);
      document.addEventListener('webkitfullscreenchange', syncFsIcon);
      syncFsIcon();
    }

    /* ---- 靠近/触摸按钮时放大 + 周围高光（类似 Dock 磁性效果） ---- */
    const magneticButtons = [backBtn, playBtn, fwdBtn, pipBtn, fullscreenBtn, muteBtn, returnBtn, moreBtn];
    const MAGNET_RADIUS = 95;     // 影响范围半径（px）
    const MAGNET_MAX_SCALE = 1.22; // 最贴近时的放大倍数
    let magnetFrame = null;
    let lastPointer = null;

    function applyMagnet() {
      magnetFrame = null;
      if (!lastPointer) return;
      const { x, y } = lastPointer;
      magneticButtons.forEach((btn) => {
        if (!btn || btn.style.display === 'none') return;
        const r = btn.getBoundingClientRect();
        const dx = x - (r.left + r.width / 2);
        const dy = y - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy);
        const t = clamp(1 - dist / MAGNET_RADIUS, 0, 1);
        const eased = t * t * (3 - 2 * t); // smoothstep 缓动，过渡更顺滑
        btn.style.setProperty('--mag', (1 + eased * (MAGNET_MAX_SCALE - 1)).toFixed(3));
        btn.style.setProperty('--glow', eased.toFixed(3));
      });
    }
    function resetMagnet() {
      lastPointer = null;
      magneticButtons.forEach((btn) => {
        if (!btn) return;
        btn.style.setProperty('--mag', '1');
        btn.style.setProperty('--glow', '0');
      });
    }
    function updateMagnetPointer(e) {
      lastPointer = { x: e.clientX, y: e.clientY };
      if (magnetFrame == null) magnetFrame = requestAnimationFrame(applyMagnet);
    }
    // 触摸设备没有“悬停”这个阶段，光靠 pointermove 永远等不到——
    // 所以 pointerdown（手指刚接触屏幕的那一刻）也要立刻算一次距离，触碰按钮周围立即泛光。
    wrapper.addEventListener('pointermove', updateMagnetPointer);
    wrapper.addEventListener('pointerdown', updateMagnetPointer);
    wrapper.addEventListener('pointerleave', resetMagnet);
    // 鼠标：松开按键后只要光标还停在原地就应继续保持高光，只有真正移出区域才复位。
    // 触摸：手指离开屏幕（没有“悬停”这一说）就应该让光晕回落。
    wrapper.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') resetMagnet(); });
    wrapper.addEventListener('pointercancel', (e) => { if (e.pointerType !== 'mouse') resetMagnet(); });

    // 按下时轻微缩小（与靠近放大的倍数相乘），松开/移出后复位
    magneticButtons.forEach((btn) => {
      if (!btn) return;
      btn.addEventListener('pointerdown', () => btn.style.setProperty('--press', '0.9'));
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
        btn.addEventListener(ev, () => btn.style.setProperty('--press', '1'))
      );
    });
  }

  /* =========================================================
   * 6. 包裹 video 并挂载控制层
   * =======================================================*/
  function enhanceVideo(video) {
    if (video.hasAttribute(PROCESSED_ATTR)) return;
    video.setAttribute(PROCESSED_ATTR, '1');

    try { video.controls = false; } catch (_) {}
    video.removeAttribute('controls');

    const cs = getComputedStyle(video);
    // 很多“信息流视频”站点（比如 X/Twitter）会用 position:absolute/fixed 让
    // <video> 撑满一个占位容器，本身并不占用文档正常流的空间。如果直接插入一个
    // 默认 position:static 的 wrapper，就会在页面里凭空多占出一块空间，把周围
    // 内容挤开、布局错乱——这也是之前在这类站点上播放器“整个不对”的主要原因。
    const isOutOfFlow = cs.position === 'absolute' || cs.position === 'fixed';

    const wrapper = document.createElement('div');
    wrapper.className = 'iosgp-wrapper';
    const styleParts = [
      `display:${cs.display === 'inline' ? 'inline-block' : cs.display}`,
      `width:${video.style.width || cs.width}`,
      `height:${video.style.height || cs.height}`,
      `max-width:${cs.maxWidth}`,
      `margin:${cs.margin}`,
      `vertical-align:${cs.verticalAlign}`
    ];
    if (isOutOfFlow) {
      // 把原本的定位方式原样搬到 wrapper 上，让 wrapper 顶替 video 原来的位置和
      // 层级，而不是另起一块新空间。
      styleParts.push(
        `position:${cs.position}`,
        `top:${cs.top}`,
        `right:${cs.right}`,
        `bottom:${cs.bottom}`,
        `left:${cs.left}`,
        `z-index:${cs.zIndex}`
      );
    }
    wrapper.style.cssText = styleParts.join(';');

    video.parentNode.insertBefore(wrapper, video);
    wrapper.appendChild(video);
    video.style.width = '100%';
    video.style.height = '100%';
    if (isOutOfFlow) {
      // video 现在是 wrapper 的子元素，撑满 wrapper（100%/100%）即可；
      // 把它自己的定位重置为 static，避免残留的 top/left 等偏移值造成错位。
      video.style.position = 'static';
    }

    const refs = buildControls();
    wrapper.appendChild(refs.controls);
    wireEvents(video, wrapper, refs);
  }

  function tryEnhance(video) {
    if (!video || video.tagName !== 'VIDEO') return;
    if (video.hasAttribute(PROCESSED_ATTR)) return;
    if (video.closest && video.closest('.iosgp-wrapper')) return;

    const rect = video.getBoundingClientRect();
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
      // 视频可能还在加载/布局未完成，稍后重试一次
      if (!video.dataset.iosgpRetried) {
        video.dataset.iosgpRetried = '1';
        setTimeout(() => tryEnhance(video), 1000);
      }
      return;
    }
    enhanceVideo(video);
  }

  /* =========================================================
   * 7. 扫描现有 video + 监听动态插入（SPA / 懒加载）
   * =======================================================*/
  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('video').forEach(tryEnhance);
  }

  function init() {
    injectStyles();
    scan(document);

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'VIDEO') tryEnhance(n);
          scan(n);
        });
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
