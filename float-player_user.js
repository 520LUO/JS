// ==UserScript==
// @name         悬浮媒体播放器 
// @namespace    https://github.com/520luo/js/float-player
// @version      26.11.06.23
// @description  识别到页面里的 M3U8 / MP4 / WebM 后，自动在顶部悬浮出 iOS 玻璃质感播放器（默认暂停，可点 ✕ 关闭）；油猴菜单可开关「自动悬浮播放器」「固定悬浮窗」；可联动 M3U8 下载器
// @icon         https://raw.githubusercontent.com/520LUO/icons/refs/heads/main/player.png
// @author       520LUO
// @match        *://*/*
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_getResourceText
// @connect      *
// @resource     hlsjs https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  /* =========================================================
   * 单实例守卫：防止「重装 + 兜底注入」重复执行（重复会导致 fetch 被包两层、出现两个小球）
   * =======================================================*/
  try {
    const de = document.documentElement;
    if (window.__mfFloatPlayer || (de && de.hasAttribute('data-mf-float-player-loaded'))) return;
    window.__mfFloatPlayer = 1;
    if (de) de.setAttribute('data-mf-float-player-loaded', '1');
  } catch (_) {}

  const IS_TOP = window.top === window.self;
  const TOPW = window.top;
  const MSG = '__mf_float_player__';
  const MSG_PAUSE = '__mf_float_player_pause__';
  const MAX_ITEMS = 12;
  const SKIP_SECONDS = 10;
  const SEEK_STEP = 5;
  const HIDE_DELAY = 3800;
  const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const AD_RE = /(doubleclick|googlesyndication|googleadservices|adservice|adsystem|[\/_.\-]ads?[\/_.\-]|preroll|\/vast|beacon|tracking)/i;

  /* =========================================================
   * 1. 媒体嗅探（所有框架都需要；子框架只做这一部分，然后直接返回）
   * =======================================================*/
  const found = new Map(); // url -> { url, type, from, t, ref }
  const dismissed = new Set(); // 用户点 ✕ 关掉过的地址：自动悬浮不再打扰
  const rawFetch = typeof window.fetch === 'function' ? window.fetch : null;

  const HLS_RE = /\.m3u8(?=$|[?&#=\/;,])/i;
  const FILE_RE = /\.(?:mp4|m4v|webm|mov|ogv)(?=$|[?&#=\/;,])/i;
  const HLS_CT = /mpegurl/i;
  const FILE_CT = /^video\/(?:mp4|webm|ogg|quicktime|x-m4v)/i;
  const SEG_RE = /\.(?:m4s|ts|m4f|cmfv|cmfa|aac|mp3|m4a|key)(?![a-z0-9])/i;

  // 在 pathname + search + hash 里整体匹配：能识别 ?url=xxx.m3u8、/x.m3u8?token= 等
  function typeOf(url) {
    let s;
    try { const u = new URL(url); s = u.pathname + u.search + u.hash; } catch (_) { return null; }
    let d = s;
    try { d = decodeURIComponent(s); } catch (_) {}
    if (HLS_RE.test(d)) return 'hls';
    if (FILE_RE.test(d)) return 'file';
    return null;
  }

  function addFound(raw, from, forced, ref) {
    let url;
    try { url = new URL(raw, location.href).href; } catch (_) { return; }
    if (!/^https?:/i.test(url) || url.length > 4096) return;
    const type = typeOf(url) || (forced === 'hls' || forced === 'file' ? forced : null);
    if (!type || AD_RE.test(url)) return;
    if (!IS_TOP) {
      // 带上来源页地址：顶层播放时用作 Referer
      try { TOPW.postMessage({ [MSG]: 1, url, from, type, ref: location.href }, '*'); } catch (_) {}
      return;
    }
    const old = found.get(url);
    if (old) { old.t = Date.now(); if (ref && !old.ref) old.ref = ref; return; }
    found.set(url, { url, type, from, t: Date.now(), ref: ref || location.href });
    if (found.size > MAX_ITEMS) {
      const oldest = [...found.values()].sort((a, b) => a.t - b.t)[0];
      found.delete(oldest.url);
    }
    if (type === 'hls') scheduleEnrich();
    refreshBall();
    maybeAutoOpen();
  }

  // 后台探测新发现的 HLS 播放列表（只拉文本）：识别主清单 / 子清单、记录时长，供选源与清晰度使用
  let enrichTimer = 0;
  function scheduleEnrich() {
    clearTimeout(enrichTimer);
    enrichTimer = setTimeout(async () => {
      const todo = [...found.values()].filter((i) => i.type === 'hls' && i._dur === undefined && !i._probe && !dismissed.has(i.url)).sort((a, b) => b.t - a.t).slice(0, 6);
      if (!todo.length) return;
      await Promise.all(todo.map(probeDuration));
      refreshBall();
      if (found.size) scheduleEnrich(); // 还有没探测的，下一轮
    }, 800);
  }

  // 响应头 Content-Type 嗅探：无后缀的播放列表 / 视频流
  function ctCheck(url, ct, len) {
    if (!ct || !url) return;
    if (HLS_CT.test(ct)) { addFound(url, 'ct', 'hls'); return; }
    if (FILE_CT.test(ct) && len >= 2 * 1024 * 1024 && !SEG_RE.test(url)) addFound(url, 'ct', 'file');
  }

  function scanVideo(v) {
    try {
      const s = v.currentSrc || v.src;
      if (s && !s.startsWith('blob:')) addFound(s, 'video');
      v.querySelectorAll('source[src]').forEach((x) => addFound(x.src, 'source'));
    } catch (_) {}
  }

  try {
    if (rawFetch) {
      window.fetch = function (input) {
        try { addFound(typeof input === 'string' ? input : (input && input.url) || String(input), 'fetch'); } catch (_) {}
        const p = rawFetch.apply(this, arguments);
        try {
          p.then((res) => {
            try { ctCheck(res.url, res.headers.get('content-type'), +res.headers.get('content-length') || 0); } catch (_) {}
          }, () => {});
        } catch (_) {}
        return p;
      };
    }
    const rawOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      try {
        const url = String(u);
        addFound(url, 'xhr');
        if (!SEG_RE.test(url)) {
          this.addEventListener('readystatechange', function () {
            if (this.readyState !== 2) return;
            try { ctCheck(this.responseURL || url, this.getResponseHeader('content-type'), +this.getResponseHeader('content-length') || 0); } catch (_) {}
          });
        }
      } catch (_) {}
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

  // 暂停本文档里的视频，并逐层通知子框架（子框架只接受来自父框架的消息）
  function pauseLocalVideos() {
    document.querySelectorAll('video').forEach((v) => { if (!v.paused) { try { v.pause(); } catch (_) {} } });
  }
  function broadcastPause() {
    try {
      for (let i = 0; i < window.frames.length; i++) {
        try { window.frames[i].postMessage({ [MSG_PAUSE]: 1 }, '*'); } catch (_) {}
      }
    } catch (_) {}
  }

  const scanAll = () => document.querySelectorAll('video').forEach(scanVideo);

  if (!IS_TOP) {
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (d && d[MSG_PAUSE] === 1 && e.source === window.parent) { pauseLocalVideos(); broadcastPause(); }
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanAll); else scanAll();
    window.addEventListener('load', scanAll);
    return; // 子框架到此为止：不解析 CSS / 图标 / 播放器代码
  }

  /* =========================================================
   * 以下仅顶层窗口执行
   * =======================================================*/
  let P = null; // 当前播放器实例（同一时间只有一个）

  // 只接受来自本页面子框架的嗅探消息（拒绝页面脚本在顶层自己伪造）
  function isChildFrame(w) {
    try {
      for (let i = 0; i < 12 && w && w !== TOPW; i++) {
        if (w.parent === TOPW) return true;
        if (w.parent === w) return false;
        w = w.parent;
      }
    } catch (_) {}
    return false;
  }
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d[MSG] !== 1 || typeof d.url !== 'string') return;
    if (!isChildFrame(e.source)) return;
    addFound(d.url, d.from || 'frame', d.type, typeof d.ref === 'string' && /^https?:/i.test(d.ref) ? d.ref : '');
  });

  /* ---------- 设置：自动悬浮开关（油猴菜单切换，GM 存储持久化） ---------- */
  const AUTO_KEY = 'mf_float_player_auto';
  let autoFloat = true;
  try { if (typeof GM_getValue === 'function') autoFloat = GM_getValue(AUTO_KEY, true) !== false; } catch (_) {}
  const FIXED_KEY = 'mf_float_player_fixed';
  let fixedMode = true; // 固定悬浮窗（默认开）；关闭后可单指拖动、双指捏合缩放
  try { if (typeof GM_getValue === 'function') fixedMode = GM_getValue(FIXED_KEY, true) !== false; } catch (_) {}
  const DEBUG_KEY = 'mf_float_player_debug';
  let debugOn = false;
  try { if (typeof GM_getValue === 'function') debugOn = GM_getValue(DEBUG_KEY, false) === true; } catch (_) {}
  const dbg = (m) => { try { console.log('[float-player]', m); } catch (_) {} if (debugOn) { try { pageToast(m); } catch (_) {} } };
  let menuIds = [];
  const freeView = { x: 0, y: 0, s: 1 }; // 自由模式下悬浮窗的偏移 / 缩放（重新打开时保留）

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
        boxShadow: '0 6px 24px rgba(0,0,0,.28)',
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
    if (typeof GM_registerMenuCommand !== 'function') return;
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
      const id2 = GM_registerMenuCommand(fixedMode ? '📌 固定悬浮窗-ON' : '🖐 固定悬浮窗-OFF（可拖动 / 捏合）', () => {
        fixedMode = !fixedMode;
        try { if (typeof GM_setValue === 'function') GM_setValue(FIXED_KEY, fixedMode); } catch (_) {}
        if (fixedMode) { freeView.x = 0; freeView.y = 0; freeView.s = 1; }
        registerMenu();
        pageToast(fixedMode ? '悬浮窗已固定' : '悬浮窗已解锁：单指拖动，双指捏合缩放');
        if (P) P.applyLayout();
      });
      if (id2 !== undefined) menuIds.push(id2);
      const id3 = GM_registerMenuCommand(debugOn ? '🐞 调试提示-ON' : '🐞 调试提示-OFF', () => {
        debugOn = !debugOn;
        try { if (typeof GM_setValue === 'function') GM_setValue(DEBUG_KEY, debugOn); } catch (_) {}
        registerMenu();
        pageToast(debugOn ? '调试提示已开启：播放时会显示分片加载情况' : '调试提示已关闭');
      });
      if (id3 !== undefined) menuIds.push(id3);
    } catch (_) {}
  }

  function pickBest(excludeDismissed) {
    let list = [...found.values()];
    if (excludeDismissed) list = list.filter((i) => !dismissed.has(i.url));
    if (!list.length) return null;
    const lift = (it) => (it && it.type === 'hls' && parentOf(it.url)) || it; // 子清单 → 主清单（才有清晰度可选）
    const pv = [...document.querySelectorAll('video')].find((v) => !v.paused && v.currentSrc);
    if (pv) { const it = list.find((i) => i.url === pv.currentSrc); if (it) return lift(it); }
    list.sort((a, b) => b.t - a.t);
    return lift(list.find((i) => i.type === 'hls') || list[0]);
  }

  function shortName(url) {
    try {
      const u = new URL(url);
      return `${u.hostname}/${u.pathname.split('/').filter(Boolean).slice(-2).join('/')}`;
    } catch (_) { return url; }
  }

  function originOf(u) { try { return new URL(u).origin; } catch (_) { return ''; } }

  /* ---------- SPA 路由切换：清掉上一个页面的嗅探结果 ---------- */
  const routeKey = () => location.origin + location.pathname + location.search + (/^#[\/!]/.test(location.hash) ? location.hash : '');
  let lastRoute = routeKey();
  function onRouteChange() {
    const k = routeKey();
    if (k === lastRoute) return;
    lastRoute = k;
    const now = Date.now();
    const keep = new Set();
    if (P) keep.add(P.current.url);
    document.querySelectorAll('video').forEach((v) => { if (!v.paused && v.currentSrc) keep.add(v.currentSrc); });
    // 保留：正在播放的、以及刚冒出来（1.5 秒内，可能是新页面预取的）的地址
    [...found.values()].forEach((it) => { if (!keep.has(it.url) && now - it.t > 1500) found.delete(it.url); });
    dismissed.clear();
    playlistCache.clear();
    refreshBall();
    maybeAutoOpen();
  }
  ['pushState', 'replaceState'].forEach((k) => {
    try {
      const raw = history[k];
      if (typeof raw === 'function') history[k] = function () { const r = raw.apply(this, arguments); setTimeout(onRouteChange, 0); return r; };
    } catch (_) {}
  });
  window.addEventListener('popstate', onRouteChange);
  window.addEventListener('hashchange', onRouteChange);
  setInterval(onRouteChange, 1000); // 兜底：脚本沙盒里改写 history 可能对页面不生效

  /* =========================================================
   * 2. hls.js 懒加载 + 网络层（GM_xmlhttpRequest 加载器、播放列表缓存）
   * =======================================================*/
  const hasGM = () => typeof GM_xmlhttpRequest === 'function';
  // 网络层选择规则（没有任何自动切换）：
  //   流地址或来源页与当前页面不同源 → 一律走 GM_xmlhttpRequest（带来源页 Referer，绕过 CORS）；
  //   同源 → 一律走原生 XHR / fetch。
  const needGM = (it) => {
    if (!hasGM() || !it) return false;
    const a = originOf(it.url), b = it.ref ? originOf(it.ref) : '';
    return (!!a && a !== location.origin) || (!!b && b !== location.origin);
  };

  function getGlobalHls() {
    try { if (window.Hls) return window.Hls; } catch (_) {}
    try { if (typeof unsafeWindow !== 'undefined' && unsafeWindow.Hls) return unsafeWindow.Hls; } catch (_) {}
    try { if (typeof globalThis !== 'undefined' && globalThis.Hls) return globalThis.Hls; } catch (_) {}
    return null;
  }
  function injectScript(opt) {
    return new Promise((resolve) => {
      try {
        const s = document.createElement('script');
        if (opt.text) s.textContent = opt.text; else s.src = opt.src;
        s.onload = () => { s.remove(); resolve(); };
        s.onerror = () => { s.remove(); resolve(); };
        (document.head || document.documentElement).appendChild(s);
        if (opt.text) { s.remove(); resolve(); } // 内联脚本同步执行，不会触发 onload
      } catch (_) { resolve(); }
    });
  }
  let hlsPromise = null;
  function loadHls() {
    if (hlsPromise) return hlsPromise;
    hlsPromise = (async () => {
      let H = getGlobalHls();
      if (H) return H;
      let code = '';
      try { if (typeof GM_getResourceText === 'function') code = GM_getResourceText('hlsjs') || ''; } catch (_) {}
      // 1) @resource 文本，在脚本环境里按 CommonJS 方式执行
      if (code) {
        try {
          const mod = { exports: {} };
          new Function('module', 'exports', 'define', code).call(window, mod, mod.exports, undefined);
          const ex = mod.exports;
          H = (ex && ex.isSupported ? ex : (ex && ex.default)) || getGlobalHls();
          if (H && H.isSupported) return H;
        } catch (_) {}
        // 2) 注入到页面（严格 CSP 的站点可能拦截内联脚本）
        await injectScript({ text: code });
        H = getGlobalHls();
        if (H) return H;
      }
      // 3) @resource 没取到：用 GM 把 CDN 脚本文本拉下来，同样先在脚本环境执行
      const CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
      if (!code && hasGM()) {
        const txt = await gmText(CDN, '');
        if (txt && txt.length > 10000) {
          try {
            const mod = { exports: {} };
            new Function('module', 'exports', 'define', txt).call(window, mod, mod.exports, undefined);
            const ex = mod.exports;
            H = (ex && ex.isSupported ? ex : (ex && ex.default)) || getGlobalHls();
            if (H && H.isSupported) return H;
          } catch (_) {}
          await injectScript({ text: txt });
          H = getGlobalHls();
          if (H) return H;
        }
      }
      // 4) 直接加载 CDN 脚本（同样可能受 CSP 限制）
      await injectScript({ src: CDN });
      H = getGlobalHls();
      if (H) return H;
      hlsPromise = null; // 失败允许下次重试
      return null;
    })();
    return hlsPromise;
  }

  // 探测阶段拉过的播放列表：播放时优先复用，避免一次性 token 的链接被拉两次
  const playlistCache = new Map(); // url -> { text, t }
  function takeCache(url) {
    const c = playlistCache.get(url);
    if (!c) return null;
    playlistCache.delete(url);
    return Date.now() - c.t < 120000 ? c.text : null;
  }

  function gmReq(o) {
    const headers = {};
    // 只带 Referer：Origin 会让做了 CORS 白名单校验的（本来不设盗链的）源直接返回 403
    if (o.ref) headers.Referer = o.ref;
    if (o.range) headers.Range = o.range;
    const req = {
      method: 'GET', url: o.url, headers, timeout: o.timeout || 15000,
      onload: o.onload, onerror: o.onerror, ontimeout: o.ontimeout, onabort: o.onerror
    };
    if (o.type === 'arraybuffer') req.responseType = 'arraybuffer';
    else if (o.type === 'binstr') req.overrideMimeType = 'text/plain; charset=x-user-defined';
    return GM_xmlhttpRequest(req);
  }
  function gmText(url, ref) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (done) return; done = true; clearTimeout(wd); resolve(v); };
      const wd = setTimeout(() => fin(null), 9000); // GM 偶发既不 onload 也不 onerror
      try {
        gmReq({
          url, ref, timeout: 8000,
          onload: (r) => fin(r.status >= 200 && r.status < 300 ? (r.responseText != null ? r.responseText : (typeof r.response === 'string' ? r.response : null)) : null),
          onerror: () => fin(null), ontimeout: () => fin(null)
        });
      } catch (_) { fin(null); }
    });
  }
  async function nativeText(url, ms) {
    if (!rawFetch) return null;
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const tm = setTimeout(() => { if (ac) ac.abort(); }, ms || 6000);
    try {
      const r = await rawFetch.call(window, url, ac ? { signal: ac.signal } : undefined);
      if (!r.ok) return null;
      return await r.text();
    } catch (_) { return null; } finally { clearTimeout(tm); }
  }
  // 探测用的文本请求：跨域只走 GM，同源只走原生，不互相回退
  async function fetchText(url, ref, useGM) {
    return useGM ? gmText(url, ref) : nativeText(url);
  }

  // GM 二进制响应的读取方式：'ab' = responseType arraybuffer；运行时不认时自动改为 'str'（x-user-defined），全局记住
  let gmBinMode = 'ab';
  const isBinary = (x) => {
    const tag = Object.prototype.toString.call(x);
    return tag === '[object ArrayBuffer]' || ArrayBuffer.isView(x) || typeof (x && x.arrayBuffer) === 'function';
  };
  const looksBase64 = (x) => typeof x === 'string' && x.length >= 16 && /^[A-Za-z0-9+/=\r\n]+$/.test(x.length > 4000 ? x.slice(0, 4000) : x);
  function latin1ToBuf(str) { const u = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 255; return u.buffer; }
  function base64ToBuf(b64) { const bin = atob(b64.replace(/[\r\n]/g, '')); return latin1ToBuf(bin); }
  // 统一成本 realm 的 ArrayBuffer（跨 realm 的 instanceof 会失败）
  async function toArrayBuffer(x) {
    if (x == null) return null;
    const tag = Object.prototype.toString.call(x);
    if (tag === '[object ArrayBuffer]') return x instanceof ArrayBuffer ? x : new Uint8Array(x).slice().buffer;
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength).slice().buffer;
    if (typeof x.arrayBuffer === 'function') return await x.arrayBuffer();
    return null;
  }
  const hex = (buf, n) => Array.from(new Uint8Array(buf, 0, Math.min(n, buf.byteLength))).map((b) => b.toString(16).padStart(2, '0')).join(' ');

  const ST_NAME = { 0x1b: 'H.264', 0x24: 'HEVC', 0x0f: 'AAC', 0x11: 'AAC-LATM', 0x03: 'MP2', 0x04: 'MP2', 0x81: 'AC-3', 0x87: 'E-AC-3', 0x15: 'ID3', 0x06: '私有', 0x02: 'MPEG2视频', 0x10: 'MPEG4视频' };
  function tsInfo(buf) {
    try {
      const u = new Uint8Array(buf);
      let sync = 0, bad = 0, pmtPid = -1, patSeen = 0;
      const pids = {}, streams = [];
      for (let o = 0; o + 188 <= u.length && o < 188 * 2500; o += 188) {
        if (u[o] !== 0x47) { bad++; continue; }
        sync++;
        const pusi = (u[o + 1] & 0x40) !== 0, pid = ((u[o + 1] & 0x1f) << 8) | u[o + 2];
        pids[pid] = (pids[pid] || 0) + 1;
        const afc = (u[o + 3] >> 4) & 3;
        let p = o + 4;
        if (afc & 2) p += 1 + u[o + 4];
        if (!(afc & 1) || p >= o + 188 || !pusi) continue;
        if (pid === 0 || (pid === pmtPid && !streams.length)) {
          p += 1 + u[p];
          const tid = u[p], secLen = ((u[p + 1] & 0x0f) << 8) | u[p + 2];
          if (pid === 0 && tid === 0 && !patSeen) {
            patSeen = 1;
            for (let q = p + 8; q + 4 <= p + 3 + secLen - 4; q += 4) { if (((u[q] << 8) | u[q + 1]) !== 0) { pmtPid = ((u[q + 2] & 0x1f) << 8) | u[q + 3]; break; } }
          } else if (pid === pmtPid && tid === 2) {
            const pil = ((u[p + 10] & 0x0f) << 8) | u[p + 11];
            for (let q = p + 12 + pil; q + 5 <= p + 3 + secLen - 4;) {
              const st = u[q], ep = ((u[q + 1] & 0x1f) << 8) | u[q + 2], el = ((u[q + 3] & 0x0f) << 8) | u[q + 4];
              streams.push((ST_NAME[st] || ('0x' + st.toString(16))) + '@' + ep); q += 5 + el;
            }
          }
        }
      }
      const top = Object.keys(pids).sort((a, b) => pids[b] - pids[a]).slice(0, 5).map((k) => k + ':' + pids[k]).join(',');
      return `TS同步${sync}/坏${bad} PAT${patSeen ? '有' : '无'} PMT${pmtPid >= 0 ? '@' + pmtPid : '无'} 流[${streams.join(' ') || '未解析到'}] PID包数[${top}]`;
    } catch (e) { return 'TS解析失败'; }
  }
  const plLog = []; // 最近拉到的播放列表文本（只留开头），卡住诊断时一并复制
  function newStats() {
    return {
      aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 }
    };
  }
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // hls.js 自定义 loader：命中缓存直接返回；mode='gm' 时全部走 GM_xmlhttpRequest（带来源页 Referer，绕过 CORS）；否则交给默认 XHR loader
  function makeLoader(H, mode, ref) {
    const Def = H.DefaultConfig && H.DefaultConfig.loader;
    return class MFLoader {
      constructor(config) {
        this._cfg = config; this._def = null; this._req = null; this._ctx = null;
        this._stats = newStats(); this._pending = false; this._hdr = '';
      }
      get context() { return this._def ? this._def.context : this._ctx; }
      set context(v) { this._ctx = v; }
      get stats() { return this._def ? this._def.stats : this._stats; }
      set stats(v) { this._stats = v; }
      destroy() {
        this.abort();
        if (this._def) { try { this._def.destroy(); } catch (_) {} this._def = null; }
      }
      abort() {
        if (this._def) { try { this._def.abort(); } catch (_) {} }
        if (this._pending) {
          this._pending = false; this._stats.aborted = true;
          try { if (this._req && this._req.abort) this._req.abort(); } catch (_) {}
        }
        this._req = null;
      }
      getCacheAge() { return null; }
      getResponseHeader(name) {
        if (this._def && this._def.getResponseHeader) return this._def.getResponseHeader(name);
        const m = new RegExp('^' + String(name).replace(/[^\w-]/g, '') + ':\\s*(.*)$', 'im').exec(this._hdr || '');
        return m ? m[1].trim() : null;
      }
      load(context, config, callbacks) {
        this._ctx = context;
        const stats = this._stats;
        stats.loading.start = nowMs();
        const isBuf = context.responseType === 'arraybuffer';
        if (!isBuf) {
          const cb0 = callbacks;
          callbacks = Object.assign({}, cb0, { onSuccess: (r, st, c, d) => {
            try { plLog.push({ url: context.url, text: String(r.data).slice(0, 1800) }); if (plLog.length > 4) plLog.shift(); } catch (_) {}
            cb0.onSuccess(r, st, c, d);
          } });
        }
        if (!isBuf) {
          const c = takeCache(context.url);
          if (c != null) {
            stats.loading.first = stats.loading.start + 1; stats.loading.end = Math.max(stats.loading.first, nowMs());
            stats.loaded = stats.total = c.length;
            setTimeout(() => callbacks.onSuccess({ url: context.url, data: c }, stats, context, null), 0);
            return;
          }
        }
        if ((mode !== 'gm' || !hasGM()) && Def) {
          this._def = new Def(this._cfg);
          this._def.load(context, config, callbacks);
          return;
        }
        let range;
        // hls.js 默认 rangeStart/rangeEnd 都是 0，只有 rangeEnd 为真且大于起点才是真正的字节范围（否则会发出非法的 bytes=0--1，被严格的服务器 416 / 400）
        if (Number.isFinite(context.rangeStart) && Number.isFinite(context.rangeEnd) && context.rangeEnd > context.rangeStart) range = `bytes=${context.rangeStart}-${context.rangeEnd - 1}`;
        const tmo = (config && config.timeout) || 20000;
        const wdMs = Math.min(tmo, 25000) + 2000;
        this._pending = true;
        let wd = 0;
        const fail = (kind, e) => { // kind: 'err' | 'timeout'
          if (!this._pending) return;
          this._pending = false; clearTimeout(wd);
          try { if (this._req && this._req.abort) this._req.abort(); } catch (_) {}
          if (kind === 'timeout') callbacks.onTimeout(stats, context, null); else callbacks.onError(e, context, null, stats);
        };
        const arm = () => { clearTimeout(wd); wd = setTimeout(() => { dbg('GM 请求无响应：' + context.url.split('/').pop().slice(0, 30)); fail('timeout'); }, wdMs); };
        const issue = (type, triedStr) => {
          arm();
          try {
            this._req = gmReq({
              url: context.url, ref, range, type, timeout: tmo,
              onload: async (r) => {
                if (!this._pending) return;
                this._hdr = r.responseHeaders || '';
                if (!(r.status >= 200 && r.status < 300)) {
                  this._pending = false; clearTimeout(wd);
                  dbg('GM HTTP ' + r.status + ' ' + context.url.split('/').pop().slice(0, 30));
                  callbacks.onError({ code: r.status, text: r.statusText || ('HTTP ' + r.status) }, context, r, stats); return;
                }
                let data = null;
                try {
                  if (!isBuf) data = r.responseText != null ? r.responseText : r.response;
                  else if (type === 'binstr') { const t = r.responseText != null ? r.responseText : r.response; data = typeof t === 'string' ? latin1ToBuf(t) : await toArrayBuffer(t); }
                  else if (isBinary(r.response)) data = await toArrayBuffer(r.response);
                  else if (looksBase64(r.response)) data = base64ToBuf(r.response); // 运行时把二进制编成了 base64
                  else if (typeof r.response === 'string' && !triedStr) { // 运行时不认 arraybuffer，只给了字符串：换旧式读法重来
                    gmBinMode = 'str'; dbg('GM 不支持 arraybuffer，改用 x-user-defined 读取');
                    issue('binstr', true); return;
                  }
                } catch (_) { data = null; }
                if (!this._pending) return;
                this._pending = false; clearTimeout(wd);
                if (data == null || (isBuf && !data.byteLength)) { dbg('GM 返回空数据'); callbacks.onError({ code: r.status, text: 'empty response' }, context, r, stats); return; }
                if (isBuf) dbg(`GM 分片 ${(data.byteLength / 1024) | 0}KB  头 ${hex(data, 4)}  (${gmBinMode})`);
                stats.loading.first = stats.loading.start + 1; stats.loading.end = Math.max(stats.loading.first, nowMs());
                stats.loaded = stats.total = isBuf ? data.byteLength : String(data).length;
                stats.bwEstimate = (stats.total * 8000) / Math.max(1, stats.loading.end - stats.loading.first);
                // 关键：hls.js 的分片数据是经由 onProgress 交给解封装器的（onSuccess 之后只做 flush）。
                // 默认 XHR loader 在 onSuccess 之前会先调一次 onProgress(stats, context, data, xhr)，自定义 loader 必须照做，否则分片「加载完成」但永远不会被解析
                if (callbacks.onProgress) { try { callbacks.onProgress(stats, context, data, r); } catch (e) { dbg('onProgress 异常：' + (e && e.message)); } }
                callbacks.onSuccess({ url: r.finalUrl || context.url, data, code: r.status }, stats, context, r);
              },
              onerror: () => { dbg('GM 网络错误 ' + context.url.split('/').pop().slice(0, 30)); fail('err', { code: 0, text: 'GM network error' }); },
              ontimeout: () => fail('timeout')
            });
          } catch (err) { dbg('GM 异常：' + (err && err.message)); fail('err', { code: 0, text: 'GM exception' }); }
        };
        issue(isBuf ? (gmBinMode === 'str' ? 'binstr' : 'arraybuffer') : 'text', gmBinMode === 'str');
      }
    };
  }

  /* =========================================================
   * 3. 样式（沿用原「原生视频播放器美化」的 iOS 玻璃材质）+ 悬浮所需补充样式
   *    注意：控制层容器本身不做 opacity 渐变——opacity < 1 的祖先会成为 backdrop root，
   *    让按钮的 backdrop-filter 在渐变期间看不到视频，渐变结束才突然变模糊。
   *    这里改为让每个叶子元素自己渐隐渐显，并让模糊常驻（隐藏时靠 visibility:hidden 零开销）。
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
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
}

.iosgp-controls.iosgp-visible {
  pointer-events: auto; /* 控制层可见时恢复命中，否则按钮继承 none 无法点击 */
}

