// ==UserScript==
// @name         M3U8媒体下载器
// @namespace    https://github.com/520luo/js/m3u8-downloader
// @version      5.3.8
// @description  智能嗅探,多线程下载,智能模式,边下边存,修复视频无法打开,语法修正
// @icon         https://raw.githubusercontent.com/520LUO/icons/refs/heads/main/M3U8.png
// @author       520LUO
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setClipboard
// @connect      *
// @run-at       document-idle
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/584352/M3U8%E5%AA%92%E4%BD%93%E4%B8%8B%E8%BD%BD%E5%99%A8.user.js
// @updateURL https://update.greasyfork.org/scripts/584352/M3U8%E5%AA%92%E4%BD%93%E4%B8%8B%E8%BD%BD%E5%99%A8.meta.js
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

    // ==========  UI 样式 ==========
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
        .status-text { font-size: 12px; opacity: 0.8; word-break: break-all; line-height: 1.4; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.15); }
        .status-text.error-text { color: #ff9f0a; }

        .mode-info { position: absolute; bottom: 16px; right: 16px; font-size: 11px; opacity: 0.7; color: #fff; pointer-events: none; }
    `;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

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
                try { const inst = v[key]; if (inst && inst.url && inst.url.includes('.m3u8')) return inst.url; if (inst && inst.media && inst.media.url && inst.media.url.includes('.m3u8')) return inst.media.url; } catch (_) {}
            }
        }
        const sources = document.querySelectorAll('video source[src]');
        for (const s of sources) if (s.src.includes('.m3u8')) return s.src;
        for (const el of document.querySelectorAll('[data-m3u8],[data-hls],[data-src],[data-video]')) {
            const val = el.dataset.m3u8 || el.dataset.hls || el.dataset.src || el.dataset.video;
            if (val && val.includes('.m3u8')) return val;
        }
        try { if (window.hls && window.hls.url && window.hls.url.includes('.m3u8')) return window.hls.url; if (window.Hls && window.Hls.url && window.Hls.url.includes('.m3u8')) return window.Hls.url; if (window.player && window.player.url && window.player.url.includes('.m3u8')) return window.player.url; } catch (_) {}
        try { const entries = performance.getEntriesByType('resource'); const found = [...entries].reverse().find(e => e.name.includes('.m3u8')); if (found) return found.name; } catch (_) {}
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) { const text = script.textContent || script.innerText || ''; const match = text.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/); if (match) return match[0]; }
        return '';
    }

    async function copyToClipboard(text) {
        try { if (typeof GM_setClipboard !== 'undefined') { GM_setClipboard(text, 'text'); return true; } await navigator.clipboard.writeText(text); return true; } catch (_) { return false; }
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
        let mapUri = null; const segments = []; let totalDuration = 0;
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('#EXT-X-MAP:URI=')) { const m = t.match(/URI="([^"]+)"/); if (m) mapUri = new URL(m[1], url).href; }
            else if (t.startsWith('#EXTINF:')) { const dur = parseFloat(t.split(':')[1].replace(',', '')); if (!isNaN(dur)) totalDuration += dur; }
            else if (t && !t.startsWith('#')) { try { segments.push(new URL(t, url).href); } catch (_) {} }
        }
        return { mapUri, segments, totalDuration, rawText: text };
    }

    function estimateFileSize(duration) { return duration * ESTIMATED_BITRATE / 8 * 1.1; }

    function downloadSegment(url, referer, signal, retries = MAX_RETRIES) {
        return new Promise((resolve, reject) => {
            const attempt = (n) => {
                if (signal && signal.aborted) return reject(new Error('aborted'));
                const xhr = GM_xmlhttpRequest({
                    method: 'GET', url, responseType: 'blob', timeout: REQUEST_TIMEOUT,
                    headers: { 'Referer': referer, 'Origin': new URL(referer).origin },
                    onload: r => { if (signal && signal.aborted) return reject(new Error('aborted')); if (r.status >= 200 && r.status < 300 && r.response && r.response.size > 0) resolve(r.response); else if (n > 1) setTimeout(() => attempt(n - 1), 500); else reject(new Error(`HTTP ${r.status}`)); },
                    onerror: () => { if (signal && signal.aborted) return reject(new Error('aborted')); if (n > 1) setTimeout(() => attempt(n - 1), 500); else reject(new Error('network')); },
                    ontimeout: () => { if (signal && signal.aborted) return reject(new Error('aborted')); if (n > 1) setTimeout(() => attempt(n - 1), 500); else reject(new Error('timeout')); }
                });
                signal?.addEventListener('abort', () => { try { xhr.abort?.(); } catch(_){} });
            };
            attempt(retries);
        });
    }

    async function getDirectoryHandle() {
        if (savedDirHandle) {
            const state = await savedDirHandle.queryPermission({ mode: 'readwrite' });
            if (state === 'granted') return savedDirHandle;
            if (state === 'prompt') { const ns = await savedDirHandle.requestPermission({ mode: 'readwrite' }); if (ns === 'granted') return savedDirHandle; }
            savedDirHandle = null;
        }
        try { savedDirHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' }); return savedDirHandle; }
        catch (err) { if (err.name === 'AbortError') throw new Error('用户取消'); if (err.name === 'SecurityError' && window.self !== window.top) throw new Error('CrossOriginIframe'); throw err; }
    }

    // ========== 下载控制类 ==========
    class DownloadController {
        constructor(ui, url, concurrency) {
            this.ui = ui; this.url = url; this.concurrency = concurrency;
            this.abortController = null; this.paused = false;
            this.completed = 0; this.total = 0; this.bytes = 0; this.startTime = 0;
            this.mode = 'memory';
            this.writable = null; this.dirHandle = null;
            this.segmentBlobs = [];
            this.mapBlob = null;
            this.currentFilename = ''; this.previousFilename = '';
            this.segments = []; this.mapUri = null;
        }

        async run() {
            const { panel, ball } = this.ui;
            const progressBar = panel.querySelector('.progress-bar');
            const progressText = panel.querySelector('#progress-text');
            const speedText = panel.querySelector('#speed-text');
            const statusText = panel.querySelector('#status-text');
            const downloadBtn = panel.querySelector('#download-btn');
            const pauseBtn = panel.querySelector('#pause-btn');
            const cleanupBtn = panel.querySelector('#cleanup-btn');
            const modeInfo = panel.querySelector('#mode-info');

            progressBar.style.width = '0%'; progressBar.classList.remove('error-bar');
            progressText.textContent = '0%'; speedText.textContent = '0 KB/s';
            statusText.textContent = '📡 正在获取 M3U8...'; statusText.classList.remove('error-text');
            downloadBtn.disabled = true; downloadBtn.classList.remove('retry'); downloadBtn.innerHTML = ICONS.download;
            pauseBtn.disabled = true; pauseBtn.innerHTML = ICONS.pause;
            cleanupBtn.style.display = 'none'; modeInfo.textContent = '';
            ball.classList.remove('done','error');

            try {
                const manifest = await fetchRealM3u8(this.url);
                if (!manifest || !manifest.segments.length) throw new Error('无法解析 M3U8');
                if (manifest.rawText.includes('#EXT-X-KEY:METHOD=AES-128')) {
                    statusText.textContent = '🔐 加密视频，已复制链接'; statusText.classList.add('error-text');
                    GM_setClipboard(this.url, 'text');
                    throw new Error('encrypted');
                }

                this.mapUri = manifest.mapUri;
                this.segments = manifest.segments;
                this.total = this.segments.length;
                this.totalDuration = manifest.totalDuration;
                this.estimatedSize = estimateFileSize(this.totalDuration);
                this.mode = (this.totalDuration > 0 && this.estimatedSize <= SIZE_THRESHOLD) ? 'memory' : 'disk';
                const modeLabel = this.mode === 'disk' ? '边下边存' : '内存下载';
                const sizeEst = this.totalDuration > 0 ? `预估 ${(this.estimatedSize/1024/1024).toFixed(0)}MB` : '无法预估时长';
                modeInfo.textContent = `💡 ${modeLabel} · ${sizeEst}`;

                // 下载初始化段
                if (this.mapUri) {
                    statusText.textContent = `📥 初始化段...`;
                    const blob = await downloadSegment(this.mapUri, this.url, null);
                    this.mapBlob = blob;
                }

                if (this.mode === 'disk') {
                    await this._diskModeRun();
                } else {
                    await this._memoryModeRun();
                }
            } catch (err) {
                if (['encrypted','no-fs','CrossOriginIframe','用户取消'].includes(err.message)) {
                    ball.classList.add('error'); downloadBtn.disabled = false; pauseBtn.disabled = true;
                    return;
                }
                statusText.textContent = '❌ ' + err.message;
                statusText.classList.add('error-text');
                downloadBtn.disabled = false; pauseBtn.disabled = true;
                ball.classList.add('error');
            } finally {
                if (!this.paused) currentDownload = null;
            }
        }

        async _diskModeRun() {
            const { panel, ball } = this.ui;
            const progressBar = panel.querySelector('.progress-bar');
            const progressText = panel.querySelector('#progress-text');
            const speedText = panel.querySelector('#speed-text');
            const statusText = panel.querySelector('#status-text');
            const downloadBtn = panel.querySelector('#download-btn');
            const pauseBtn = panel.querySelector('#pause-btn');
            const cleanupBtn = panel.querySelector('#cleanup-btn');

            try { this.dirHandle = await getDirectoryHandle(); }
            catch (err) {
                if (err.message === 'CrossOriginIframe') { statusText.textContent = '⚠️ 跨域iframe，已复制链接'; GM_setClipboard(this.url, 'text'); throw new Error('CrossOriginIframe'); }
                else if (err.message === '用户取消') { statusText.textContent = '已取消'; downloadBtn.disabled = false; pauseBtn.disabled = true; return; }
                else throw err;
            }
            this.currentFilename = `video_${Date.now()}.mp4`;
            const fh = await this.dirHandle.getFileHandle(this.currentFilename, { create: true });
            this.writable = await fh.createWritable();

            if (this.mapBlob) await this.writable.write(this.mapBlob);

            this.completed = 0;
            this.bytes = this.mapBlob ? this.mapBlob.size : 0;
            this.startTime = Date.now();
            this.abortController = new AbortController();

            pauseBtn.disabled = false; pauseBtn.innerHTML = ICONS.pause;
            pauseBtn.onclick = () => this.togglePause();

            const updateProgress = () => {
                const pct = (this.completed / this.total * 100).toFixed(1);
                progressBar.style.width = pct + '%';
                progressText.textContent = `${pct}% (${this.completed}/${this.total})`;
                const elapsed = (Date.now() - this.startTime) / 1000;
                const spd = elapsed > 0 ? (this.bytes / 1024 / elapsed).toFixed(1) : '0';
                speedText.textContent = `${spd} KB/s`;
            };

            statusText.textContent = `📥 下载中 (${this.total} 片段，串行)`;

            for (let i = 0; i < this.segments.length; i++) {
                if (this.paused) {
                    statusText.textContent = '⏸️ 已暂停，点击 ▶ 继续';
                    pauseBtn.disabled = false; downloadBtn.disabled = true;
                    return;
                }
                const segUrl = this.segments[i];
                let success = false;
                while (!success && !this.paused) {
                    try {
                        const blob = await downloadSegment(segUrl, this.url, this.abortController.signal, 9999);
                        if (this.paused) return;
                        await this.writable.write(blob);
                        this.bytes += blob.size;
                        this.completed++;
                        updateProgress();
                        success = true;
                    } catch (err) {
                        if (err.message === 'aborted') return;
                        statusText.textContent = `🔄 片段 ${i+1} 重试中...`;
                    }
                }
            }

            await this.writable.close();
            if (this.paused) {
                statusText.textContent = '⏸️ 已暂停，点击 ▶ 继续';
                pauseBtn.disabled = false; downloadBtn.disabled = true;
                return;
            }

            if (this.previousFilename && this.dirHandle) {
                try { await this.dirHandle.removeEntry(this.previousFilename); } catch(_) {}
            }
            const fileSizeMB = (this.bytes / 1024 / 1024).toFixed(2);
            progressBar.style.width = '100%'; progressBar.classList.remove('error-bar');
            progressText.textContent = '100%'; ball.classList.add('done');
            downloadBtn.disabled = false; pauseBtn.disabled = true;
            downloadBtn.classList.remove('retry'); downloadBtn.innerHTML = ICONS.download;
            cleanupBtn.style.display = 'flex';
            statusText.textContent = `✅ 完成：${this.currentFilename} (${fileSizeMB}MB)`;
            if (typeof GM_notification !== 'undefined') {
                GM_notification({ title: '下载完成', text: `${fileSizeMB}MB`, timeout: 5000 });
            }
        }

        async _memoryModeRun() {
            const { panel, ball } = this.ui;
            const progressBar = panel.querySelector('.progress-bar');
            const progressText = panel.querySelector('#progress-text');
            const speedText = panel.querySelector('#speed-text');
            const statusText = panel.querySelector('#status-text');
            const downloadBtn = panel.querySelector('#download-btn');
            const pauseBtn = panel.querySelector('#pause-btn');
            const cleanupBtn = panel.querySelector('#cleanup-btn');

            this.segmentBlobs = new Array(this.total).fill(null);
            this.completed = 0;
            this.bytes = this.mapBlob ? this.mapBlob.size : 0;
            this.startTime = Date.now();
            const failed = [];
            this.abortController = new AbortController();

            const queue = this.segments.map((url, idx) => ({ url, idx }));
            const concurrency = this.concurrency;

            pauseBtn.disabled = false; pauseBtn.innerHTML = ICONS.pause;
            pauseBtn.onclick = () => this.togglePause();

            const updateProgress = () => {
                const pct = (this.completed / this.total * 100).toFixed(1);
                progressBar.style.width = pct + '%';
                progressText.textContent = `${pct}% (${this.completed}/${this.total})`;
                const elapsed = (Date.now() - this.startTime) / 1000;
                const spd = elapsed > 0 ? (this.bytes / 1024 / elapsed).toFixed(1) : '0';
                speedText.textContent = `${spd} KB/s`;
            };

            statusText.textContent = `📥 下载中 (${this.total} 片段，并发)`;

            const downloadOne = async (segUrl, idx) => {
                try {
                    const blob = await downloadSegment(segUrl, this.url, this.abortController.signal, MAX_RETRIES);
                    if (this.paused) return;
                    this.segmentBlobs[idx] = blob;
                    this.bytes += blob.size;
                    this.completed++;
                    updateProgress();
                } catch (err) {
                    if (err.message === 'aborted') return;
                    failed.push({ url: segUrl, idx });
                    this.completed++;
                    updateProgress();
                }
            };

            const workers = [];
            for (let i = 0; i < concurrency; i++) {
                workers.push((async () => {
                    while (queue.length > 0) {
                        if (this.paused) return;
                        const seg = queue.shift();
                        if (!seg) continue;
                        await downloadOne(seg.url, seg.idx);
                    }
                })());
            }
            await Promise.all(workers);

            for (let round = 0; round < FINAL_RETRY_ROUNDS && failed.length > 0 && !this.paused; round++) {
                statusText.textContent = `🔄 重试 ${round+1}/${FINAL_RETRY_ROUNDS} (${failed.length}个)`;
                const retryList = [...failed];
                failed.length = 0;
                const rworkers = [];
                for (let i = 0; i < concurrency; i++) {
                    rworkers.push((async () => {
                        while (retryList.length > 0) {
                            if (this.paused) return;
                            const item = retryList.shift();
                            try {
                                const blob = await downloadSegment(item.url, this.url, this.abortController.signal, MAX_RETRIES);
                                if (this.paused) return;
                                this.segmentBlobs[item.idx] = blob;
                                this.bytes += blob.size;
                            } catch (err) {
                                if (err.message === 'aborted') return;
                                failed.push(item);
                            }
                        }
                    })());
                }
                await Promise.all(rworkers);
            }

            if (this.paused) {
                statusText.textContent = '⏸️ 已暂停，点击 ▶ 继续';
                pauseBtn.disabled = false; downloadBtn.disabled = true;
                return;
            }

            cleanupBtn.style.display = 'flex';

            if (failed.length === 0) {
                const missing = this.segmentBlobs.findIndex(b => b === null);
                if (missing !== -1) throw new Error(`片段 ${missing} 丢失`);

                const fileSizeMB = (this.bytes / 1024 / 1024).toFixed(2);
                progressBar.style.width = '100%'; progressBar.classList.remove('error-bar');
                progressText.textContent = '100%'; ball.classList.add('done');
                downloadBtn.disabled = false; pauseBtn.disabled = true;
                downloadBtn.classList.remove('retry'); downloadBtn.innerHTML = ICONS.download;

                const blobs = this.mapBlob ? [this.mapBlob, ...this.segmentBlobs] : this.segmentBlobs;
                const finalBlob = new Blob(blobs, { type: 'video/mp4' });
                const blobUrl = URL.createObjectURL(finalBlob);
                const a = document.createElement('a');
                a.href = blobUrl; a.download = `video_${Date.now()}.mp4`;
                document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(blobUrl);
                statusText.textContent = `✅ 完成 (${fileSizeMB}MB)`;
                if (typeof GM_notification !== 'undefined') {
                    GM_notification({ title: '下载完成', text: `${fileSizeMB}MB`, timeout: 5000 });
                }
            } else {
                progressBar.classList.add('error-bar');
                statusText.textContent = `⚠️ ${failed.length}个片段失败，请重试`;
                statusText.classList.add('error-text');
                downloadBtn.disabled = false; pauseBtn.disabled = true;
                downloadBtn.classList.add('retry'); downloadBtn.innerHTML = ICONS.retry;
                ball.classList.add('error');
            }
        }

        togglePause() {
            this.paused = !this.paused;
            if (this.paused) {
                this.abortController.abort();
                this.ui.panel.querySelector('#pause-btn').innerHTML = ICONS.play;
                this.ui.panel.querySelector('#status-text').textContent = '⏸️ 已暂停';
            } else {
                this.abortController = new AbortController();
                this.ui.panel.querySelector('#pause-btn').innerHTML = ICONS.pause;
                this.run();
            }
        }

        manualCleanup() {
            let releasedSize = this.bytes || 0;
            const releasedMB = (releasedSize / 1024 / 1024).toFixed(2);
            this.cleanup();
            this.ui.panel.querySelector('#cleanup-btn').style.display = 'none';
            this.ui.panel.querySelector('#status-text').textContent = `🗑️ 已释放 ${releasedMB} MB 内存`;
        }

        cleanup() {
            this.segmentBlobs = null; this.mapBlob = null; this.segments = null;
            if (this.abortController) { try { this.abortController.abort(); } catch(_) {} this.abortController = null; }
            if (this.writable) { try { this.writable.close(); } catch(_) {} this.writable = null; }
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
            <div class="status-text" id="status-text">就绪</div>
            <span class="mode-info" id="mode-info"></span>
        `;
        document.body.appendChild(panel);

        const linkIcon = panel.querySelector('#link-icon'); const urlInput = panel.querySelector('#url-input');
        linkIcon.addEventListener('click', async (e) => { e.stopPropagation(); const link = urlInput.value.trim(); if (!link) return; const ok = await copyToClipboard(link); if (ok) { linkIcon.classList.add('copied'); linkIcon.innerHTML = ICONS.check; setTimeout(() => { linkIcon.classList.remove('copied'); linkIcon.innerHTML = ICONS.link; }, 1500); panel.querySelector('#status-text').textContent = '✅ 已复制'; setTimeout(() => { panel.querySelector('#status-text').textContent = '就绪'; }, 1500); } });
        const refreshIcon = panel.querySelector('#refresh-icon');
        refreshIcon.addEventListener('click', (e) => { e.stopPropagation(); const newUrl = sniffM3u8(); if (newUrl) { urlInput.value = newUrl; panel.querySelector('#status-text').textContent = '✅ 已更新链接'; ball.classList.add('has-url'); } else { panel.querySelector('#status-text').textContent = '⚠️ 未检测到 M3U8 链接'; } setTimeout(() => { panel.querySelector('#status-text').textContent = '就绪'; }, 1500); });

        let selThreads = 16;
        panel.querySelectorAll('.thread-chip').forEach(c => c.addEventListener('click', (e) => { e.stopPropagation(); panel.querySelectorAll('.thread-chip').forEach(x => x.classList.remove('active')); c.classList.add('active'); selThreads = parseInt(c.dataset.threads, 10); }));

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
            const ballRect = ball.getBoundingClientRect();
            const panelWidth = panel.getBoundingClientRect().width;
            const panelHeight = panel.getBoundingClientRect().height;
            const windowW = window.innerWidth;
            const windowH = window.innerHeight;
            let left, right;
            if (edge === 'left') { left = ballRect.right + 10; if (left + panelWidth > windowW) left = windowW - panelWidth - 10; }
            else { right = windowW - ballRect.left + 10; if (right + panelWidth > windowW) right = windowW - panelWidth - 10; }
            if (edge === 'left') { panel.style.left = left + 'px'; panel.style.right = 'auto'; }
            else { panel.style.right = right + 'px'; panel.style.left = 'auto'; }
            let top = ballRect.top - 10;
            if (top + panelHeight > windowH) top = windowH - panelHeight - 10;
            if (top < 10) top = 10;
            panel.style.top = top + 'px';
        }
        window.addEventListener('resize', () => { if (panel.classList.contains('open')) positionPanel(); });

        return {
            ball, panel,
            showBall: () => { ball.style.display = 'flex'; },
            hideBall: () => { ball.style.display = 'none'; },
            setUrl: (url) => { urlInput.value = url; ball.classList.add('has-url'); },
            getConcurrency: () => selThreads,
            getUrl: () => urlInput.value.trim()
        };
    }

    function monitorVideoPlay(ui) {
        document.querySelectorAll('video').forEach(v => v.addEventListener('play', () => { const u = sniffM3u8(); if (u) { ui.setUrl(u); ui.showBall(); } }, { once: true }));
        const observer = new MutationObserver(muts => { muts.forEach(m => { m.addedNodes.forEach(n => { if (n.nodeName === 'VIDEO') n.addEventListener('play', () => { const u = sniffM3u8(); if (u) { ui.setUrl(u); ui.showBall(); } }, { once: true }); else if (n.querySelectorAll) n.querySelectorAll('video').forEach(v => v.addEventListener('play', () => { const u = sniffM3u8(); if (u) { ui.setUrl(u); ui.showBall(); } }, { once: true })); }); }); });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function init() {
        const ui = createUI();
        const sniffed = sniffM3u8(); if (sniffed) { ui.setUrl(sniffed); ui.showBall(); }
        monitorVideoPlay(ui);
        const origFetch = window.fetch; window.fetch = async function(...args) { const resp = await origFetch.apply(this, args); try { const u = typeof args[0] === 'string' ? args[0] : args[0]?.url; if (u?.includes('.m3u8')) { ui.setUrl(u); ui.showBall(); } } catch(_) {} return resp; };
        const origOpen = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(method, url) { if (url?.includes('.m3u8')) { ui.setUrl(url); ui.showBall(); } return origOpen.apply(this, arguments); };
        ui.panel.querySelector('#download-btn').addEventListener('click', () => { const url = ui.getUrl(); if (!url) { ui.panel.querySelector('#status-text').textContent = '请输入链接'; return; } if (currentDownload && !currentDownload.paused) { ui.panel.querySelector('#status-text').textContent = '已有下载任务，请先暂停'; return; } currentDownload = new DownloadController(ui, url, ui.getConcurrency()); currentDownload.run(); });
        ui.panel.querySelector('#cleanup-btn').addEventListener('click', () => { if (currentDownload) currentDownload.manualCleanup(); else ui.panel.querySelector('#status-text').textContent = '没有可清理的下载任务'; });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();