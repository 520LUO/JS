// ==UserScript==
// @name         M3U8媒体下载器 (支持AES-128解密)
// @namespace    https://github.com/520luo/js/m3u8-downloader
// @version      26.11.06.3
// @description  智能嗅探链接,多线程下载,智能模式,大文件边下边存,小文件内存高速下载,支持解密AES-128,精美的UI
// @icon         https://raw.githubusercontent.com/520LUO/icons/refs/heads/main/M3U8.png
// @author       520LUO
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      *
// @run-at       document-idle
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/584352/M3U8%E5%AA%92%E4%BD%93%E4%B8%8B%E8%BD%BD%E5%99%A8%20%28%E6%94%AF%E6%8C%81AES-128%E8%A7%A3%E5%AF%86%29.user.js
// @updateURL https://update.greasyfork.org/scripts/584352/M3U8%E5%AA%92%E4%BD%93%E4%B8%8B%E8%BD%BD%E5%99%A8%20%28%E6%94%AF%E6%8C%81AES-128%E8%A7%A3%E5%AF%86%29.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // ========== 常量配置 ==========
    const CONCURRENCY_OPTIONS = [8, 16, 32, 64];
    const MAX_RETRIES = 3;
    const FINAL_RETRY_ROUNDS = 2;
    const REQUEST_TIMEOUT = 10000;
    const SIZE_THRESHOLD = 800 * 1024 * 1024;
    const ESTIMATED_BITRATE = 1.5 * 1024 * 1024;
    const BALL_SIZE = 36;

    let savedDirHandle = null;
    let currentDownload = null;

    // 自动嗅探默认开启；用户的开关选择通过油猴存储持久化，刷新页面后仍然保留
    const SNIFF_SETTING_KEY = 'm3u8_auto_sniff_enabled';
    let sniffEnabled = true;
    try {
        if (typeof GM_getValue === 'function') {
            sniffEnabled = GM_getValue(SNIFF_SETTING_KEY, true) !== false;
        }
    } catch (_) {
        sniffEnabled = true;
    }
    const filenameCounts = new Map();
    let menuCommandIds = [];

    // ========== UI 样式 ==========
    const CSS = `
        #m3u8-drag-ball {
            position: fixed; width: ${BALL_SIZE}px; height: ${BALL_SIZE}px; border-radius: 50%;
            background: rgba(20,20,30,0.65);
            backdrop-filter: blur(16px) saturate(180%); -webkit-backdrop-filter: blur(16px) saturate(180%);
            border: 1px solid rgba(255,255,255,0.28);
            box-shadow: 0 4px 18px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.18), 0 0 10px rgba(255,255,255,0.15);
            cursor: grab; display: none; align-items: center; justify-content: center;
            color: #fff; font-size: 18px; z-index: 2147483646; user-select: none;
            touch-action: none; transition: box-shadow 0.2s, transform 0.15s; transform: scale(1);
        }
        #m3u8-drag-ball:active { cursor: grabbing; transform: scale(0.92); }
        #m3u8-drag-ball:hover {
            box-shadow: 0 6px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.22), 0 0 18px rgba(255,255,255,0.3);
        }
        #m3u8-drag-ball::after {
            content: ''; position: absolute; top: 0; right: 0; width: 8px; height: 8px;
            border-radius: 50%; background: transparent; transition: background 0.2s;
        }
        #m3u8-drag-ball.has-url::after { background: #30d158; }
        #m3u8-drag-ball.done::after { background: #007aff; }
        #m3u8-drag-ball.error::after { background: #ff3b30; }

        .m3u8-panel {
            position: fixed; width: clamp(340px, 35vw, 560px); max-height: 70vh; overflow-y: auto;
            background: rgba(20,20,30,0.75); backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%);
            border: 1px solid rgba(255,255,255,0.22); border-radius: 18px; padding: 16px;
            box-shadow: 0 14px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15);
            color: #fff; font-family: system-ui, -apple-system, sans-serif;
            opacity: 0; pointer-events: none; transform: translateY(6px) scale(0.96);
            transition: opacity 0.2s ease, transform 0.25s cubic-bezier(.34,1.56,.64,1); z-index: 2147483645;
        }
        .m3u8-panel.open { opacity: 1; pointer-events: auto; transform: translateY(0) scale(1); }
        .m3u8-panel::-webkit-scrollbar { width: 4px; }
        .m3u8-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }

        .input-group {
            display: flex; align-items: stretch; margin-bottom: 10px; border-radius: 10px; overflow: hidden;
            border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.05);
        }
        .input-icon {
            width: 38px; display: flex; align-items: center; justify-content: center;
            color: rgba(255,255,255,0.6); flex-shrink: 0; border-right: 1px solid rgba(255,255,255,0.1);
            cursor: pointer; transition: all 0.15s;
        }
        .input-icon-right { border-right: none; border-left: 1px solid rgba(255,255,255,0.1); }
        .input-icon:hover { background: rgba(255,255,255,0.1); color: #fff; }
        .input-icon:active { transform: scale(0.92); }
        .input-icon.copied { background: rgba(0,122,255,0.3); color: #fff; }
        .input-icon svg { width: 16px; height: 16px; stroke: currentColor; }
        .m3u8-input {
            flex: 1; padding: 10px 12px; border: none; background: transparent;
            color: #fff; font-size: 13px; outline: none; box-sizing: border-box; min-width: 0;
        }
        .m3u8-input::placeholder { color: rgba(255,255,255,0.4); }
        .input-group:focus-within { border-color: rgba(255,255,255,0.35); background: rgba(255,255,255,0.08); }

        .thread-row {
            display: flex; align-items: center; gap: 6px; margin-bottom: 12px; padding-bottom: 10px;
            border-bottom: 1px solid rgba(255,255,255,0.15);
        }
        .thread-label { font-size: 12px; opacity: 0.8; margin-right: 4px; }
        .thread-chip {
            background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.25); border-radius: 8px;
            padding: 4px 10px; font-size: 12px; font-weight: 600; color: #fff; cursor: pointer; transition: all 0.15s;
        }
        .thread-chip:hover { background: rgba(255,255,255,0.2); }
        .thread-chip.active { background: #007aff; border-color: #007aff; color: #fff; }

        .ios-glass-btn {
            appearance: none; -webkit-appearance: none; border: 1px solid rgba(255,255,255,0.28);
            margin: 0; padding: 0; outline: none; font-family: inherit;
            display: flex; align-items: center; justify-content: center; border-radius: 50%;
            color: #fff; cursor: pointer; background: rgba(20,20,20,0.4);
            -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
            box-shadow: 0 4px 18px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.18), 0 0 10px rgba(255,255,255,0.15);
            transition: transform 0.22s cubic-bezier(.34,1.56,.64,1), background 0.15s, box-shadow 0.15s;
            transform: scale(1); width: 40px; height: 40px;
        }
        .ios-glass-btn:hover {
            background: rgba(46,46,46,0.5);
            box-shadow: 0 6px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.22), 0 0 18px rgba(255,255,255,0.3);
        }
        .ios-glass-btn:active { transform: scale(0.92); }
        .ios-glass-btn:disabled { opacity: 0.4; pointer-events: none; }
        .ios-glass-btn svg { width: 18px; height: 18px; }
        .ios-glass-btn.download-btn { background: rgba(0,122,255,0.3); border-color: rgba(0,122,255,0.5); }
        .ios-glass-btn.download-btn:hover { background: rgba(0,122,255,0.45); }
        .ios-glass-btn.download-btn.retry { background: rgba(255,159,10,0.3); border-color: rgba(255,159,10,0.5); }
        .ios-glass-btn.download-btn.retry:hover { background: rgba(255,159,10,0.45); }
        .ios-glass-btn.pause-btn { background: rgba(255,255,255,0.1); }
        .cleanup-btn { background: rgba(255,59,48,0.3); border-color: rgba(255,59,48,0.5); display: none; margin-left: auto; }
        .cleanup-btn:hover { background: rgba(255,59,48,0.45); }

        .progress-wrap { height: 8px; background: rgba(255,255,255,0.12); border-radius: 4px; overflow: hidden; margin: 10px 0 12px 0; }
        .progress-bar { height: 100%; background: #007aff; width: 0%; transition: width 0.3s; }
        .progress-bar.error-bar { background: #ff9f0a; }

        .info-row { display: flex; justify-content: space-between; font-size: 11px; opacity: 0.8; margin-bottom: 4px; }

        /* 底部状态行：左右对齐，上方高光分隔线 */
        .bottom-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-top: 8px;
            border-top: 1px solid rgba(255,255,255,0.15);
        }
        .status-text {
            font-size: 12px; opacity: 0.8; word-break: break-all; line-height: 1.5;
            flex: 1;
        }
        .status-text.error-text { color: #ff9f0a; }
        .mode-info {
            font-size: 11px; opacity: 0.7; color: #fff;
            white-space: nowrap;
            margin-left: 10px;
        }
    `;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // ========== 油猴菜单与提示 ==========
    function showToast(message) {
        let toast = document.getElementById('m3u8-userscript-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'm3u8-userscript-toast';
            Object.assign(toast.style, {
                position: 'fixed', left: '50%', bottom: '24px',
                transform: 'translate(-50%, 12px)', opacity: '0',
                zIndex: '2147483647', padding: '10px 16px',
                borderRadius: '12px', color: '#fff',
                background: 'rgba(25,25,30,.88)',
                border: '1px solid rgba(255,255,255,.18)',
                boxShadow: '0 6px 24px rgba(0,0,0,.28)',
                backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
                font: '13px/1.4 system-ui,sans-serif',
                pointerEvents: 'none', transition: 'opacity .2s, transform .2s',
                maxWidth: 'min(86vw, 420px)', textAlign: 'center'
            });
            document.documentElement.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.opacity = '1';
        toast.style.transform = 'translate(-50%, 0)';
        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translate(-50%, 12px)';
        }, 1900);
    }

    function isSniffingActive() {
        return sniffEnabled;
    }

    function registerMenuCommands() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        if (typeof GM_unregisterMenuCommand === 'function') {
            for (const id of menuCommandIds) {
                try { GM_unregisterMenuCommand(id); } catch (_) {}
            }
        }
        menuCommandIds = [];
        try {
            const label = sniffEnabled ? '✅ 自动嗅探-ON' : '🚫 自动嗅探-OFF';
            const id = GM_registerMenuCommand(label, () => {
                sniffEnabled = !sniffEnabled;
                try {
                    if (typeof GM_setValue === 'function') {
                        GM_setValue(SNIFF_SETTING_KEY, sniffEnabled);
                    }
                } catch (_) {}
                registerMenuCommands();
                showToast(sniffEnabled ? '自动嗅探已开启' : '自动嗅探已关闭');
                if (isSniffingActive()) {
                    const url = sniffM3u8();
                    if (url && uiInstance) {
                        uiInstance.setUrl(url);
                        uiInstance.showBall();
                    }
                }
            });
            if (id !== undefined) menuCommandIds.push(id);
        } catch (_) {}
    }

    let uiInstance = null;

    // ========== 下载文件命名 ==========
    function getPlayerInternalTitle(video) {
        // 先从当前视频所属播放器容器中查找标题，避免误取页面其他区域的标题。
        const containerSelector = [
            '[class*="player"]', '[id*="player"]',
            '[class*="video-container"]', '[class*="video-player"]',
            '[id*="video-container"]', '[id*="video-player"]'
        ].join(',');

        let containers = [];
        if (video) {
            let node = video.parentElement;
            for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
                if (node.matches?.(containerSelector)) containers.push(node);
            }
            const closest = video.closest?.(containerSelector);
            if (closest && !containers.includes(closest)) containers.unshift(closest);
        }

        // 常见播放器标题节点；同时兼容 title / aria-label / data-title 属性。
        const titleSelectors = [
            '[class*="video-title"]', '[class*="player-title"]',
            '[class*="title"]', '[id*="video-title"]', '[id*="player-title"]',
            '[data-title]', '[aria-label][class*="title"]',
            '.title', '.videoName', '.video-name', '.name',
            'h1', 'h2'
        ];

        for (const container of containers) {
            for (const selector of titleSelectors) {
                let nodes = [];
                try { nodes = container.querySelectorAll(selector); } catch (_) {}
                for (const node of nodes) {
                    const value = node.getAttribute('data-title')
                        || node.getAttribute('title')
                        || node.getAttribute('aria-label')
                        || node.textContent;
                    const title = normalizeTitleCandidate(value);
                    if (title) return title;
                }
            }
        }
        return '';
    }

    function normalizeTitleCandidate(value) {
        const title = String(value || '').replace(/\s+/g, ' ').trim();
        if (!title || /^(视频播放|在线播放|播放器|player|video)$/i.test(title)) return '';
        // 避免把整段播放器说明或导航文本当成文件名。
        if (title.length > 300) return '';
        return title;
    }

    function getVideoTitle() {
        const videos = [...document.querySelectorAll('video')];
        const activeVideo = videos.find(v => !v.paused && (v.currentSrc || v.src))
            || videos.find(v => v.currentSrc || v.src)
            || videos[0]
            || null;

        // 严格按用户指定的优先级逐级回退。
        const candidates = [
            activeVideo?.getAttribute('title') || activeVideo?.title,
            activeVideo?.getAttribute('aria-label'),
            getPlayerInternalTitle(activeVideo),
            document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
            document.querySelector('meta[name="twitter:title"]')?.getAttribute('content'),
            document.querySelector('h1')?.textContent,
            document.title
        ];

        for (const candidate of candidates) {
            const normalized = normalizeTitleCandidate(candidate);
            if (normalized) return sanitizeFilename(normalized);
        }
        return 'video';
    }

    function sanitizeFilename(name) {
        let safe = String(name || '')
            // Windows / Android / 常见文件系统不允许的字符及控制字符。
            .replace(/[\\/:*?"<>|\u0000-\u001F\u007F]/g, '_')
            .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
            .replace(/\s+/g, ' ')
            .replace(/[. ]+$/g, '')
            .trim();

        // 文件名不能是空字符串、. 或 ..，并避开 Windows 保留设备名。
        if (!safe || /^\.+$/.test(safe)) safe = 'video';
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(safe)) safe = `_${safe}`;

        // 控制文件名长度，避免极长标题导致文件系统拒绝创建。
        safe = Array.from(safe).slice(0, 120).join('').replace(/[. ]+$/g, '');
        return safe || 'video';
    }

    function createDownloadFilename() {
        const base = getVideoTitle();
        const count = (filenameCounts.get(base) || 0) + 1;
        filenameCounts.set(base, count);
        return `${base}${count > 1 ? `_${count}` : ''}.mp4`;
    }

    // ========== SVG 图标 ==========
    const ICONS = {
        link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
        refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>`,
        download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>`,
        pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
        play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
        retry: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10a9 9 0 1 0-3 7.7"/><path d="M21 4v6h-6"/></svg>`,
        check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
        trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`
    };

    // ========== 工具函数 ==========
    function sniffM3u8() {
        const videos = document.querySelectorAll('video');
        for (const v of videos) {
            if (v.src && v.src.includes('.m3u8')) return v.src;
            if (v.currentSrc && v.currentSrc.includes('.m3u8')) return v.currentSrc;
            for (const key of ['_hls', '__hls', 'hls', 'hlsInstance', 'player', '_player']) {
                try {
                    const inst = v[key];
                    if (inst && inst.url && inst.url.includes('.m3u8')) return inst.url;
                    if (inst && inst.media && inst.media.url && inst.media.url.includes('.m3u8')) return inst.media.url;
                } catch (_) {}
            }
        }
        const sources = document.querySelectorAll('video source[src]');
        for (const s of sources) if (s.src.includes('.m3u8')) return s.src;
        for (const el of document.querySelectorAll('[data-m3u8],[data-hls],[data-src],[data-video]')) {
            const val = el.dataset.m3u8 || el.dataset.hls || el.dataset.src || el.dataset.video;
            if (val && val.includes('.m3u8')) return val;
        }
        try {
            if (window.hls && window.hls.url && window.hls.url.includes('.m3u8')) return window.hls.url;
            if (window.Hls && window.Hls.url && window.Hls.url.includes('.m3u8')) return window.Hls.url;
            if (window.player && window.player.url && window.player.url.includes('.m3u8')) return window.player.url;
        } catch (_) {}
        try {
            const entries = performance.getEntriesByType('resource');
            const found = [...entries].reverse().find(e => e.name.includes('.m3u8'));
            if (found) return found.name;
        } catch (_) {}
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
            const text = script.textContent || script.innerText || '';
            const match = text.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
            if (match) return match[0];
        }
        return '';
    }

    async function copyToClipboard(text) {
        try {
            if (typeof GM_setClipboard !== 'undefined') { GM_setClipboard(text, 'text'); return true; }
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) { return false; }
    }

    function gmRequest(url, responseType = 'text', timeout = REQUEST_TIMEOUT) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url, responseType, timeout,
                onload: r => { if (r.status >= 200 && r.status < 300) resolve(r.response); else reject(new Error(`HTTP ${r.status}`)); },
                onerror: () => reject(new Error('network')),
                ontimeout: () => reject(new Error('timeout'))
            });
        });
    }

    async function aesDecrypt(ciphertext, keyBytes, ivBytes) {
        const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
        const out = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, key, ciphertext);
        return new Uint8Array(out);
    }

    async function fetchRealM3u8(url) {
        const text = await new Promise(resolve => {
            GM_xmlhttpRequest({ method: 'GET', url, timeout: REQUEST_TIMEOUT, onload: r => resolve(r.responseText), onerror: () => resolve(null), ontimeout: () => resolve(null) });
        });
        if (!text) return null;

        if (text.includes('#EXT-X-STREAM-INF')) {
            const lines = text.split('\n');
            let bestBandwidth = 0, bestUrl = '';
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('#EXT-X-STREAM-INF')) {
                    const bw = parseInt((line.match(/BANDWIDTH=(\d+)/) || [])[1]) || 0;
                    if (i + 1 < lines.length) { const sub = lines[i + 1].trim(); if (sub && !sub.startsWith('#')) { if (bw > bestBandwidth) { bestBandwidth = bw; bestUrl = sub; } } }
                }
            }
            if (bestUrl) return fetchRealM3u8(new URL(bestUrl, url).href);
            return null;
        }

        const lines = text.split('\n');
        let mapUri = null;
        const segments = [];
        let totalDuration = 0;
        let currentKey = null;

        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('#EXT-X-MAP:URI=')) { const m = t.match(/URI="([^"]+)"/); if (m) mapUri = new URL(m[1], url).href; }
            else if (t.startsWith('#EXT-X-KEY:')) {
                const methodMatch = t.match(/METHOD=([^,]+)/);
                const uriMatch = t.match(/URI="([^"]+)"/);
                const ivMatch = t.match(/IV=0x([0-9a-fA-F]+)/);
                const method = methodMatch ? methodMatch[1] : '';
                if (method === 'AES-128') {
                    const keyUri = uriMatch ? new URL(uriMatch[1], url).href : null;
                    const iv = ivMatch ? ivMatch[1] : null;
                    currentKey = { method, uri: keyUri, iv };
                } else if (method === 'NONE') { currentKey = null; }
            } else if (t.startsWith('#EXTINF:')) {
                const dur = parseFloat(t.split(':')[1].replace(',', ''));
                if (!isNaN(dur)) totalDuration += dur;
            } else if (t && !t.startsWith('#')) {
                try { segments.push({ url: new URL(t, url).href, key: currentKey }); } catch (_) {}
            }
        }
        return { mapUri, segments, totalDuration, rawText: text };
    }

    function estimateFileSize(duration) { return duration * ESTIMATED_BITRATE / 8 * 1.1; }

    async function downloadAndDecrypt(segUrl, referer, signal, keyInfo, keyCache, segmentIndex, retries = MAX_RETRIES) {
        const blob = await new Promise((resolve, reject) => {
            const attempt = (n) => {
                if (signal && signal.aborted) return reject(new Error('aborted'));
                const xhr = GM_xmlhttpRequest({
                    method: 'GET', url: segUrl, responseType: 'blob', timeout: REQUEST_TIMEOUT,
                    headers: { 'Referer': referer, 'Origin': new URL(referer).origin },
                    onload: r => {
                        if (signal && signal.aborted) return reject(new Error('aborted'));
                        if (r.status >= 200 && r.status < 300 && r.response && r.response.size > 0) resolve(r.response);
                        else if (n > 1) setTimeout(() => attempt(n - 1), 500);
                        else reject(new Error(`HTTP ${r.status}`));
                    },
                    onerror: () => { if (signal && signal.aborted) return reject(new Error('aborted')); if (n > 1) setTimeout(() => attempt(n - 1), 500); else reject(new Error('network')); },
                    ontimeout: () => { if (signal && signal.aborted) return reject(new Error('aborted')); if (n > 1) setTimeout(() => attempt(n - 1), 500); else reject(new Error('timeout')); }
                });
                signal?.addEventListener('abort', () => { try { xhr.abort?.(); } catch(_){} });
            };
            attempt(retries);
        });

        if (!keyInfo) return blob;

        let keyBytes = keyCache.get(keyInfo.uri);
        if (!keyBytes) {
            keyBytes = new Uint8Array(await gmRequest(keyInfo.uri, 'arraybuffer'));
            keyCache.set(keyInfo.uri, keyBytes);
        }

        let ivBytes;
        if (keyInfo.iv) {
            ivBytes = new Uint8Array(keyInfo.iv.match(/.{2}/g).map(byte => parseInt(byte, 16)));
        } else {
            const ivBuffer = new ArrayBuffer(16);
            const ivView = new DataView(ivBuffer);
            ivView.setBigUint64(8, BigInt(segmentIndex), false);
            ivBytes = new Uint8Array(ivBuffer);
        }

        const cipherBuf = await blob.arrayBuffer();
        const plainBuf = await aesDecrypt(cipherBuf, keyBytes, ivBytes);
        return new Blob([plainBuf], { type: 'video/mp2t' });
    }

    async function getDirectoryHandle() {
        if (savedDirHandle) {
            const state = await savedDirHandle.queryPermission({ mode: 'readwrite' });
            if (state === 'granted') return savedDirHandle;
            if (state === 'prompt') { const ns = await savedDirHandle.requestPermission({ mode: 'readwrite' }); if (ns === 'granted') return savedDirHandle; }
            savedDirHandle = null;
        }
        savedDirHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
        return savedDirHandle;
    }

    // ========== 保存位置选择（边下边存） ==========
    // 优先 showSaveFilePicker（单文件，桌面 Chrome/Edge 86+、Android WebView 132+），
    // 其次 showDirectoryPicker（仅桌面），都不可用或失败时由调用方回退到内存下载。
    const hasSavePicker = () => typeof window.showSaveFilePicker === 'function';
    const hasDirPicker = () => typeof window.showDirectoryPicker === 'function';

    // 文件选择器要求“用户刚刚操作过”；浏览器不提供该接口时按“有”处理，交给 SecurityError 兜底
    function userGestureActive() {
        try { return !navigator.userActivation || navigator.userActivation.isActive; } catch (_) { return true; }
    }

    // 把选择器错误归类：用户取消 / 跨域 iframe / 需要重新点击 抛出；其余错误只记录，让调用方尝试下一种方式
    let lastPickError = '';
    function handlePickError(err, elapsed) {
        const name = err && err.name, msg = err && err.message;
        lastPickError = `${name || 'Error'}${msg ? ': ' + msg : ''}`;
        if (name === 'AbortError') {
            // 几百毫秒内就 Abort：用户来不及操作，说明浏览器根本没弹出选择器（不支持 / 被拦截），不算“用户取消”
            if (elapsed !== undefined && elapsed < 800) {
                lastPickError = `选择器未弹出(${Math.round(elapsed)}ms 即返回 AbortError)`;
                console.warn('[M3U8] 保存选择器立即返回 AbortError，视为不可用');
                return;
            }
            throw new Error('用户取消');
        }
        if (name === 'SecurityError') {
            if (window.self !== window.top) throw new Error('CrossOriginIframe');
            throw new Error('NeedGesture');
        }
        console.warn('[M3U8] 选择保存位置失败:', name, msg);
    }

    async function pickSaveTarget(filename) {
        if (hasSavePicker()) {
            const t0 = performance.now();
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }]
                });
                return { kind: 'file', handle };
            } catch (err) { handlePickError(err, performance.now() - t0); }
        }
        if (hasDirPicker()) {
            const t1 = performance.now();
            try { return { kind: 'dir', handle: await getDirectoryHandle() }; }
            catch (err) { handlePickError(err, performance.now() - t1); }
        }
        return null;
    }

    // 等用户在面板里再点一次按钮（刷新“用户操作”授权），点击后返回
    function waitForUserClick(ui, message, label) {
        return new Promise(resolve => {
            const status = ui.panel.querySelector('#status-text');
            status.textContent = message;
            ui.panel.querySelectorAll('.m3u8-pick-btn').forEach(b => b.remove());
            const btn = document.createElement('button');
            btn.type = 'button'; btn.className = 'm3u8-pick-btn'; btn.textContent = label;
            btn.style.cssText = 'margin:6px 0;padding:6px 14px;border-radius:12px;border:1px solid rgba(0,122,255,.5);background:rgba(0,122,255,.3);color:inherit;font-size:13px;cursor:pointer;';
            btn.addEventListener('click', () => { btn.remove(); resolve(); }, { once: true });
            status.insertAdjacentElement('afterend', btn);
        });
    }

    // ========== 下载控制类 ==========
    class DownloadController {
        constructor(ui, url, concurrency) {
            this.ui = ui; this.url = url; this.concurrency = concurrency;
            this.abortController = null; this.paused = false;
            this.completed = 0; this.total = 0; this.bytes = 0; this.startTime = 0;
            this.mode = 'memory'; this.writable = null; this.dirHandle = null; this.fileHandle = null; this.startBytes = 0;
            this.segmentBlobs = []; this.mapBlob = null;
            this.currentFilename = createDownloadFilename(); this.previousFilename = '';
            this.segments = []; this.mapUri = null; this.keyCache = new Map();
        }

        async run() {
            const { panel, ball } = this.ui;
            const pb = panel.querySelector('.progress-bar'), pt = panel.querySelector('#progress-text');
            const st = panel.querySelector('#speed-text'), status = panel.querySelector('#status-text');
            const dBtn = panel.querySelector('#download-btn'), pBtn = panel.querySelector('#pause-btn');
            const cBtn = panel.querySelector('#cleanup-btn'), mInfo = panel.querySelector('#mode-info');

            pb.style.width = '0%'; pb.classList.remove('error-bar'); pt.textContent = '0%'; st.textContent = '0 KB/s';
            status.textContent = '📡 正在获取 M3U8...'; status.classList.remove('error-text');
            dBtn.disabled = true; dBtn.classList.remove('retry'); dBtn.innerHTML = ICONS.download;
            pBtn.disabled = true; pBtn.innerHTML = ICONS.pause; cBtn.style.display = 'none'; mInfo.textContent = '';
            ball.classList.remove('done','error');

            try {
                const manifest = await fetchRealM3u8(this.url);
                if (!manifest || !manifest.segments.length) throw new Error('无法解析 M3U8');

                const unsupported = manifest.segments.some(seg => seg.key && seg.key.method !== 'AES-128');
                if (unsupported) {
                    status.textContent = '🔐 不支持的加密方式，已复制链接，请用 N_m3u8DL 下载';
                    status.classList.add('error-text'); GM_setClipboard(this.url, 'text');
                    throw new Error('unsupported-encryption');
                }

                // 磁盘模式暂停后继续：沿用已打开的文件，不重新选择位置、不重头下载
                const resumingDisk = this.mode === 'disk' && !!this.writable;
                if (resumingDisk && manifest.segments.length !== this.total) throw new Error('M3U8 片段数已变化，无法续传，请清理后重试');

                this.mapUri = manifest.mapUri; this.segments = manifest.segments; this.total = this.segments.length;
                this.totalDuration = manifest.totalDuration; this.estimatedSize = estimateFileSize(this.totalDuration);

                if (!resumingDisk) {
                    let useDisk = (this.totalDuration > 0 && this.estimatedSize > SIZE_THRESHOLD) || this.totalDuration === 0;
                    if (useDisk && !hasSavePicker() && !hasDirPicker()) { useDisk = false; }
                    else if (useDisk) {
                        try {
                            let target;
                            for (let attempt = 0; ; attempt++) {
                                try {
                                    if (!userGestureActive()) throw new Error('NeedGesture');
                                    target = await pickSaveTarget(this.currentFilename);
                                    break;
                                } catch (err) {
                                    if (err.message !== 'NeedGesture' || attempt >= 1) throw err;
                                    // 拉取 M3U8 期间授权已过期：让用户再点一次，立即弹出选择器
                                    await waitForUserClick(this.ui, '💾 请点击按钮选择保存位置', '选择保存位置');
                                }
                            }
                            if (!target) {
                                useDisk = false;
                                status.textContent = `⚠️ 无法选择保存位置${lastPickError ? '（' + lastPickError + '）' : ''}，已切换为内存下载` +
                                    (this.estimatedSize > SIZE_THRESHOLD ? '；文件较大，内存可能不足' : '');
                            }
                            else if (target.kind === 'file') { this.fileHandle = target.handle; this.dirHandle = null; }
                            else { this.dirHandle = target.handle; this.fileHandle = null; }
                        } catch (err) {
                            if (err.message === 'CrossOriginIframe') { useDisk = false; status.textContent = '⚠️ 跨域iframe，已自动切换为内存下载'; }
                            else if (err.message === 'NeedGesture') { useDisk = false; status.textContent = '⚠️ 未获得选择保存位置的授权，已自动切换为内存下载'; }
                            else throw err;
                        }
                    }
                    this.mode = useDisk ? 'disk' : 'memory';
                }
                mInfo.textContent = `💡 ${this.mode === 'disk' ? '边下边存' : '内存下载'} · ${this.totalDuration > 0 ? `预估 ${(this.estimatedSize/1024/1024).toFixed(0)}MB` : '无法预估时长'}`;

                if (this.mapUri && !resumingDisk) {
                    status.textContent = '📥 初始化段...';
                    this.mapBlob = await downloadAndDecrypt(this.mapUri, this.url, null, null, this.keyCache, 0, MAX_RETRIES);
                }

                if (this.mode === 'disk') await this._diskModeRun();
                else await this._memoryModeRun();
            } catch (err) {
                if (['encrypted','unsupported-encryption','用户取消'].includes(err.message)) {
                    if (err.message === '用户取消') { status.textContent = '⚠️ 已取消选择保存位置'; status.classList.add('error-text'); }
                    ball.classList.add('error'); dBtn.disabled = false; pBtn.disabled = true;
                    return;
                }
                // 磁盘模式出错：丢弃未完成的写入流，避免留下被占用的半截文件句柄
                if (this.writable) { const w = this.writable; this.writable = null; try { Promise.resolve(w.abort()).catch(() => {}); } catch (_) {} }
                status.textContent = '❌ ' + (err.name && err.name !== 'Error' ? err.name + ': ' : '') + err.message;
                status.classList.add('error-text'); dBtn.disabled = false; pBtn.disabled = true; ball.classList.add('error');
            }
        }

        async _diskModeRun() {
            const { panel, ball } = this.ui;
            const pb = panel.querySelector('.progress-bar'), pt = panel.querySelector('#progress-text');
            const st = panel.querySelector('#speed-text'), status = panel.querySelector('#status-text');
            const dBtn = panel.querySelector('#download-btn'), pBtn = panel.querySelector('#pause-btn');
            const cBtn = panel.querySelector('#cleanup-btn');

            if (!this.writable) {
                // 首次：创建文件并打开写入流（单文件模式用选择器返回的句柄，目录模式在目录里新建）
                let fh = this.fileHandle;
                if (!fh) {
                    if (!this.dirHandle) throw new Error('保存位置不可用');
                    fh = await this.dirHandle.getFileHandle(this.currentFilename, { create: true });
                }
                this.writable = await fh.createWritable();
                this.completed = 0; this.bytes = 0;
                if (this.mapBlob) { await this.writable.write(this.mapBlob); this.bytes = this.mapBlob.size; }
            }
            // 暂停后继续时 completed / bytes 保持不变，从下一个未写入的片段接着写
            this.startTime = Date.now(); this.startBytes = this.bytes; this.abortController = new AbortController();

            pBtn.disabled = false; pBtn.innerHTML = ICONS.pause;
            pBtn.onclick = () => this.togglePause();

            const updateProgress = () => {
                const pct = (this.completed / this.total * 100).toFixed(1);
                pb.style.width = pct + '%'; pt.textContent = `${pct}% (${this.completed}/${this.total})`;
                const elapsed = (Date.now() - this.startTime) / 1000;
                st.textContent = `${elapsed > 0 ? ((this.bytes - this.startBytes) / 1024 / elapsed).toFixed(1) : '0'} KB/s`;
            };
            updateProgress();

            status.textContent = `📥 下载中 (${this.total} 片段，串行)`;

            for (let i = this.completed; i < this.segments.length; i++) {
                if (this.paused) {
                    cBtn.style.display = 'flex';
                    status.textContent = '⏸️ 已暂停，点击 ▶ 继续';
                    pBtn.disabled = false; dBtn.disabled = true;
                    return;
                }
                const seg = this.segments[i];
                let success = false;
                while (!success && !this.paused) {
                    let blob;
                    try {
                        blob = await downloadAndDecrypt(seg.url, this.url, this.abortController.signal, seg.key, this.keyCache, i, MAX_RETRIES);
                    } catch (err) {
                        if (err.message === 'aborted') return;
                        status.textContent = `🔄 片段 ${i+1} 重试中...`;
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    }
                    if (this.paused) return;
                    try {
                        await this.writable.write(blob);
                    } catch (err) {
                        // 写入失败（权限 / 空间 / 句柄失效）重新下载没有意义，直接报出真实原因
                        const e = new Error(`写入文件失败（片段 ${i+1}/${this.total}）：${err && err.message || err}`);
                        e.name = (err && err.name) || 'WriteError';
                        throw e;
                    }
                    this.bytes += blob.size; this.completed++; updateProgress();
                    success = true;
                }
            }

            await this.writable.close();
            this.writable = null;
            if (this.paused) {
                cBtn.style.display = 'flex';
                status.textContent = '⏸️ 已暂停，点击 ▶ 继续';
                pBtn.disabled = false; dBtn.disabled = true;
                return;
            }

            if (this.previousFilename && this.dirHandle) { try { await this.dirHandle.removeEntry(this.previousFilename); } catch(_) {} }
            const fileSizeMB = (this.bytes / 1024 / 1024).toFixed(2);
            pb.style.width = '100%'; pb.classList.remove('error-bar'); pt.textContent = '100%';
            ball.classList.add('done'); dBtn.disabled = false; pBtn.disabled = true;
            dBtn.classList.remove('retry'); dBtn.innerHTML = ICONS.download;
            cBtn.style.display = 'flex';
            status.textContent = `✅ 完成：${(this.fileHandle && this.fileHandle.name) || this.currentFilename} (${fileSizeMB}MB)`;
            if (typeof GM_notification !== 'undefined') GM_notification({ title: '下载完成', text: `${fileSizeMB}MB`, timeout: 5000 });
        }

        async _memoryModeRun() {
            const { panel, ball } = this.ui;
            const pb = panel.querySelector('.progress-bar'), pt = panel.querySelector('#progress-text');
            const st = panel.querySelector('#speed-text'), status = panel.querySelector('#status-text');
            const dBtn = panel.querySelector('#download-btn'), pBtn = panel.querySelector('#pause-btn');
            const cBtn = panel.querySelector('#cleanup-btn');

            this.segmentBlobs = new Array(this.total).fill(null);
            this.completed = 0; this.bytes = this.mapBlob ? this.mapBlob.size : 0;
            this.startTime = Date.now();
            const failed = [];
            this.abortController = new AbortController();

            const queue = this.segments.map((seg, idx) => ({ ...seg, idx }));
            const concurrency = this.concurrency;

            pBtn.disabled = false; pBtn.innerHTML = ICONS.pause;
            pBtn.onclick = () => this.togglePause();

            const updateProgress = () => {
                const pct = (this.completed / this.total * 100).toFixed(1);
                pb.style.width = pct + '%'; pt.textContent = `${pct}% (${this.completed}/${this.total})`;
                const elapsed = (Date.now() - this.startTime) / 1000;
                st.textContent = `${elapsed > 0 ? (this.bytes / 1024 / elapsed).toFixed(1) : '0'} KB/s`;
            };

            status.textContent = `📥 下载中 (${this.total} 片段，并发)`;

            const downloadOne = async (segUrl, keyInfo, idx) => {
                try {
                    const blob = await downloadAndDecrypt(segUrl, this.url, this.abortController.signal, keyInfo, this.keyCache, idx, MAX_RETRIES);
                    if (this.paused) return;
                    this.segmentBlobs[idx] = blob;
                    this.bytes += blob.size; this.completed++; updateProgress();
                } catch (err) {
                    if (err.message === 'aborted') return;
                    failed.push({ url: segUrl, key: keyInfo, idx });
                    this.completed++; updateProgress();
                }
            };

            const workers = []; for (let i = 0; i < concurrency; i++) workers.push((async () => { while (queue.length > 0) { if (this.paused) return; const seg = queue.shift(); if (seg) await downloadOne(seg.url, seg.key, seg.idx); } })());
            await Promise.all(workers);

            for (let round = 0; round < FINAL_RETRY_ROUNDS && failed.length > 0 && !this.paused; round++) {
                status.textContent = `🔄 重试 ${round+1}/${FINAL_RETRY_ROUNDS} (${failed.length}个)`;
                const retryList = [...failed]; failed.length = 0;
                const rworkers = [];
                for (let i = 0; i < concurrency; i++) rworkers.push((async () => { while (retryList.length > 0) { if (this.paused) return; const item = retryList.shift(); try { const blob = await downloadAndDecrypt(item.url, this.url, this.abortController.signal, item.key, this.keyCache, item.idx, MAX_RETRIES); if (this.paused) return; this.segmentBlobs[item.idx] = blob; this.bytes += blob.size; } catch (err) { if (err.message === 'aborted') return; failed.push(item); } } })());
                await Promise.all(rworkers);
            }

            if (this.paused) {
                cBtn.style.display = 'flex';
                status.textContent = '⏸️ 已暂停，点击 ▶ 继续';
                pBtn.disabled = false; dBtn.disabled = true;
                return;
            }

            cBtn.style.display = 'flex';

            if (failed.length === 0) {
                const missing = this.segmentBlobs.findIndex(b => b === null);
                if (missing !== -1) throw new Error(`片段 ${missing} 丢失`);

                const fileSizeMB = (this.bytes / 1024 / 1024).toFixed(2);
                pb.style.width = '100%'; pb.classList.remove('error-bar'); pt.textContent = '100%';
                ball.classList.add('done'); dBtn.disabled = false; pBtn.disabled = true;
                dBtn.classList.remove('retry'); dBtn.innerHTML = ICONS.download;

                const blobs = this.mapBlob ? [this.mapBlob, ...this.segmentBlobs] : this.segmentBlobs;
                const finalBlob = new Blob(blobs, { type: 'video/mp4' });
                const blobUrl = URL.createObjectURL(finalBlob);
                const a = document.createElement('a'); a.href = blobUrl; a.download = this.currentFilename;
                document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(blobUrl);
                status.textContent = `✅ 完成 (${fileSizeMB}MB)`;
                if (typeof GM_notification !== 'undefined') GM_notification({ title: '下载完成', text: `${fileSizeMB}MB`, timeout: 5000 });
            } else {
                pb.classList.add('error-bar');
                status.textContent = `⚠️ ${failed.length}个片段失败，请重试`;
                status.classList.add('error-text');
                dBtn.disabled = false; pBtn.disabled = true;
                dBtn.classList.add('retry'); dBtn.innerHTML = ICONS.retry;
                ball.classList.add('error');
            }
        }

        togglePause() {
            this.paused = !this.paused;
            const cBtn = this.ui.panel.querySelector('#cleanup-btn');
            if (this.paused) {
                this.abortController.abort();
                this.ui.panel.querySelector('#pause-btn').innerHTML = ICONS.play;
                this.ui.panel.querySelector('#status-text').textContent = '⏸️ 已暂停';
                cBtn.style.display = 'flex'; // 立即显示清理按钮
            } else {
                this.abortController = new AbortController();
                this.ui.panel.querySelector('#pause-btn').innerHTML = ICONS.pause;
                cBtn.style.display = 'none'; // 继续下载时隐藏清理按钮
                this.run();
            }
        }

        manualCleanup() {
            let releasedSize = 0;
            if (this.segmentBlobs) releasedSize = this.segmentBlobs.reduce((s, b) => s + (b?.size || 0), 0);
            else releasedSize = this.bytes || 0;
            const releasedMB = (releasedSize / 1024 / 1024).toFixed(2);
            this.cleanup();
            this.ui.panel.querySelector('#cleanup-btn').style.display = 'none';
            this.ui.panel.querySelector('#status-text').textContent = this.mode === 'disk' ? '🗑️ 已放弃未完成的下载' : `🗑️ 已释放 ${releasedMB} MB 内存`;
        }

        cleanup() {
            this.segmentBlobs = null; this.mapBlob = null; this.segments = null; this.keyCache.clear();
            if (this.abortController) { try { this.abortController.abort(); } catch(_) {} this.abortController = null; }
            if (this.writable) { const w = this.writable; this.writable = null; try { Promise.resolve(w.abort()).catch(() => {}); } catch(_) {} }
        }
    }

    // ========== UI 创建 ==========
    function createUI() {
        const ball = document.createElement('div'); ball.id = 'm3u8-drag-ball'; ball.innerHTML = '🎬'; ball.title = 'M3U8 下载'; document.body.appendChild(ball);
        const panel = document.createElement('div'); panel.className = 'm3u8-panel';
        panel.innerHTML = `
            <div class="input-group">
                <div class="input-icon" id="link-icon" title="复制链接">${ICONS.link}</div>
                <input class="m3u8-input" type="text" placeholder="m3u8 链接（自动嗅探）" id="url-input">
                <div class="input-icon input-icon-right" id="refresh-icon" title="重新嗅探">${ICONS.refresh}</div>
            </div>
            <div class="thread-row">
                <span class="thread-label">线程</span>
                <div class="thread-chip" data-threads="8">8</div>
                <div class="thread-chip active" data-threads="16">16</div>
                <div class="thread-chip" data-threads="32">32</div>
                <div class="thread-chip" data-threads="64">64</div>
            </div>
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">
                <button class="ios-glass-btn download-btn" id="download-btn" title="下载">${ICONS.download}</button>
                <button class="ios-glass-btn pause-btn" id="pause-btn" disabled title="暂停">${ICONS.pause}</button>
                <button class="ios-glass-btn cleanup-btn" id="cleanup-btn" title="释放内存">${ICONS.trash}</button>
            </div>
            <div class="progress-wrap"><div class="progress-bar"></div></div>
            <div class="info-row">
                <span id="progress-text">0%</span>
                <span id="speed-text">0 KB/s</span>
            </div>
            <div class="bottom-row">
                <span class="status-text" id="status-text">就绪</span>
                <span class="mode-info" id="mode-info"></span>
            </div>
        `;
        document.body.appendChild(panel);

        const linkIcon = panel.querySelector('#link-icon'), urlInput = panel.querySelector('#url-input'), refreshIcon = panel.querySelector('#refresh-icon');
        linkIcon.addEventListener('click', async e => { e.stopPropagation(); const link = urlInput.value.trim(); if (!link) return; if (await copyToClipboard(link)) { linkIcon.classList.add('copied'); linkIcon.innerHTML = ICONS.check; setTimeout(() => { linkIcon.classList.remove('copied'); linkIcon.innerHTML = ICONS.link; }, 1500); panel.querySelector('#status-text').textContent = '✅ 已复制'; setTimeout(() => { panel.querySelector('#status-text').textContent = '就绪'; }, 1500); } });
        refreshIcon.addEventListener('click', e => { e.stopPropagation(); const newUrl = sniffM3u8(); if (newUrl) { urlInput.value = newUrl; panel.querySelector('#status-text').textContent = '✅ 已更新链接'; ball.classList.add('has-url'); } else { panel.querySelector('#status-text').textContent = '⚠️ 未检测到 M3U8 链接'; } setTimeout(() => { panel.querySelector('#status-text').textContent = '就绪'; }, 1500); });

        let selThreads = 16;
        panel.querySelectorAll('.thread-chip').forEach(c => c.addEventListener('click', e => { e.stopPropagation(); panel.querySelectorAll('.thread-chip').forEach(x => x.classList.remove('active')); c.classList.add('active'); selThreads = parseInt(c.dataset.threads); }));

        let dragging = false, edge = 'right', sx = 0, sy = 0, sTop = 0;
        const updateEdge = () => { const r = ball.getBoundingClientRect(); edge = (r.left + r.width/2) < window.innerWidth/2 ? 'left' : 'right'; if (edge === 'left') { ball.style.left = '8px'; ball.style.right = 'auto'; } else { ball.style.right = '8px'; ball.style.left = 'auto'; } };
        ball.style.top = '80px'; ball.style.right = '12px';
        ball.addEventListener('pointerdown', e => { if (e.target !== ball) return; dragging = true; ball.setPointerCapture(e.pointerId); e.preventDefault(); sx = e.clientX; sy = e.clientY; sTop = ball.getBoundingClientRect().top; updateEdge(); });
        window.addEventListener('pointermove', e => { if (!dragging) return; const dx = e.clientX - sx, dy = e.clientY - sy; if (Math.abs(dx) > BALL_SIZE/2) { if (dx > 0 && edge === 'right') { edge = 'left'; sx = e.clientX; ball.style.left = '8px'; ball.style.right = 'auto'; } else if (dx < 0 && edge === 'left') { edge = 'right'; sx = e.clientX; ball.style.right = '8px'; ball.style.left = 'auto'; } sTop = ball.getBoundingClientRect().top; sy = e.clientY; return; } ball.style.top = Math.max(0, Math.min(sTop + dy, window.innerHeight - BALL_SIZE)) + 'px'; });
        window.addEventListener('pointerup', () => { dragging = false; });
        window.addEventListener('resize', () => { if (!dragging) updateEdge(); if (panel.classList.contains('open')) positionPanel(); });

        panel.addEventListener('click', e => e.stopPropagation());
        ball.addEventListener('click', e => { e.stopPropagation(); if (dragging) return; panel.classList.toggle('open'); if (panel.classList.contains('open')) positionPanel(); });
        document.addEventListener('click', e => { if (!panel.contains(e.target) && e.target !== ball) panel.classList.remove('open'); });

        function positionPanel() {
            const br = ball.getBoundingClientRect(), pw = panel.getBoundingClientRect().width, ph = panel.getBoundingClientRect().height;
            const ww = window.innerWidth, wh = window.innerHeight;
            let left, right;
            if (edge === 'left') { left = br.right + 10; if (left + pw > ww) left = ww - pw - 10; }
            else { right = ww - br.left + 10; if (right + pw > ww) right = ww - pw - 10; }
            if (edge === 'left') { panel.style.left = left + 'px'; panel.style.right = 'auto'; }
            else { panel.style.right = right + 'px'; panel.style.left = 'auto'; }
            let top = br.top - 10;
            if (top + ph > wh) top = wh - ph - 10;
            if (top < 10) top = 10;
            panel.style.top = top + 'px';
        }
        window.addEventListener('resize', () => { if (panel.classList.contains('open')) positionPanel(); });

        return { ball, panel, showBall: () => { ball.style.display = 'flex'; }, hideBall: () => { ball.style.display = 'none'; }, setUrl: (url) => { urlInput.value = url; ball.classList.add('has-url'); }, getConcurrency: () => selThreads, getUrl: () => urlInput.value.trim() };
    }

    function monitorVideoPlay(ui) {
        document.querySelectorAll('video').forEach(v => v.addEventListener('play', () => { if (!isSniffingActive()) return; const u = sniffM3u8(); if (u) { ui.setUrl(u); ui.showBall(); } }));
        const observer = new MutationObserver(muts => { muts.forEach(m => { m.addedNodes.forEach(n => { if (n.nodeName === 'VIDEO') n.addEventListener('play', () => { if (!isSniffingActive()) return; const u = sniffM3u8(); if (u) { ui.setUrl(u); ui.showBall(); } }); else if (n.querySelectorAll) n.querySelectorAll('video').forEach(v => v.addEventListener('play', () => { if (!isSniffingActive()) return; const u = sniffM3u8(); if (u) { ui.setUrl(u); ui.showBall(); } })); }); }); });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function init() {
        const ui = createUI();
        uiInstance = ui;
        registerMenuCommands();
        // 自动嗅探默认开启；菜单开关状态由 GM 存储持久化
        monitorVideoPlay(ui);
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
            const resp = await origFetch.apply(this, args);
            try {
                const u = typeof args[0] === 'string' ? args[0] : args[0]?.url;
                if (isSniffingActive() && u?.includes('.m3u8')) { ui.setUrl(u); ui.showBall(); }
            } catch(_) {}
            return resp;
        };
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
            if (isSniffingActive() && url?.includes('.m3u8')) { ui.setUrl(url); ui.showBall(); }
            return origOpen.apply(this, arguments);
        };

        ui.panel.querySelector('#download-btn').addEventListener('click', () => {
            const url = ui.getUrl();
            if (!url) { ui.panel.querySelector('#status-text').textContent = '请输入链接'; return; }
            if (currentDownload && currentDownload.paused) {
                ui.panel.querySelector('#status-text').textContent = '已有暂停的下载任务，请先继续';
                return;
            }
            if (currentDownload) currentDownload.cleanup();
            currentDownload = new DownloadController(ui, url, ui.getConcurrency());
            currentDownload.run();
        });

        ui.panel.querySelector('#cleanup-btn').addEventListener('click', () => {
            if (currentDownload) {
                currentDownload.manualCleanup();
                currentDownload = null; // 清理后释放引用
            } else {
                ui.panel.querySelector('#status-text').textContent = '没有要清理的下载任务';
            }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();