/* ---------- 叶子元素：自己渐隐渐显（隐藏时 visibility:hidden，不参与命中与绘制） ---------- */
.iosgp-scrim, .iosgp-time, .iosgp-track {
  opacity: 0;
  visibility: hidden;
  transition: opacity .28s cubic-bezier(.4,0,.2,1), visibility 0s linear .28s, height .15s ease;
}
.iosgp-visible .iosgp-scrim, .iosgp-visible .iosgp-time, .iosgp-visible .iosgp-track {
  opacity: 1;
  visibility: visible;
  transition: opacity .28s cubic-bezier(.4,0,.2,1), visibility 0s linear 0s, height .15s ease;
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
  position: relative;
  margin: 0;
  padding: 0;
  outline: none;
  font-family: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,.28);
  color: #fff;
  cursor: pointer;
  background: rgba(24,24,26,.5);
  box-shadow: 0 2px 10px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.18);
  /* 模糊常驻：按钮一出现就是模糊的 */
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  opacity: 0;
  visibility: hidden;
  transition: transform .18s cubic-bezier(.34,1.56,.64,1), opacity .28s cubic-bezier(.4,0,.2,1), visibility 0s linear .28s;
}
.iosgp-visible .iosgp-btn {
  opacity: 1;
  visibility: visible;
  transition: transform .18s cubic-bezier(.34,1.56,.64,1), opacity .28s cubic-bezier(.4,0,.2,1), visibility 0s linear 0s;
}
/* 高光：伪元素静态绘制一次，悬停/按下只切换 opacity（合成器处理，不触发重绘） */
.iosgp-btn::after {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: 0 0 12px 2px rgba(255,255,255,.7), inset 0 0 0 1px rgba(255,255,255,.8);
  opacity: 0;
  transition: opacity .16s ease;
}
@media (hover: hover) {
  .iosgp-btn:hover { transform: scale(1.1); }
  .iosgp-btn:hover::after { opacity: .85; }
}
.iosgp-btn:active { transform: scale(.92); }
.iosgp-btn:active::after { opacity: 1; }
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
  cursor: pointer;
  touch-action: none;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
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
  background: rgba(28,28,30,.74);
  border: 1px solid rgba(255,255,255,.22);
  box-shadow: 0 10px 24px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.15);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-6px) scale(.96);
  transform-origin: top right;
  pointer-events: none;
  transition: opacity .18s cubic-bezier(.4,0,.2,1), transform .22s cubic-bezier(.34,1.56,.64,1), visibility 0s linear .22s;
}
.iosgp-menu.iosgp-menu-open {
  opacity: 1;
  visibility: visible;
  transform: translateY(0) scale(1);
  pointer-events: auto;
  transition: opacity .18s cubic-bezier(.4,0,.2,1), transform .22s cubic-bezier(.34,1.56,.64,1), visibility 0s linear 0s;
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
  .iosgp-scrim, .iosgp-time, .iosgp-center, .iosgp-bottom,
  .iosgp-btn, .iosgp-corner-actions, .iosgp-corner-actions-left,
  .iosgp-top-actions-left, .iosgp-menu, .iosgp-speed-pop, .iosgp-track, .iosgp-thumb {
    transition: none !important;
  }
}
`;

  const EXTRA_CSS = `
