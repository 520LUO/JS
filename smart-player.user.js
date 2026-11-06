// ==UserScript==
// @name         智能媒体播放器 (独立全屏播放界面)
// @namespace    https://github.com/520luo/js/smart-player
// @version      26.11.06.1
// @description  智能识别网页里的 M3U8 / MP4 / WebM 视频，一键用独立的全屏播放器打开：手势快进/亮度/音量、长按倍速、清晰度、画中画、多源切换
// @icon         https://raw.githubusercontent.com/520LUO/icons/refs/heads/main/M3U8.png
// @author       520LUO
// @match        *://*/*
// @grant        none
// @run-at       document-start
// @require      https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const IS_TOP = window.top === window.self;
    const MSG = '__mf_smart_player__';
    const MAX_ITEMS = 12;
    const AD_RE = /(doubleclick|googlesyndication|googleadservices|adservice|adsystem|[\/_.\-]ads?[\/_.\-]|preroll|\/vast|beacon|tracking)/i;

    // ========== 视频识别 ==========
    const found = new Map(); // url -> { url, type, from, ref, t }

    function typeOf(url) {
        let p;
        try { p = new URL(url).pathname.toLowerCase(); } catch (_) { return null; }
        if (/\.m3u8$/.test(p)) return 'hls';
        if (/\.(mp4|m4v|webm|mov|ogv)$/.test(p)) return 'file';
        return null;
    }

    function addFound(raw, from, ref) {
        let url;
        try { url = new URL(raw, location.href).href; } catch (_) { return; }
        if (!/^https?:/i.test(url)) return;
        const type = typeOf(url);
        if (!type || AD_RE.test(url)) return;
        if (!IS_TOP) {
            // 子 iframe：把识别结果交给顶层页面统一展示
            try { window.top.postMessage({ [MSG]: 1, url, from, ref: location.href }, '*'); } catch (_) {}
            return;
        }
        const old = found.get(url);
        if (old) { old.t = Date.now(); return; }
        found.set(url, { url, type, from, ref: ref || location.href, t: Date.now() });
        if (found.size > MAX_ITEMS) {
            const oldest = [...found.values()].sort((a, b) => a.t - b.t)[0];
            found.delete(oldest.url);
        }
        refreshBall();
    }

    function scanVideo(v) {
        try {
            const s = v.currentSrc || v.src;
            if (s && !s.startsWith('blob:')) addFound(s, 'video');
            v.querySelectorAll('source[src]').forEach(x => addFound(x.src, 'source'));
        } catch (_) {}
    }

    // 网络层嗅探：fetch / XHR / Resource Timing
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
        const po = new PerformanceObserver(list => {
            for (const e of list.getEntries()) {
                // 几百 KB 以下的 mp4 多半是广告 / 预览小片，跳过
                if (typeOf(e.name) === 'file' && e.encodedBodySize > 0 && e.encodedBodySize < 300 * 1024) continue;
                addFound(e.name, 'net');
            }
        });
        po.observe({ type: 'resource', buffered: true });
    } catch (_) {}

    document.addEventListener('loadstart', e => { if (e.target && e.target.tagName === 'VIDEO') scanVideo(e.target); }, true);
    document.addEventListener('playing', e => { if (e.target && e.target.tagName === 'VIDEO') scanVideo(e.target); }, true);

    if (IS_TOP) {
        window.addEventListener('message', e => {
            const d = e.data;
            if (d && d[MSG] === 1 && typeof d.url === 'string') addFound(d.url, d.from || 'frame', d.ref);
        });
    }

    // 最可能是“正在看的那个视频”：正在播放的优先，其次最近出现的 M3U8，再次最近的文件
    function pickBest() {
        const list = [...found.values()];
        if (!list.length) return null;
        const pv = [...document.querySelectorAll('video')].find(v => !v.paused && v.currentSrc);
        if (pv && found.has(pv.currentSrc)) return found.get(pv.currentSrc);
        const byTime = list.sort((a, b) => b.t - a.t);
        return byTime.find(i => i.type === 'hls') || byTime[0];
    }

    function pageTitle() {
        const og = document.querySelector('meta[property="og:title"]');
        const t = (og && og.content) || document.title || '';
        return t.replace(/\s+/g, ' ').trim() || location.hostname;
    }

    function shortName(url) {
        try {
            const u = new URL(url);
            const tail = u.pathname.split('/').filter(Boolean).slice(-2).join('/');
            return `${u.hostname}/${tail}`;
        } catch (_) { return url; }
    }

    // ========== 悬浮入口 ==========
    let ball = null, ballBadge = null, playerOpen = false;

    function ensureBall() {
        if (ball || !IS_TOP || !document.body) return;
        ball = document.createElement('div');
        ball.setAttribute('data-mf-player-ball', '');
        ball.style.cssText = [
            'position:fixed', 'left:8px', 'bottom:140px', 'width:38px', 'height:38px', 'border-radius:50%',
            'display:none', 'align-items:center', 'justify-content:center', 'z-index:2147483644',
            'background:rgba(20,20,30,.65)', 'color:#fff', 'cursor:pointer', 'user-select:none',
            '-webkit-backdrop-filter:blur(16px) saturate(180%)', 'backdrop-filter:blur(16px) saturate(180%)',
            'border:1px solid rgba(255,255,255,.28)', 'box-shadow:0 4px 18px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.18)',
            'touch-action:none'
        ].join(';');
        ball.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
            '<span style="position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:#30d158;color:#fff;font:600 10px/16px system-ui,sans-serif;text-align:center"></span>';
        ballBadge = ball.querySelector('span');
        document.body.appendChild(ball);

        let dragging = false, moved = false, sy = 0, sTop = 0;
        ball.addEventListener('pointerdown', e => {
            dragging = true; moved = false; sy = e.clientY; sTop = ball.getBoundingClientRect().top;
            ball.setPointerCapture(e.pointerId);
        });
        ball.addEventListener('pointermove', e => {
            if (!dragging) return;
            const dy = e.clientY - sy;
            if (Math.abs(dy) > 6) moved = true;
            if (moved) {
                ball.style.bottom = 'auto';
                ball.style.top = Math.max(0, Math.min(sTop + dy, innerHeight - 38)) + 'px';
            }
        });
        ball.addEventListener('pointerup', () => {
            const wasDrag = moved; dragging = false;
            if (!wasDrag) openPlayer(pickBest());
        });
    }

    function refreshBall() {
        if (!IS_TOP) return;
        if (!document.body) { document.addEventListener('DOMContentLoaded', refreshBall, { once: true }); return; }
        ensureBall();
        if (!ball) return;
        ball.style.display = (found.size && !playerOpen) ? 'flex' : 'none';
        ballBadge.textContent = String(found.size);
    }

    // ========== 播放器 ==========
    const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

    const PLAYER_CSS = `
        :host { all: initial; }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        .root { position: fixed; inset: 0; width: 100vw; height: 100dvh; background: #000; color: #fff;
            font-family: system-ui, -apple-system, sans-serif; overflow: hidden; user-select: none; -webkit-user-select: none;
            touch-action: none; outline: none; }
        video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
        .dim { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; }
        .gesture { position: absolute; inset: 0; touch-action: none; }
        .bar-top, .bar-bottom { position: absolute; left: 0; right: 0; padding: 10px 14px; display: flex; align-items: center; gap: 10px;
            transition: opacity .25s, transform .25s; }
        .bar-top { top: 0; padding-top: max(10px, env(safe-area-inset-top)); background: linear-gradient(rgba(0,0,0,.7), transparent); }
        .bar-bottom { bottom: 0; padding-bottom: max(10px, env(safe-area-inset-bottom)); flex-direction: column; align-items: stretch;
            background: linear-gradient(transparent, rgba(0,0,0,.75)); }
        .hidden .bar-top { opacity: 0; transform: translateY(-12px); pointer-events: none; }
        .hidden .bar-bottom { opacity: 0; transform: translateY(12px); pointer-events: none; }
        .title { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .btn { appearance: none; border: 0; background: rgba(255,255,255,.12); color: #fff; border-radius: 18px; min-width: 36px; height: 36px;
            padding: 0 12px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center;
            cursor: pointer; font-family: inherit; }
        .btn:active { background: rgba(255,255,255,.28); }
        .btn svg { width: 18px; height: 18px; fill: currentColor; }
        .row { display: flex; align-items: center; gap: 8px; }
        .row.spread { justify-content: space-between; }
        .time { font-size: 12px; font-variant-numeric: tabular-nums; opacity: .9; min-width: 44px; text-align: center; }
        .seek { position: relative; flex: 1; height: 28px; display: flex; align-items: center; touch-action: none; }
        .seek .track { position: relative; width: 100%; height: 4px; border-radius: 2px; background: rgba(255,255,255,.22); }
        .seek .buf, .seek .cur { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; }
        .seek .buf { background: rgba(255,255,255,.35); width: 0; }
        .seek .cur { background: #0a84ff; width: 0; }
        .seek .thumb { position: absolute; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: #fff; left: 0; }
        .center { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); pointer-events: none;
            display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .hud { display: none; padding: 10px 16px; border-radius: 12px; background: rgba(20,20,30,.72); font-size: 15px; font-weight: 600;
            -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
        .hud.show { display: block; }
        .spin { display: none; width: 38px; height: 38px; border-radius: 50%; border: 3px solid rgba(255,255,255,.25); border-top-color: #fff;
            animation: spin .8s linear infinite; }
        .spin.show { display: block; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .menu { position: absolute; right: 14px; bottom: 86px; max-height: 60vh; min-width: 150px; max-width: min(86vw, 420px); overflow-y: auto; padding: 6px;
            border-radius: 14px; background: rgba(28,28,34,.92); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px);
            border: 1px solid rgba(255,255,255,.14); display: none; }
        .menu.show { display: block; }
        .menu .item { padding: 10px 12px; border-radius: 9px; font-size: 13px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .menu .item.on { background: #0a84ff; }
        .menu .item:active { background: rgba(255,255,255,.18); }
        .toast { position: absolute; left: 50%; top: 18%; transform: translateX(-50%); padding: 8px 14px; border-radius: 12px; font-size: 13px;
            background: rgba(20,20,30,.8); display: none; max-width: 86vw; text-align: center; }
        .toast.show { display: block; }
    `;

    const ICON = {
        play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
        pause: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
        close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>',
        vol: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>',
        mute: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9H3z"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
        pip: '<svg viewBox="0 0 24 24"><path d="M19 7h-8v6h8V7zm2-4H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H3V5h18v14z"/></svg>',
        full: '<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>'
    };

    let P = null; // 当前播放器实例

    function fmt(s) {
        if (!isFinite(s) || s < 0) s = 0;
        s = Math.floor(s);
        const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
        const p = n => String(n).padStart(2, '0');
        return h ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
    }

    function openPlayer(item) {
        if (!item || P) return;
        // 记下页面里正在播放的视频进度并暂停，避免两边同时出声
        let startAt = 0;
        document.querySelectorAll('video').forEach(v => {
            try {
                if (!v.paused) { if (!startAt && found.has(v.currentSrc) && v.currentSrc === item.url) startAt = v.currentTime; v.pause(); }
            } catch (_) {}
        });

        const host = document.createElement('div');
        host.setAttribute('data-mf-player', '');
        host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `
            <style>${PLAYER_CSS}</style>
            <div class="root" tabindex="0">
                <video playsinline webkit-playsinline preload="auto"></video>
                <div class="dim"></div>
                <div class="gesture"></div>
                <div class="center"><div class="spin"></div><div class="hud"></div></div>
                <div class="toast"></div>
                <div class="bar-top">
                    <button class="btn" data-a="close">${ICON.close}</button>
                    <div class="title"></div>
                    <button class="btn" data-a="src">源</button>
                    <button class="btn" data-a="pip">${ICON.pip}</button>
                </div>
                <div class="bar-bottom">
                    <div class="row">
                        <span class="time cur-time">00:00</span>
                        <div class="seek"><div class="track"><div class="buf"></div><div class="cur"></div><div class="thumb"></div></div></div>
                        <span class="time dur-time">00:00</span>
                    </div>
                    <div class="row spread">
                        <div class="row">
                            <button class="btn" data-a="toggle">${ICON.pause}</button>
                            <button class="btn" data-a="mute">${ICON.vol}</button>
                        </div>
                        <div class="row">
                            <button class="btn" data-a="quality" style="display:none">自动</button>
                            <button class="btn" data-a="speed">1x</button>
                            <button class="btn" data-a="full">${ICON.full}</button>
                        </div>
                    </div>
                </div>
                <div class="menu"></div>
            </div>`;

        const $ = s => root.querySelector(s);
        const rootEl = $('.root'), video = $('video'), dim = $('.dim'), gesture = $('.gesture');
        const hud = $('.hud'), spin = $('.spin'), toastEl = $('.toast'), menu = $('.menu');
        const seek = $('.seek'), bufEl = $('.buf'), curEl = $('.cur'), thumb = $('.thumb');
        const curTime = $('.cur-time'), durTime = $('.dur-time');
        const btnToggle = $('[data-a="toggle"]'), btnMute = $('[data-a="mute"]');
        const btnQuality = $('[data-a="quality"]'), btnSpeed = $('[data-a="speed"]');
        $('.title').textContent = pageTitle();

        P = { host, video, hls: null, current: item, closing: false };
        playerOpen = true;
        refreshBall();

        const lockScroll = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        document.documentElement.appendChild(host);
        rootEl.focus({ preventScroll: true });

        // 返回键关闭播放器，而不是离开页面
        let pushed = false;
        try { history.pushState({ mfPlayer: 1 }, ''); pushed = true; } catch (_) {}
        const onPop = () => { pushed = false; close(); };
        window.addEventListener('popstate', onPop);

        // ---------- 小工具 ----------
        let toastTimer = 0, hudTimer = 0, hideTimer = 0;
        const toast = msg => { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200); };
        const showHud = (msg, keep) => { hud.textContent = msg; hud.classList.add('show'); clearTimeout(hudTimer); if (!keep) hudTimer = setTimeout(() => hud.classList.remove('show'), 700); };
        const hideHud = () => { clearTimeout(hudTimer); hud.classList.remove('show'); };
        const wake = () => {
            rootEl.classList.remove('hidden');
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => { if (!video.paused && !menu.classList.contains('show')) rootEl.classList.add('hidden'); }, 3500);
        };
        const closeMenu = () => menu.classList.remove('show');
        const openMenu = (items, onPick) => {
            menu.innerHTML = '';
            items.forEach(it => {
                const d = document.createElement('div');
                d.className = 'item' + (it.on ? ' on' : '');
                d.textContent = it.label;
                d.addEventListener('click', e => { e.stopPropagation(); closeMenu(); onPick(it.value); wake(); });
                menu.appendChild(d);
            });
            menu.classList.add('show');
        };

        // ---------- 加载 ----------
        let startTime = startAt, triedNative = false;
        function destroyHls() { if (P.hls) { try { P.hls.destroy(); } catch (_) {} P.hls = null; } }

        function load(it, resumeAt) {
            destroyHls();
            P.current = it;
            startTime = resumeAt || 0;
            triedNative = false;
            btnQuality.style.display = 'none';
            spin.classList.add('show');
            video.removeAttribute('src');
            video.load();
            const useNative = () => { triedNative = true; destroyHls(); video.src = it.url; };
            if (it.type === 'hls') {
                const H = window.Hls;
                if (H && H.isSupported && H.isSupported()) {
                    const hls = new H({ enableWorker: true, maxBufferLength: 40, lowLatencyMode: false });
                    P.hls = hls;
                    hls.loadSource(it.url);
                    hls.attachMedia(video);
                    hls.on(H.Events.MANIFEST_PARSED, () => {
                        if (hls.levels && hls.levels.length > 1) { btnQuality.style.display = ''; btnQuality.textContent = '自动'; }
                    });
                    let netRetry = 0;
                    hls.on(H.Events.ERROR, (_, d) => {
                        if (!d.fatal) return;
                        if (d.type === H.ErrorTypes.NETWORK_ERROR && netRetry++ < 3) { hls.startLoad(); return; }
                        if (d.type === H.ErrorTypes.MEDIA_ERROR && netRetry++ < 3) { hls.recoverMediaError(); return; }
                        if (!triedNative && video.canPlayType('application/vnd.apple.mpegurl')) { useNative(); return; }
                        spin.classList.remove('show');
                        toast('播放失败：' + (d.details || d.type) + '，可点「源」换一个');
                    });
                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    useNative();
                } else {
                    spin.classList.remove('show');
                    toast('当前环境不支持 HLS 播放');
                    return;
                }
            } else {
                video.src = it.url;
            }
            video.play().catch(() => {});
        }

        // ---------- 视频事件 ----------
        function updateProgress() {
            const d = video.duration, t = video.currentTime;
            curTime.textContent = fmt(t);
            durTime.textContent = isFinite(d) ? fmt(d) : '直播';
            const pct = isFinite(d) && d > 0 ? Math.min(100, t / d * 100) : 0;
            curEl.style.width = pct + '%'; thumb.style.left = pct + '%';
            try {
                const b = video.buffered;
                if (b.length && isFinite(d) && d > 0) bufEl.style.width = Math.min(100, b.end(b.length - 1) / d * 100) + '%';
            } catch (_) {}
        }
        video.addEventListener('timeupdate', () => { if (!seeking) updateProgress(); });
        video.addEventListener('progress', updateProgress);
        video.addEventListener('durationchange', updateProgress);
        video.addEventListener('loadedmetadata', () => {
            if (startTime > 1 && isFinite(video.duration) && startTime < video.duration - 2) video.currentTime = startTime;
            startTime = 0;
        });
        video.addEventListener('waiting', () => spin.classList.add('show'));
        for (const ev of ['playing', 'canplay', 'seeked']) video.addEventListener(ev, () => spin.classList.remove('show'));
        video.addEventListener('play', () => { btnToggle.innerHTML = ICON.pause; wake(); });
        video.addEventListener('pause', () => { btnToggle.innerHTML = ICON.play; rootEl.classList.remove('hidden'); });
        video.addEventListener('volumechange', () => { btnMute.innerHTML = (video.muted || video.volume === 0) ? ICON.mute : ICON.vol; });
        video.addEventListener('error', () => {
            if (P.hls) return; // hls.js 自己处理
            spin.classList.remove('show');
            toast('视频加载失败，可点「源」换一个');
        });

        // ---------- 进度条拖动 ----------
        let seeking = false;
        const seekTo = e => {
            const r = seek.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            if (isFinite(video.duration)) {
                const t = ratio * video.duration;
                curTime.textContent = fmt(t);
                curEl.style.width = ratio * 100 + '%'; thumb.style.left = ratio * 100 + '%';
                return t;
            }
            return null;
        };
        let seekTarget = null;
        seek.addEventListener('pointerdown', e => { seeking = true; seek.setPointerCapture(e.pointerId); seekTarget = seekTo(e); clearTimeout(hideTimer); e.stopPropagation(); });
        seek.addEventListener('pointermove', e => { if (seeking) seekTarget = seekTo(e); });
        const endSeek = () => { if (!seeking) return; seeking = false; if (seekTarget != null) video.currentTime = seekTarget; seekTarget = null; wake(); };
        seek.addEventListener('pointerup', endSeek);
        seek.addEventListener('pointercancel', endSeek);

        // ---------- 手势 ----------
        let brightness = 1, startVol = 1, startBright = 1;
        const setBright = v => { brightness = Math.max(0.2, Math.min(1, v)); dim.style.opacity = String(1 - brightness); };
        let g = null, lastTap = { t: 0, x: 0 }, singleTimer = 0, longTimer = 0, savedRate = 1, longActive = false;

        gesture.addEventListener('pointerdown', e => {
            closeMenu();
            gesture.setPointerCapture(e.pointerId);
            g = { x: e.clientX, y: e.clientY, mode: null, w: rootEl.clientWidth, h: rootEl.clientHeight, base: video.currentTime, delta: 0 };
            startVol = video.volume; startBright = brightness;
            longActive = false;
            clearTimeout(longTimer);
            longTimer = setTimeout(() => {
                if (g && !g.mode) { longActive = true; savedRate = video.playbackRate; video.playbackRate = 2; showHud('2x 倍速播放中', true); }
            }, 450);
        });
        gesture.addEventListener('pointermove', e => {
            if (!g) return;
            const dx = e.clientX - g.x, dy = e.clientY - g.y;
            if (!g.mode) {
                if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
                clearTimeout(longTimer);
                g.mode = Math.abs(dx) > Math.abs(dy) ? 'seek' : (g.x < g.w / 2 ? 'bright' : 'vol');
            }
            if (g.mode === 'seek' && isFinite(video.duration)) {
                g.delta = dx / g.w * Math.min(video.duration, 180);
                const t = Math.max(0, Math.min(video.duration, g.base + g.delta));
                showHud(`${g.delta >= 0 ? '+' : '−'}${Math.abs(Math.round(g.delta))}s   ${fmt(t)} / ${fmt(video.duration)}`, true);
            } else if (g.mode === 'bright') {
                setBright(startBright - dy / g.h * 1.2);
                showHud(`亮度 ${Math.round((brightness - 0.2) / 0.8 * 100)}%`);
            } else if (g.mode === 'vol') {
                video.muted = false;
                video.volume = Math.max(0, Math.min(1, startVol - dy / g.h * 1.2));
                showHud(`音量 ${Math.round(video.volume * 100)}%`);
            }
        });
        const endGesture = e => {
            if (!g) return;
            clearTimeout(longTimer);
            const cur = g; g = null;
            if (longActive) { video.playbackRate = savedRate; hideHud(); longActive = false; return; }
            if (cur.mode === 'seek') {
                if (isFinite(video.duration)) video.currentTime = Math.max(0, Math.min(video.duration, cur.base + cur.delta));
                hideHud(); wake(); return;
            }
            if (cur.mode) { wake(); return; }
            // 点按：单击显隐控制栏，双击快进 / 快退 / 暂停
            const now = Date.now(), x = e.clientX, w = cur.w;
            if (now - lastTap.t < 300 && Math.abs(x - lastTap.x) < 80) {
                clearTimeout(singleTimer); lastTap.t = 0;
                if (x < w / 3) { video.currentTime = Math.max(0, video.currentTime - 10); showHud('−10s'); }
                else if (x > w * 2 / 3) { video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 10); showHud('+10s'); }
                else toggle();
                wake();
            } else {
                lastTap = { t: now, x };
                singleTimer = setTimeout(() => {
                    if (rootEl.classList.contains('hidden')) wake();
                    else rootEl.classList.add('hidden');
                }, 280);
            }
        };
        gesture.addEventListener('pointerup', endGesture);
        gesture.addEventListener('pointercancel', endGesture);

        // ---------- 按钮 ----------
        function toggle() { if (video.paused) video.play().catch(() => {}); else video.pause(); }

        function close() {
            if (P.closing) return;
            P.closing = true;
            window.removeEventListener('popstate', onPop);
            clearTimeout(hideTimer); clearTimeout(toastTimer); clearTimeout(hudTimer); clearTimeout(singleTimer); clearTimeout(longTimer);
            destroyHls();
            try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {}
            try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {}
            try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (_) {}
            host.remove();
            document.documentElement.style.overflow = lockScroll;
            if (pushed) { pushed = false; try { history.back(); } catch (_) {} }
            P = null; playerOpen = false;
            refreshBall();
        }

        root.addEventListener('click', e => {
            const btn = e.target.closest && e.target.closest('[data-a]');
            if (!btn) return;
            e.stopPropagation();
            const a = btn.dataset.a;
            if (a === 'close') close();
            else if (a === 'toggle') { toggle(); wake(); }
            else if (a === 'mute') { video.muted = !video.muted; wake(); }
            else if (a === 'speed') {
                openMenu(SPEEDS.map(s => ({ label: s + 'x', value: s, on: video.playbackRate === s })), v => { video.playbackRate = v; btnSpeed.textContent = v + 'x'; });
            } else if (a === 'quality' && P.hls) {
                const hls = P.hls;
                const items = [{ label: '自动', value: -1, on: hls.autoLevelEnabled }];
                hls.levels.forEach((l, i) => items.push({ label: (l.height ? l.height + 'p' : Math.round((l.bitrate || 0) / 1000) + 'kbps'), value: i, on: !hls.autoLevelEnabled && hls.currentLevel === i }));
                items.sort((a, b) => (a.value === -1 ? -1 : b.value === -1 ? 1 : b.value - a.value));
                openMenu(items, v => { hls.currentLevel = v; btnQuality.textContent = v === -1 ? '自动' : items.find(i => i.value === v).label; });
            } else if (a === 'src') {
                const list = [...found.values()].sort((a, b) => b.t - a.t);
                openMenu(list.map(i => ({ label: (i.type === 'hls' ? 'HLS · ' : '文件 · ') + shortName(i.url), value: i, on: i.url === P.current.url })),
                    it => { if (it.url !== P.current.url) load(it, video.currentTime); });
            } else if (a === 'pip') {
                if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
                else if (video.requestPictureInPicture) video.requestPictureInPicture().catch(() => toast('当前环境不支持画中画'));
                else toast('当前环境不支持画中画');
            } else if (a === 'full') {
                if (document.fullscreenElement) {
                    document.exitFullscreen().catch(() => {});
                    try { screen.orientation.unlock(); } catch (_) {}
                } else {
                    (host.requestFullscreen ? host.requestFullscreen() : Promise.reject()).then(() => {
                        try { screen.orientation.lock('landscape').catch(() => {}); } catch (_) {}
                    }).catch(() => toast('无法进入全屏'));
                }
            }
        });
        // 阻止页面自己的快捷键 / 点击穿透
        for (const ev of ['keydown', 'keyup', 'keypress']) host.addEventListener(ev, e => e.stopPropagation());
        rootEl.addEventListener('keydown', e => {
            if (e.key === ' ') { toggle(); e.preventDefault(); }
            else if (e.key === 'ArrowLeft') video.currentTime -= 5;
            else if (e.key === 'ArrowRight') video.currentTime += 5;
            else if (e.key === 'Escape') close();
        });
        rootEl.addEventListener('pointermove', () => { if (!g) wake(); });

        load(item, startAt);
        wake();
    }

    // 初始扫描
    function initialScan() {
        document.querySelectorAll('video').forEach(scanVideo);
        refreshBall();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialScan);
    else initialScan();
    window.addEventListener('load', initialScan);
})();