/* —— 去掉触摸时的蓝色选中框 / 焦点框 / 长按菜单，并禁止选中文字 —— */
*, *::before, *::after { -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; }
.iosgp-wrapper, .iosgp-wrapper * { -webkit-user-select: none; user-select: none; }
.iosgp-wrapper, .iosgp-btn, .iosgp-track, .iosgp-menu-item, .iosgp-speed-chip, video { outline: none !important; }
.iosgp-btn:focus, .iosgp-btn:focus-visible, .iosgp-track:focus, .iosgp-track:focus-visible,
.iosgp-menu-item:focus, .iosgp-speed-chip:focus { outline: none !important; box-shadow: none; }
.iosgp-wrapper video { pointer-events: none; }
.iosgp-wrapper { touch-action: manipulation; }

/* —— 布局：进度条在上、按钮在下，右下角放得下 倍速 / 画中画 / 全屏 —— */
.iosgp-bottom { bottom: 56px; padding: 0 16px; }
.iosgp-corner-actions { right: 12px; bottom: 12px; gap: 8px; }
.iosgp-corner-actions-left { left: 12px; bottom: 12px; }
.iosgp-top-actions-left { left: 12px; top: 12px; }
.iosgp-top-actions-right { right: 12px; top: 12px; }
.iosgp-btn.iosgp-speed-btn, .iosgp-visible .iosgp-btn.iosgp-speed-btn { width: auto; min-width: 40px; height: 36px; padding: 0 8px; border: 0; border-radius: 10px;
  background: none; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none;
  font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: .01em; text-shadow: 0 1px 4px rgba(0,0,0,.65); }
.iosgp-speed-btn::after { display: none; }
.iosgp-visible .iosgp-btn.iosgp-speed-btn:hover, .iosgp-visible .iosgp-btn.iosgp-speed-btn:active { transform: none; opacity: .6; }

/* —— 弹出菜单整体按播放器宽度缩放（--iosgp-scale 约 0.85 ~ 1.25） —— */
.iosgp-menu { min-width: calc(150px * var(--iosgp-scale, 1)); border-radius: calc(13px * var(--iosgp-scale, 1)); top: 42px; }
.iosgp-menu-item { font-size: calc(11.5px * var(--iosgp-scale, 1)); padding: calc(8px * var(--iosgp-scale, 1)) calc(11px * var(--iosgp-scale, 1)); gap: calc(8px * var(--iosgp-scale, 1)); }
.iosgp-menu-item svg { width: calc(14px * var(--iosgp-scale, 1)); height: calc(14px * var(--iosgp-scale, 1)); }
.iosgp-menu-speed-label { font-size: calc(9.5px * var(--iosgp-scale, 1)); padding: calc(7px * var(--iosgp-scale, 1)) calc(11px * var(--iosgp-scale, 1)) calc(3px * var(--iosgp-scale, 1)); }
.iosgp-menu-speed-grid { gap: calc(5px * var(--iosgp-scale, 1)); padding: calc(4px * var(--iosgp-scale, 1)) calc(9px * var(--iosgp-scale, 1)) calc(9px * var(--iosgp-scale, 1)); }
.iosgp-speed-chip { font-size: calc(11.5px * var(--iosgp-scale, 1)); padding: calc(6px * var(--iosgp-scale, 1)) calc(8px * var(--iosgp-scale, 1)); border-radius: calc(8px * var(--iosgp-scale, 1)); }

/* —— 倍速弹出菜单：贴在倍速按钮上方，右对齐；模糊常驻，关闭时 visibility:hidden —— */
.iosgp-speed-pop { position: absolute; right: 12px; bottom: 56px; z-index: 5; padding: calc(8px * var(--iosgp-scale, 1));
  border-radius: calc(14px * var(--iosgp-scale, 1)); background: rgba(28,28,30,.76);
  border: 1px solid rgba(255,255,255,.22); box-shadow: 0 10px 24px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.15);
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
  opacity: 0; visibility: hidden; transform: translateY(6px) scale(.96); transform-origin: bottom right; pointer-events: none;
  transition: opacity .18s cubic-bezier(.4,0,.2,1), transform .22s cubic-bezier(.34,1.56,.64,1), visibility 0s linear .22s; }
.iosgp-speed-pop.iosgp-open { opacity: 1; visibility: visible; transform: translateY(0) scale(1); pointer-events: auto;
  transition: opacity .18s cubic-bezier(.4,0,.2,1), transform .22s cubic-bezier(.34,1.56,.64,1), visibility 0s linear 0s; }
.iosgp-speed-pop .iosgp-menu-speed-grid { grid-template-columns: repeat(3, minmax(calc(46px * var(--iosgp-scale, 1)), 1fr)); padding: 0; }

.iosgp-wrapper { width: 100%; aspect-ratio: 16 / 9; border-radius: 18px; background: #000;
  box-shadow: 0 12px 38px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.12); }
.iosgp-wrapper.iosgp-fs { width: 100vw; height: 100dvh; aspect-ratio: auto; border-radius: 0; box-shadow: none; --fo: 18px; }
/* —— 全屏：--fo 为统一位移量；顶部按钮向下 / 向内，底部按钮向上 / 向内，并避开刘海安全区 —— */
.iosgp-fs .iosgp-top-actions-left  { top: calc(12px + var(--fo) + env(safe-area-inset-top, 0px));    left:  calc(12px + var(--fo) + env(safe-area-inset-left, 0px)); }
.iosgp-fs .iosgp-top-actions-right { top: calc(12px + var(--fo) + env(safe-area-inset-top, 0px));    right: calc(12px + var(--fo) + env(safe-area-inset-right, 0px)); }
.iosgp-fs .iosgp-corner-actions-left { bottom: calc(12px + var(--fo) + env(safe-area-inset-bottom, 0px)); left:  calc(12px + var(--fo) + env(safe-area-inset-left, 0px)); }
.iosgp-fs .iosgp-corner-actions    { bottom: calc(12px + var(--fo) + env(safe-area-inset-bottom, 0px)); right: calc(12px + var(--fo) + env(safe-area-inset-right, 0px)); }
.iosgp-fs .iosgp-bottom { bottom: calc(56px + var(--fo) + env(safe-area-inset-bottom, 0px)); padding: 0 calc(16px + var(--fo) + env(safe-area-inset-right, 0px)) 0 calc(16px + var(--fo) + env(safe-area-inset-left, 0px)); }
.iosgp-fs .iosgp-speed-pop { bottom: calc(56px + var(--fo) + env(safe-area-inset-bottom, 0px)); right: calc(12px + var(--fo) + env(safe-area-inset-right, 0px)); }
.iosgp-fs .iosgp-toast { top: calc(56px + var(--fo)); }
.iosgp-menu { max-height: 60vh; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; box-sizing: border-box; max-width: min(280px, 80vw); }
.iosgp-src-box { max-height: calc(150px * var(--iosgp-scale, 1)); overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.iosgp-menu-src { display: block; width: 100%; min-width: 0; box-sizing: border-box; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: none; }
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
   * 4. 图标
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
   * 5. 工具函数
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
   * 6. 控制层 DOM
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
    const speedBtn = makeButton('iosgp-btn iosgp-speed-btn', '1x', '播放速度');
    speedBtn.innerHTML = '<span>1x</span>';
    cornerActions.append(speedBtn, pipBtn, fullscreenBtn);

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
    const speedPop = document.createElement('div'); speedPop.className = 'iosgp-speed-pop';
    speedPop.appendChild(speedGrid);
    const qualityLabel = menuLabel('清晰度');
    const qualityBox = document.createElement('div');
    const sourceLabel = menuLabel('视频源');
    const sourceBox = document.createElement('div'); sourceBox.className = 'iosgp-src-box';
    const menu = document.createElement('div'); menu.className = 'iosgp-menu';
    menu.append(downloadItem, copyItem, qualityLabel, qualityBox, sourceLabel, sourceBox);
    const menuWrap = document.createElement('div'); menuWrap.className = 'iosgp-menu-wrap';
    menuWrap.append(moreBtn, menu);
    const topActionsRight = document.createElement('div'); topActionsRight.className = 'iosgp-top-actions-right';
    topActionsRight.append(menuWrap);

    const spin = document.createElement('div'); spin.className = 'iosgp-spin';
    const toastEl = document.createElement('div'); toastEl.className = 'iosgp-toast';

    controls.append(scrim, center, bottom, cornerActions, cornerActionsLeft, topActionsLeft, topActionsRight, speedPop, spin, toastEl);
    return {
      controls, backBtn, playBtn, fwdBtn, track, buffered, filled, thumb, curTime, durTime, pipBtn, fullscreenBtn,
      muteBtn, closeBtn, returnBtn, moreBtn, menu, downloadItem, copyItem, speedBtn, speedPop, speedGrid, qualityLabel, qualityBox,
      sourceLabel, sourceBox, spin, toastEl
    };
  }

  /* =========================================================
   * 7. 悬浮播放器
   * =======================================================*/
  const HOST_BASE = 'all:initial;position:fixed;left:50%;z-index:2147483646;display:block;';
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

  function anchorDownload(url, name) {
    try {
      const a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (_) {}
  }

  function openPlayer(item, opts) {
    opts = opts || {};
    if (!item || P || !document.body) return;

    const host = document.createElement('div');
    host.setAttribute('data-mf-float-player', '');
    host.style.cssText = HOST_BASE + 'top:8px;width:min(94vw,560px);transform:translateX(-50%);';
    const root = host.attachShadow({ mode: 'closed' }); // closed：页面脚本拿不到播放器内部
    root.innerHTML = `<style>${CSS_TEXT}${EXTRA_CSS}</style>
      <div class="iosgp-wrapper"><video playsinline webkit-playsinline preload="metadata"></video></div>`;
    const wrapper = root.querySelector('.iosgp-wrapper');
    const video = root.querySelector('video');
    const refs = buildControls();
    wrapper.appendChild(refs.controls);
    const {
      controls, backBtn, playBtn, fwdBtn, track, buffered, filled, thumb, curTime, durTime, pipBtn, fullscreenBtn,
      muteBtn, closeBtn, returnBtn, moreBtn, menu, downloadItem, copyItem, speedBtn, speedPop, speedGrid, qualityLabel, qualityBox,
      sourceLabel, sourceBox, spin, toastEl
    } = refs;

    const me = { host, video, hls: null, current: item, closed: false, applyLayout: () => applyLayout() };
    P = me;
    const cleanups = [];
    const onDoc = (ev, fn) => { document.addEventListener(ev, fn); cleanups.push(() => document.removeEventListener(ev, fn)); };
    document.documentElement.appendChild(host);
    refreshBall();

    let toastTimer = 0;
    const toast = (msg, ms) => {
      toastEl.textContent = msg; toastEl.classList.add('iosgp-show');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('iosgp-show'), ms || 2600);
    };
    const seekBy = (d) => { video.currentTime = clamp(video.currentTime + d, 0, video.duration || Infinity); };

    /* ---- 显示 / 隐藏控制层（默认暂停：控制层常驻） ---- */
    let hideTimer = 0;
    const scheduleHide = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { if (!video.paused && !menu.classList.contains('iosgp-menu-open') && !speedPop.classList.contains('iosgp-open')) controls.classList.remove('iosgp-visible'); }, HIDE_DELAY);
    };
    const showControls = () => { controls.classList.add('iosgp-visible'); scheduleHide(); };
    const hideControlsNow = () => { clearTimeout(hideTimer); controls.classList.remove('iosgp-visible'); };
    controls.classList.add('iosgp-visible');
    wrapper.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showControls(); });
    wrapper.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') showControls(); });
    wrapper.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { clearTimeout(hideTimer); if (!video.paused) controls.classList.remove('iosgp-visible'); } });
    wrapper.addEventListener('contextmenu', (e) => e.preventDefault());

    /* ---- 点击：单击显隐控制层；双击左 / 右侧快退 / 快进，双击中间播放 / 暂停 ---- */
    let lastTap = 0, lastTapX = 0, tapTimer = 0;
    wrapper.addEventListener('click', (e) => {
      if (suppressClick) return;
      if (lpFired) { lpFired = false; return; }
      closePopups();
      const now = Date.now();
      if (now - lastTap < 280 && Math.abs(e.clientX - lastTapX) < 90) {
        clearTimeout(tapTimer); lastTap = 0;
        const r = wrapper.getBoundingClientRect(), rel = (e.clientX - r.left) / Math.max(1, r.width);
        if (rel < 0.4) { seekBy(-SKIP_SECONDS); toast('⏪ 快退 10 秒', 700); }
        else if (rel > 0.6) { seekBy(SKIP_SECONDS); toast('快进 10 秒 ⏩', 700); }
        else video.paused ? video.play().catch(() => {}) : video.pause();
        return;
      }
      lastTap = now; lastTapX = e.clientX;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { controls.classList.contains('iosgp-visible') ? hideControlsNow() : showControls(); }, 250);
    });

    /* ---- 长按 2x 倍速（松手恢复） ---- */
    let lpTimer = 0, lpActive = false, lpFired = false, lpPrevRate = 1, lpX = 0, lpY = 0;
    wrapper.addEventListener('pointerdown', (e) => {
      if ((e.pointerType === 'mouse' && e.button !== 0) || noGesture(e)) return;
      lpFired = false; clearTimeout(lpTimer);
      lpX = e.clientX; lpY = e.clientY;
      lpTimer = setTimeout(() => {
        lpTimer = 0;
        if (video.paused || suppressClick) return;
        lpFired = true; lpActive = true; lpPrevRate = video.playbackRate;
        video.playbackRate = 2; toast('2x 倍速播放中', 60000);
      }, 500);
    });
    wrapper.addEventListener('pointermove', (e) => {
      if (lpTimer && Math.hypot(e.clientX - lpX, e.clientY - lpY) > 10) { clearTimeout(lpTimer); lpTimer = 0; }
    });
    const endLongPress = () => {
      clearTimeout(lpTimer); lpTimer = 0;
      if (lpActive) {
        lpActive = false; video.playbackRate = lpPrevRate;
        clearTimeout(toastTimer); toastEl.classList.remove('iosgp-show');
        setTimeout(() => { lpFired = false; }, 120); // 吞掉松手后紧跟的那次 click
      }
    };
    wrapper.addEventListener('pointerup', endLongPress);
    wrapper.addEventListener('pointercancel', endLongPress);

    /* ---- 播放 / 暂停 ---- */
    const syncPlayState = () => {
      const paused = video.paused || video.ended;
      playBtn.innerHTML = paused ? ICONS.play : ICONS.pause;
      playBtn.title = paused ? '播放' : '暂停';
      if (paused) { clearTimeout(hideTimer); controls.classList.add('iosgp-visible'); } else scheduleHide();
    };
    video.addEventListener('play', () => {
      // 播放器开始播放时，暂停页面（含所有 iframe）上其他视频，避免两路声音
      pauseLocalVideos(); broadcastPause();
      syncPlayState();
    });
    video.addEventListener('pause', syncPlayState);
    video.addEventListener('ended', syncPlayState);
    syncPlayState();
    playBtn.addEventListener('click', (e) => { e.stopPropagation(); video.paused ? video.play().catch(() => {}) : video.pause(); });
    video.addEventListener('waiting', () => spin.classList.add('iosgp-show'));
    for (const ev of ['playing', 'canplay', 'seeked', 'loadeddata']) video.addEventListener(ev, () => spin.classList.remove('iosgp-show'));

    /* ---- 媒体会话（耳机按键 / 锁屏控制） ---- */
    const ms = navigator.mediaSession;
    const MS_ACTIONS = ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'stop'];
    const setupMediaSession = () => {
      if (!ms) return;
      try {
        if (typeof MediaMetadata === 'function') ms.metadata = new MediaMetadata({ title: document.title || shortName(item.url), artist: location.hostname });
        const set = (a, f) => { try { ms.setActionHandler(a, f); } catch (_) {} };
        set('play', () => { video.play().catch(() => {}); });
        set('pause', () => video.pause());
        set('stop', () => video.pause());
        set('seekbackward', (d) => seekBy(-((d && d.seekOffset) || SKIP_SECONDS)));
        set('seekforward', (d) => seekBy((d && d.seekOffset) || SKIP_SECONDS));
        set('seekto', (d) => { if (d && d.seekTime != null && isFinite(d.seekTime)) video.currentTime = d.seekTime; });
      } catch (_) {}
    };
    const teardownMediaSession = () => {
      if (!ms) return;
      MS_ACTIONS.forEach((a) => { try { ms.setActionHandler(a, null); } catch (_) {} });
      try { ms.metadata = null; } catch (_) {}
    };
    setupMediaSession();

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
    backBtn.addEventListener('click', (e) => { e.stopPropagation(); seekBy(-SKIP_SECONDS); showControls(); });
    fwdBtn.addEventListener('click', (e) => { e.stopPropagation(); seekBy(SKIP_SECONDS); showControls(); });

    /* ---- 进度条 ---- */
    const updateProgress = () => {
      const d = video.duration;
      if (isFinite(d) && d > 0) {
        const pct = clamp(video.currentTime / d, 0, 1) * 100;
        filled.style.width = pct + '%'; thumb.style.left = pct + '%';
        curTime.textContent = fmt(video.currentTime); durTime.textContent = fmt(d);
        if (ms && ms.setPositionState) { try { ms.setPositionState({ duration: d, position: clamp(video.currentTime, 0, d), playbackRate: video.playbackRate || 1 }); } catch (_) {} }
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
      wrapper.classList.toggle('iosgp-fs', fs);
      applyLayout();
      sendDl(fs ? 'close' : 'reposition');
      closeBtn.style.display = fs ? 'none' : 'flex';
      returnBtn.style.display = fs ? 'flex' : 'none';
      fullscreenBtn.innerHTML = fs ? ICONS.fullscreenExit : ICONS.fullscreen;
      fullscreenBtn.title = fs ? '退出全屏' : '全屏';
      try {
        if (fs) {
          // 竖屏视频不强制横屏
          const portrait = video.videoHeight > video.videoWidth;
          if (!portrait && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        } else screen.orientation && screen.orientation.unlock && screen.orientation.unlock();
      } catch (_) {}
    };
    const exitFs = async () => { try { if (document.exitFullscreen) await document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (_) {} };
    if (!(host.requestFullscreen || host.webkitRequestFullscreen)) { fullscreenBtn.style.display = 'none'; }
    fullscreenBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        if (isFs()) await exitFs();
        else if (host.requestFullscreen) { try { await host.requestFullscreen({ navigationUI: 'hide' }); } catch (_) { await host.requestFullscreen(); } }
        else host.webkitRequestFullscreen();
      } catch (_) { toast('无法进入全屏'); }
    });
    returnBtn.addEventListener('click', (e) => { e.stopPropagation(); exitFs(); });
    onDoc('fullscreenchange', applyFs);
    onDoc('webkitfullscreenchange', applyFs);

    // 按视频真实比例调整悬浮窗：竖屏视频不会撑得过高
    let hostWidth = 'min(94vw, 560px)';
    function applyAspect() {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh || isFs()) return;
      const ratio = vw / vh;
      wrapper.style.aspectRatio = String(ratio);
      hostWidth = `min(94vw, 560px, calc(62vh * ${ratio.toFixed(4)}))`;
      applyLayout();
    }
    video.addEventListener('loadedmetadata', applyAspect);

    // 固定模式：顶部居中不动；自由模式：按 freeView 偏移 / 缩放（以顶部中点为缩放原点）
    function applyLayout() {
      if (!P || P.closed) return;
      if (isFs()) { host.style.cssText = HOST_STYLE_FS; return; }
      const free = !fixedMode;
      const top = free ? `calc(max(8px, env(safe-area-inset-top)) + ${freeView.y}px)` : 'max(8px, env(safe-area-inset-top))';
      const tx = free ? `calc(-50% + ${freeView.x}px)` : '-50%';
      host.style.cssText = `${HOST_BASE}top:${top};width:${hostWidth};transform:translateX(${tx}) scale(${free ? freeView.s : 1});transform-origin:top center;`;
      wrapper.style.touchAction = free ? 'none' : 'manipulation';
    }
    applyLayout();

    /* ---- 自由模式手势：单指拖动、双指捏合缩放 ---- */
    const ptrs = new Map();
    let gesture = null, suppressClick = false;
    const MIN_SCALE = 0.4;
    const maxScale = () => Math.max(1, innerWidth / Math.max(1, host.offsetWidth));
    function noGesture(e) { const t = e.composedPath && e.composedPath()[0]; return t && t.closest && t.closest('button, .iosgp-track, .iosgp-menu, .iosgp-speed-pop'); }
    const beginGesture = () => {
      const pts = [...ptrs.values()];
      if (pts.length >= 2) gesture = { mode: 'pinch', d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, s0: freeView.s };
      else if (pts.length === 1) gesture = { mode: 'drag', sx: pts[0].x, sy: pts[0].y, x0: freeView.x, y0: freeView.y, moved: false };
      else gesture = null;
    };
    wrapper.addEventListener('pointerdown', (e) => {
      if (fixedMode || isFs() || noGesture(e)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { wrapper.setPointerCapture(e.pointerId); } catch (_) {}
      beginGesture();
    });
    wrapper.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId) || !gesture) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture.mode === 'pinch' && ptrs.size >= 2) {
        const pts = [...ptrs.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        freeView.s = clamp(gesture.s0 * d / gesture.d0, MIN_SCALE, maxScale());
        suppressClick = true; applyLayout();
      } else if (gesture.mode === 'drag') {
        const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
        if (!gesture.moved && Math.hypot(dx, dy) < 8) return;
        gesture.moved = true; suppressClick = true;
        freeView.x = clamp(gesture.x0 + dx, -innerWidth / 2, innerWidth / 2);
        freeView.y = clamp(gesture.y0 + dy, -8, innerHeight - 90);
        applyLayout();
      }
    });
    const endPointer = (e) => {
      if (!ptrs.delete(e.pointerId)) return;
      try { wrapper.releasePointerCapture(e.pointerId); } catch (_) {}
      if (ptrs.size === 0) {
        gesture = null;
        setTimeout(() => { suppressClick = false; }, 60);
        sendDl('reposition');
      } else beginGesture(); // 双指变单指：以剩下的那根手指继续拖动
    };
    wrapper.addEventListener('pointerup', endPointer);
    wrapper.addEventListener('pointercancel', endPointer);

    /* ---- 更多菜单 ---- */
    const closeMenu = () => { menu.classList.remove('iosgp-menu-open'); root.removeEventListener('click', closeMenu); };
    const closeSpeed = () => { speedPop.classList.remove('iosgp-open'); root.removeEventListener('click', closeSpeed); };
    function closePopups() { closeMenu(); closeSpeed(); }

    /* ---- 倍速：右下角按钮，点击向上弹出菜单 ---- */
    const speedText = speedBtn.querySelector('span');
    const syncSpeed = () => {
      const r = video.playbackRate;
      speedText.textContent = `${r}x`;
      speedGrid.querySelectorAll('.iosgp-speed-chip').forEach((c) => c.classList.toggle('iosgp-speed-active', Math.abs(parseFloat(c.dataset.v) - r) < 0.001));
    };
    video.addEventListener('ratechange', syncSpeed);
    syncSpeed();
    speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (speedPop.classList.contains('iosgp-open')) { closeSpeed(); return; }
      closeMenu(); syncSpeed();
      speedPop.classList.add('iosgp-open');
      clearTimeout(hideTimer);
      setTimeout(() => root.addEventListener('click', closeSpeed), 0);
    });
    speedPop.addEventListener('click', (e) => e.stopPropagation());
    speedGrid.querySelectorAll('.iosgp-speed-chip').forEach((chip) => chip.addEventListener('click', (e) => {
      e.stopPropagation(); video.playbackRate = parseFloat(chip.dataset.v); closeSpeed(); scheduleHide();
    }));
    function renderMenu() {
      const cur = me.current;
      // 下载：直链文件走 GM_download；M3U8 联动「M3U8 媒体下载器」脚本
      downloadItem.disabled = false;
      downloadItem.querySelector('.iosgp-menu-label').textContent = '下载视频';
      copyItem.disabled = false;
      // 清晰度：① 多码率主清单（hls.levels）；② 没有主清单、每个清晰度各一个地址（同时长的 HLS 源）
      qualityBox.innerHTML = '';
      const hls = me.hls;
      const levels = hls && hls.levels && hls.levels.length > 1 ? hls.levels : null;
      let group = null;
      if (!levels && cur.type === 'hls' && cur._dur != null) {
        const alts = [...found.values()].filter((i) => i.type === 'hls' && i.url !== cur.url && !dismissed.has(i.url) && !hasParent(i) && i._dur != null && Math.abs(i._dur - cur._dur) <= 2);
        if (alts.length) group = [cur, ...alts];
      }
      qualityLabel.style.display = qualityBox.style.display = (levels || group) ? '' : 'none';
      if (levels) {
        const base = levels.map((l) => (l.height ? l.height + 'p' : Math.round((l.bitrate || 0) / 1000) + 'k'));
        const lab = base.map((x, i) => (base.filter((y) => y === x).length > 1 ? `${x}·${Math.round((levels[i].bitrate || 0) / 1000)}k` : x));
        const ids = [-1, ...levels.map((_, i) => i).sort((a, b) => (levels[b].height || 0) - (levels[a].height || 0) || (levels[b].bitrate || 0) - (levels[a].bitrate || 0))];
        const grid = chipGrid(ids, (i) => (i === -1 ? '自动' : lab[i]));
        grid.querySelectorAll('.iosgp-speed-chip').forEach((c) => {
          const i = parseInt(c.dataset.v, 10);
          c.classList.toggle('iosgp-speed-active', i === -1 ? hls.autoLevelEnabled : (!hls.autoLevelEnabled && hls.currentLevel === i));
          c.addEventListener('click', (e) => { e.stopPropagation(); hls.currentLevel = i; closeMenu(); });
        });
        qualityBox.appendChild(grid);
      } else if (group) {
        group.sort((x, y) => ((urlQuality(y.url) || {}).h || 0) - ((urlQuality(x.url) || {}).h || 0));
        const names = group.map((g, i) => { const q = urlQuality(g.url); return q ? q.label : '源' + (i + 1); });
        const grid = chipGrid(group.map((_, i) => i), (i) => names[i]);
        grid.querySelectorAll('.iosgp-speed-chip').forEach((c) => {
          const g = group[parseInt(c.dataset.v, 10)];
          c.classList.toggle('iosgp-speed-active', g.url === cur.url);
          c.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); if (g.url !== me.current.url) load(g, video.currentTime, !video.paused); });
        });
        qualityBox.appendChild(grid);
      }
      // 视频源：不列主清单的子清单、也不重复列已进清晰度的源
      sourceBox.innerHTML = '';
      const grouped = new Set(group ? group.map((g) => g.url) : []);
      const list = [...found.values()].filter((i) => !hasParent(i) && !grouped.has(i.url)).sort((a, b) => b.t - a.t).slice(0, 30);
      sourceLabel.style.display = sourceBox.style.display = list.length > 1 ? '' : 'none';
      list.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'iosgp-menu-item iosgp-menu-src' + (it.url === cur.url ? ' iosgp-on' : '');
        b.textContent = (it.type === 'hls' ? 'HLS · ' : '文件 · ') + shortName(it.url);
        b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); if (it.url !== me.current.url) load(it, video.currentTime, !video.paused); });
        sourceBox.appendChild(b);
      });
    }
    function openMenu() {
      closeSpeed();
      renderMenu();
      menu.style.maxHeight = Math.max(120, wrapper.clientHeight - 64) + 'px';
      menu.style.maxWidth = Math.max(150, Math.min(280, wrapper.clientWidth - 28)) + 'px'; // 不超出播放器宽度
      menu.classList.add('iosgp-menu-open');
      setTimeout(() => root.addEventListener('click', closeMenu), 0);
    }
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.contains('iosgp-menu-open') ? closeMenu() : openMenu(); });
    menu.addEventListener('click', (e) => e.stopPropagation());
    copyItem.addEventListener('click', async (e) => {
      e.stopPropagation();
      const label = copyItem.querySelector('.iosgp-menu-label'), original = label.textContent;
      const ok = await copyText(me.current.url);
      label.textContent = ok ? '已复制 ✓' : '复制失败';
      setTimeout(() => { label.textContent = original; closeMenu(); }, 900);
    });
    downloadItem.addEventListener('click', (e) => {
      e.stopPropagation();
      if (downloadItem.disabled) return;
      const cur = me.current;
      if (cur.type === 'hls') {
        if (!document.documentElement.hasAttribute('data-m3u8dl')) { toast('未检测到「M3U8 媒体下载器」脚本'); closeMenu(); return; }
        closeMenu();
        // 延后一拍再发：下载器有“点击空白处收起面板”的全局监听，避免刚打开就被它收掉
        setTimeout(() => sendDl('open'), 0);
        return;
      }
      let name = 'video.mp4';
      try { name = decodeURIComponent(new URL(cur.url).pathname.split('/').pop() || '') || name; } catch (_) {}
      if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += '.mp4';
      if (typeof GM_download === 'function') {
        try {
          GM_download({
            url: cur.url, name, saveAs: false, headers: cur.ref ? { Referer: cur.ref } : undefined,
            onerror: () => anchorDownload(cur.url, name),
            ontimeout: () => anchorDownload(cur.url, name)
          });
          toast('已开始下载', 1600);
        } catch (_) { anchorDownload(cur.url, name); }
      } else anchorDownload(cur.url, name);
      closeMenu();
    });

    /* ---- 菜单自适应缩放 ---- */
    const ro = new ResizeObserver(([entry]) => {
      const scale = Math.max(0.85, Math.min(entry.contentRect.width / 480, 1.25));
      controls.style.setProperty('--iosgp-scale', scale.toFixed(3));
    });
    ro.observe(wrapper);

    /* ---- 加载媒体（默认不自动播放） ---- */
    let startTime = 0, triedNative = false, loadSeq = 0;
    const destroyHls = () => { if (me.hls) { try { me.hls.destroy(); } catch (_) {} me.hls = null; } };
    video.addEventListener('loadedmetadata', () => {
      if (startTime > 1 && isFinite(video.duration) && startTime < video.duration - 2) video.currentTime = startTime;
      startTime = 0;
    });
    video.addEventListener('error', () => { if (!me.closed && !me.hls) { spin.classList.remove('iosgp-show'); toast('视频加载失败，可在 ⋯ 菜单里换一个源'); } });

    function startHls(H, it, mode) {
      destroyHls();
      // GM 模式关闭 worker：GM 给的 ArrayBuffer 可能是桥接对象，转交 worker（transfer）失败时 hls.js 不会报错，只会一直转圈
      const hls = new H({ enableWorker: mode !== 'gm', maxBufferLength: 40, loader: makeLoader(H, mode, it.ref) });
      me.hls = hls;
      hls.on(H.Events.MANIFEST_PARSED, () => { if (menu.classList.contains('iosgp-menu-open')) renderMenu(); });
      hls.loadSource(it.url); hls.attachMedia(video);
      let retry = 0, nonFatal = 0;
      // 卡住诊断：统计各阶段进度，转圈超过 12 秒就把状态显示出来（不依赖调试开关）
      const T = { man: 0, lvl: 0, fl: 0, fd: 0, ba: 0, errs: [], codecs: '' };
      const E = H.Events;
      hls.on(E.MANIFEST_LOADED, () => T.man++);
      hls.on(E.LEVEL_LOADED, () => T.lvl++);
      hls.on(E.FRAG_LOADING, () => T.fl++);
      T.last = '';
      hls.on(E.FRAG_LOADED, (_, d) => {
        T.fd++;
        try {
          const f = d.frag, p = d.payload;
          const buf = p && p.buffer && !(p instanceof ArrayBuffer) ? p.buffer : p;
          if (!T.ts && buf && !f.decryptdata && f.sn !== 'initSegment') T.ts = tsInfo(buf);
          T.last = `${f.type}#${f.sn}${f.decryptdata ? ' 加密' : ''} ${buf ? buf.byteLength : '?'}B 头${buf ? hex(buf, 4) : '?'}${f.initSegment ? ' 有MAP' : ''}`;
        } catch (_) {}
      });
      const C = {};
      ['MEDIA_ATTACHED', 'KEY_LOADING', 'KEY_LOADED', 'FRAG_DECRYPTED', 'FRAG_PARSING_INIT_SEGMENT', 'FRAG_PARSING_DATA', 'FRAG_PARSED', 'BUFFER_CREATED', 'AUDIO_TRACK_LOADING', 'AUDIO_TRACK_LOADED']
        .forEach((n) => { if (E[n]) hls.on(E[n], () => { C[n] = (C[n] || 0) + 1; }); });
      hls.on(E.BUFFER_APPENDED, () => T.ba++);
      hls.on(E.BUFFER_CODECS, (_, d) => { try { T.codecs = Object.keys(d).map((k) => (d[k] && d[k].codec) || '').filter(Boolean).join('+'); } catch (_) {} });
      const report = (n) => {
        if (me.hls !== hls || me.closed || !spin.classList.contains('iosgp-show')) return;
        const g = (k) => C[k] || 0;
        const msg = `卡住：清单${T.man} 子清单${T.lvl} 分片请求${T.fl}/完成${T.fd}/入缓冲${T.ba} 编码${T.codecs || '?'} rs${video.readyState}${video.error ? ' vErr' + video.error.code : ''} ${T.errs.slice(-3).join(',') || '无错误'}` +
          `｜挂载${g('MEDIA_ATTACHED')} 密钥${g('KEY_LOADING')}/${g('KEY_LOADED')} 解密${g('FRAG_DECRYPTED')} 音轨${g('AUDIO_TRACK_LOADING')}/${g('AUDIO_TRACK_LOADED')}(${(hls.audioTracks || []).length}) 初始化段${g('FRAG_PARSING_INIT_SEGMENT')} 解析数据${g('FRAG_PARSING_DATA')} 缓冲区${g('BUFFER_CREATED')}｜${T.last || '无分片'}｜${T.ts || ''}｜原生HLS:${video.canPlayType('application/vnd.apple.mpegurl') || '无'}`;
        dbg(msg);
        if (n === 1) {
          const full = msg + '\n\n' + plLog.map((p) => '# ' + p.url + '\n' + p.text).join('\n\n');
          copyText(full).then((ok) => toast(msg + (ok ? '\n（诊断信息和清单文本已复制，可直接粘贴发给我）' : ''), 10000));
        } else toast(msg, 9000);
        if (n < 2) setTimeout(() => report(n + 1), 18000);
      };
      setTimeout(() => report(1), 12000);
      hls.on(E.ERROR, (_, d) => {
        if (me.hls !== hls) return;
        if (d.details && !T.errs.includes(d.details)) T.errs.push(d.details);
        if (!d.fatal) {
          if (d.details === 'bufferAddCodecError' || d.details === 'bufferIncompatibleCodecsError') {
            spin.classList.remove('iosgp-show');
            toast('该流的编码当前 WebView 的 MSE 不支持（' + (d.mimeType || T.codecs || '未知编码') + '），hls.js 无法播放', 6000);
            return;
          }
          const k = d.details;
          if (k === 'fragParsingError' || k === 'bufferAppendError' || k === 'fragDecryptError' || k === 'fragLoadError' || k === 'levelLoadError') {
            nonFatal++;
            if (nonFatal === 3 || nonFatal === 12) toast('分片异常：' + k + (mode === 'gm' ? '（GM 返回的数据可能不可用，可在油猴菜单开启「调试提示」查看）' : ''), 4200);
          }
          return;
        }
        if (d.type === H.ErrorTypes.NETWORK_ERROR && retry++ < 3) { hls.startLoad(); return; }
        if (d.type === H.ErrorTypes.MEDIA_ERROR && retry++ < 3) { hls.recoverMediaError(); return; }
        if (!triedNative && video.canPlayType('application/vnd.apple.mpegurl')) { triedNative = true; destroyHls(); video.src = it.url; return; }
        spin.classList.remove('iosgp-show');
        const code = d.response && d.response.code != null ? ' ' + d.response.code : '';
        toast('播放失败：' + (d.details || d.type) + code + (mode === 'gm' ? '（GM）' : ''));
      });
    }

    async function load(it, resumeAt, autoplay) {
      if (it.type === 'hls') { const par = parentOf(it.url); if (par) it = par; } // 加载主清单，清晰度才能选
      const seq = ++loadSeq;
      destroyHls();
      me.current = it; startTime = resumeAt || 0; triedNative = false;
      spin.classList.add('iosgp-show');
      video.removeAttribute('src'); video.load();
      if (it.type !== 'hls') {
        video.src = it.url;
        if (autoplay) video.play().catch(() => {});
        return;
      }
      const H = await loadHls(); // hls.js 懒加载：真要播 HLS 时才加载
      if (seq !== loadSeq || me.closed) return;
      if (H && H.isSupported && H.isSupported()) {
        // 同源：原生；跨域（流地址或来源页与当前页面不同源）：直接 GM，不做探测、不做切换
        startHls(H, it, needGM(it) ? 'gm' : 'native');
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        triedNative = true; video.src = it.url;
      } else {
        spin.classList.remove('iosgp-show');
        toast(H ? '当前环境不支持 HLS 播放' : 'hls.js 加载失败（可能被页面 CSP 拦截）');
        return;
      }
      if (autoplay) video.play().catch(() => {});
    }

    /* ---- 联动 M3U8 下载器：让它的面板出现在悬浮窗正下方 ---- */
    let dlShown = false;
    function sendDl(type) {
      if (!document.documentElement.hasAttribute('data-m3u8dl')) return;
      if (type === 'reposition' && !dlShown) return;
      if (type === 'open') dlShown = true;
      if (type === 'close') dlShown = false;
      const r = host.getBoundingClientRect();
      try {
        window.dispatchEvent(new CustomEvent('m3u8dl:' + type, {
          detail: JSON.stringify({ url: me.current.url, top: Math.round(r.bottom + 8), left: Math.round(r.left), width: Math.round(r.width) })
        }));
      } catch (_) {}
    }

    /* ---- 关闭 ---- */
    function close(byUser) {
      if (me.closed) return;
      me.closed = true;
      clearTimeout(hideTimer); clearTimeout(toastTimer); clearTimeout(tapTimer); clearTimeout(lpTimer);
      cleanups.forEach((f) => f());
      ro.disconnect();
      destroyHls();
      teardownMediaSession();
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {}
      try { if (document.pictureInPictureElement === video) document.exitPictureInPicture(); } catch (_) {}
      try { if (isFs()) document.exitFullscreen(); } catch (_) {}
      try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (_) {}
      sendDl('close');
      host.remove();
      // 用户点 ✕：当前已识别的地址都不再自动悬浮（之后出现的新地址仍会）
      if (byUser) found.forEach((_, url) => dismissed.add(url));
      P = null;
      refreshBall();
    }
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(true); });
    for (const ev of ['keydown', 'keyup', 'keypress']) host.addEventListener(ev, (e) => e.stopPropagation());

    load(item, 0, !!opts.autoplay);
  }

  /* =========================================================
   * 8. 自动悬浮 + 手动入口小球
   * =======================================================*/
  const MIN_AUTO_SECONDS = 45; // 仅用于「无 HLS、只有一个直链文件」的情形：短于该时长不自动悬浮（手动点小球不受限）

  // 页面里已加载好的 <video> 的时长（不发任何请求），按地址取
  function loadedDuration(url) {
    for (const v of document.querySelectorAll('video')) {
      if (v.currentSrc === url && isFinite(v.duration) && v.duration > 0) return v.duration;
    }
    return null;
  }
  // 时长相差 2 秒内视为同一个视频（主清单 / 子清单 / <video> 重复嗅探到的是同一个），返回不同视频的个数
  function distinctCount(list) {
    let n = 0, last = -Infinity;
    list.slice().sort((x, y) => x - y).forEach((d) => { if (d - last > 2) n++; last = d; });
    return n;
  }

  // 解析主清单里的各清晰度子清单（地址 + 分辨率 + 码率）
  function parseVariants(text, base) {
    const out = [], lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!/^#EXT-X-STREAM-INF/.test(lines[i])) continue;
      const res = /RESOLUTION=(\d+)x(\d+)/i.exec(lines[i]), bw = /BANDWIDTH=(\d+)/i.exec(lines[i]);
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j].trim();
        if (l && l[0] !== '#') {
          try { out.push({ url: new URL(l, base).href, w: res ? +res[1] : 0, h: res ? +res[2] : 0, bw: bw ? +bw[1] : 0 }); } catch (_) {}
          break;
        }
      }
    }
    return out;
  }
  // 某个子清单属于哪个已识别的主清单（同一视频的不同清晰度，不该当成独立视频源）
  function parentOf(url) {
    for (const m of found.values()) {
      if (m.url !== url && m._variants && m._variants.some((v) => v.url === url)) return m;
    }
    return null;
  }
  const hasParent = (i) => i.type === 'hls' && !!parentOf(i.url);
  // 没有主清单、每个清晰度各一个地址时：从地址里认清晰度（1080p / 720 / 4k / hd ...）
  function urlQuality(url) {
    let d = url;
    try { d = decodeURIComponent(new URL(url).pathname); } catch (_) {}
    let m = /(?:^|[^a-z0-9])(2160|1440|1080|720|576|540|480|360|240)p?(?![a-z0-9])/i.exec(d);
    if (m) return { label: m[1] + 'p', h: +m[1] };
    m = /(?:^|[^a-z0-9])(4k|uhd|fhd|hd|sd|ld)(?![a-z0-9])/i.exec(d);
    if (m) { const map = { '4k': 2160, uhd: 2160, fhd: 1080, hd: 720, sd: 480, ld: 360 }; return { label: m[1].toUpperCase(), h: map[m[1].toLowerCase()] }; }
    return null;
  }

  function firstVariant(text, base) {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!/^#EXT-X-STREAM-INF/.test(lines[i])) continue;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j].trim();
        if (l && l[0] !== '#') { try { return new URL(l, base).href; } catch (_) { return null; } }
      }
    }
    return null;
  }
  function mediaDuration(text, url) {
    if (!/#EXT-X-ENDLIST/.test(text)) return null; // 直播 / 无结束标记：不算时长，也不缓存
    playlistCache.set(url, { text, t: Date.now() });
    let sum = 0;
    text.replace(/#EXTINF:([\d.]+)/g, (_, n) => { sum += parseFloat(n) || 0; return ''; });
    return sum > 0 ? sum : null;
  }
  // 只拉播放列表文本自己解析（不依赖 hls.js），并把拿到的文本缓存给后续播放复用
  async function probeHls(it) {
    const gm = needGM(it);
    const text = await fetchText(it.url, it.ref, gm);
    if (!text || !/^\s*#EXTM3U/.test(text)) return null;
    playlistCache.set(it.url, { text, t: Date.now() });
    if (/#EXT-X-STREAM-INF/.test(text)) {
      it._variants = parseVariants(text, it.url); // 记下这是主清单，以及它有哪些清晰度
      const sub = firstVariant(text, it.url);
      if (!sub) return null;
      const t2 = await fetchText(sub, it.ref, gm);
      if (!t2 || !/^\s*#EXTM3U/.test(t2)) return null;
      return mediaDuration(t2, sub);
    }
    return mediaDuration(text, it.url);
  }
  // 探测时长（仅 HLS：只拉播放列表，用来给主清单 / 子清单去重）。直链文件不探测。结果缓存在条目上，拿不到为 null
  function probeDuration(it) {
    if (it._dur !== undefined) return Promise.resolve(it._dur);
    if (it.type !== 'hls') return Promise.resolve((it._dur = null));
    for (const v of document.querySelectorAll('video')) {
      if (v.currentSrc === it.url && isFinite(v.duration) && v.duration > 0) return Promise.resolve((it._dur = v.duration));
    }
    if (it._probe) return it._probe;
    it._probe = (async () => {
      let d = null;
      try {
        d = await Promise.race([
          probeHls(it),
          new Promise((r) => setTimeout(() => r(null), 7000))
        ]);
      } catch (_) {}
      if (it._dur === undefined) it._dur = d;
      return it._dur;
    })();
    return it._probe;
  }

  let autoTimer = 0, autoProbing = false;
  async function autoDecide() {
    if (!autoFloat || P) return;
    const hlsList = () => [...found.values()].filter((i) => i.type === 'hls' && !dismissed.has(i.url)).sort((x, y) => y.t - x.t);
    let list = hlsList();

    // 1) 页面上只有一个 HLS：不管旁边有多少直链文件（多半是预览页的动态短视频），直接弹这个 HLS
    if (list.length === 1) { openPlayer(list[0], { autoplay: false }); return; }

    // 2) 多个 HLS：可能是同一个视频的主清单 / 子清单，探测时长去重（文件源不探测）；去重后仍只有一个才弹
    if (list.length > 1) {
      await Promise.all(list.slice(0, 6).map(probeDuration));
      if (!autoFloat || P) return;
      list = hlsList().filter((i) => !hasParent(i)); // 主清单的子清单不算独立视频
      const known = list.filter((i) => i._dur != null).map((i) => i._dur);
      const unknown = list.length - known.length; // 直播 / 探测失败 / 没探测的，各算一个
      if (list.length && distinctCount(known) + unknown === 1) openPlayer(list[0], { autoplay: false });
      return;
    }

    // 3) 没有 HLS：只有一个直链文件，且页面里该 <video> 已经加载出 ≥45 秒的时长才弹；
    //    其余情况（多个文件 / 时长未知 / 短视频）不打扰，交给用户点小球
    const files = [...found.values()].filter((i) => !dismissed.has(i.url));
    if (files.length === 1) {
      const d = loadedDuration(files[0].url);
      if (d != null && d >= MIN_AUTO_SECONDS) openPlayer(files[0], { autoplay: false });
    }
  }
  function maybeAutoOpen() {
    if (!IS_TOP || !autoFloat || P) return;
    clearTimeout(autoTimer);
    // 稍作防抖：同一页面常常连续冒出好几个地址，等一下再统一判断
    autoTimer = setTimeout(async () => {
      if (!autoFloat || P) return;
      if (!document.body) { maybeAutoOpen(); return; }
      if (autoProbing) return;
      autoProbing = true;
      try { await autoDecide(); } catch (_) {}
      autoProbing = false;
    }, 500);
  }

  let ball = null, ballBadge = null;
  function ensureBall() {
    if (ball || !IS_TOP || !document.body) return;
    ball = document.createElement('div');
    ball.setAttribute('data-mf-float-ball', '');
    ball.style.cssText = 'position:fixed;left:8px;bottom:140px;width:38px;height:38px;border-radius:50%;display:none;align-items:center;justify-content:center;' +
      'z-index:2147483644;background:rgba(20,20,30,.78);color:#fff;cursor:pointer;user-select:none;touch-action:none;' +
      'border:1px solid rgba(255,255,255,.28);' +
      'box-shadow:0 4px 18px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.18);-webkit-tap-highlight-color:transparent;outline:none';
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
    ballBadge.textContent = String([...found.values()].filter((i) => !hasParent(i)).length || found.size);
  }

  // 单个直链文件的时长要等 <video> 元数据加载出来才知道：加载完再判断一次
  document.addEventListener('loadedmetadata', (e) => { if (e.target && e.target.tagName === 'VIDEO' && !P) maybeAutoOpen(); }, true);

  registerMenu();
  const initialScan = () => { scanAll(); refreshBall(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialScan); else initialScan();
  window.addEventListener('load', initialScan);
})();
