// ==UserScript==
// @name         M3U8媒体下载器
// @namespace    https://github.com/520luo/js
// @version      5.0.1
// @description  悬浮球可拖动，多线程下载，智能模式，变体处理，暂停恢复，目录记忆，跨域 iframe 安全回退
// @author       520luo
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setClipboard
// @connect      *
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // ========== 常量 ==========
    const CONCURRENCY_OPTIONS = [8, 16, 32, 64];
    const MAX_RETRIES = 3;
    const FINAL_RETRY_ROUNDS = 2;
    const REQUEST_TIMEOUT = 10000;
    const SIZE_THRESHOLD = 300 * 1024 * 1024;
    const ESTIMATED_BITRATE = 2 * 1024 * 1024;
    const BALL_SIZE = 36;
    const PANEL_WIDTH = 340;

    // ========== 全局状态 ==========
    let savedDirHandle = null;
    let currentDownload = null;

    // ========== 样式 ==========
    const CSS = `
        #m3u8-drag-ball {
            position: fixed; width: ${BALL_SIZE}px; height: ${BALL_SIZE}px; border-radius: 50%;
            background: rgba(20,20,30,0.65); backdrop-filter: blur(16px) saturate(180%); -webkit-backdrop-filter: blur(16px) saturate(180%);
            border: 1px solid rgba(255,255,255,0.28);
            box-shadow: 0 4px 18px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.18), 0 0 10px rgba(255,255,255,0.15);
            cursor: grab; display: none; align-items: center; justify-content: center; color: #fff; font-size: 18px;
            z-index: 2147483646; user-select: none; touch-action: none; transition: box-shadow 0.2s, transform 0.15s; transform: scale(1);
        }
        #m3u8-drag-ball:active { cursor: grabbing; transform: scale(0.92); }
        #m3u8-drag-ball:hover { box-shadow: 0 6px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.22), 0 0 18px rgba(255,255,255,0.3); }
        #m3u8-drag-ball::after { content: ''; position: absolute; top: 0; right: 0; width: 8px; height: 8px; border-radius: 50%; background: transparent; transition: background 0.2s; }
        #m3u8-drag-ball.has-url::after { background: #30d158; }
        #m3u8-drag-ball.done::after { background: #007aff; }
        #m3u8-drag-ball.error::after { background: #ff3b30; }

        .m3u8-panel {
            position: fixed; width: ${PANEL_WIDTH}px; background: rgba(20,20,30,0.75); backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%);
            border: 1px solid rgba(255,255,255,0.22); border-radius: 18px; padding: 16px;
            box-shadow: 0 14px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15);
            color: #fff; font-family: system-ui, -apple-system, sans-serif; opacity: 0; pointer-events: none;
            transform: translateY(6px) scale(0.96); transition: opacity 0.2s ease, transform 0.25s cubic-bezier(.34,1.56,.64,1); z-index: 2147483645;
        }
        .m3u8-panel.open { opacity: 1; pointer-events: auto; transform: translateY(0) scale(1); }

        .input-group { display: flex; align-items: stretch; margin-bottom: 10px; border-radius: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.25); background: rgba(255,255,255,0.08); }
        .input-icon { width: 38px; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.7); flex-shrink: 0; border-right: 1px solid rgba(255,255,255,0.15); cursor: pointer; transition: all 0.15s; }
        .input-icon:hover { background: rgba(255,255,255,0.15); color: #fff; } .input-icon:active { transform: scale(0.92); }
        .input-icon.copied { background: rgba(0,122,255,0.3); color: #fff; } .input-icon svg { width: 16px; height: 16px; stroke: currentColor; }
        .m3u8-input { flex: 1; padding: 10px 12px; border: none; background: transparent; color: #fff; font-size: 13px; outline: none; box-sizing: border-box; min-width: 0; }
        .m3u8-input::placeholder { color: rgba(255,255,255,0.4); }
        .input-group:focus-within { border-color: rgba(255,255,255,0.6); box-shadow: 0 0 0 2px rgba(255,255,255,0.15); }

        .thread-row { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }
        .thread-label { font-size: 12px; opacity: 0.8; margin-right: 4px; }
        .thread-chip { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.25); border-radius: 8px; padding: 4px 10px; font-size: 12px; font-weight: 600; color: #fff; cursor: pointer; transition: all 0.15s; }
        .thread-chip:hover { background: rgba(255,255,255,0.2); } .thread-chip.active { background: #007aff; border-color: #007aff; color: #fff; }

        .ios-glass-btn { appearance: none; -webkit-appearance: none; border: 1px solid rgba(255,255,255,0.28); margin: 0; padding: 0; outline: none; font-family: inherit; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: #fff; cursor: pointer; background: rgba(20,20,20,0.4); -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%); box-shadow: 0 4px 18px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.18), 0 0 10px rgba(255,255,255,0.15); transition: transform 0.22s cubic-bezier(.34,1.56,.64,1), background 0.15s, box-shadow 0.15s; transform: scale(1); width: 40px; height: 40px; }
        .ios-glass-btn:hover { background: rgba(46,46,46,0.5); box-shadow: 0 6px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.22), 0 0 18px rgba(255,255,255,0.3); }
        .ios-glass-btn:active { transform: scale(0.92); } .ios-glass-btn:disabled { opacity: 0.4; pointer-events: none; } .ios-glass-btn svg { width: 18px; height: 18px; }
        .ios-glass-btn.download-btn { background: rgba(0,122,255,0.3); border-color: rgba(0,122,255,0.5); }
        .ios-glass-btn.download-btn:hover { background: rgba(0,122,255,0.45); }
        .ios-glass-btn.download-btn.retry { background: rgba(255,159,10,0.3); border-color: rgba(255,159,10,0.5); }
        .ios-glass-btn.download-btn.retry:hover { background: rgba(255,159,10,0.45); }
        .ios-glass-btn.pause-btn { background: rgba(255,255,255,0.1); }

        .progress-wrap { height: 8px; background: rgba(255,255,255,0.12); border-radius: 4px; overflow: hidden; margin: 10px 0; }
        .progress-bar { height: 100%; background: #007aff; width: 0%; transition: width 0.3s; } .progress-bar.error-bar { background: #ff9f0a; }
        .info-row { display: flex; justify-content: space-between; font-size: 11px; opacity: 0.8; margin-bottom: 4px; }
        .status-text { font-size: 12px; opacity: 0.8; word-break: break-all; line-height: 1.4; } .status-text.error-text { color: #ff9f0a; }
    `;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // ========== 图标 ==========
    const ICONS = {
        link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
        download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>`,
        pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
        play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
        retry: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10a9 9 0 1 0-3 7.7"/><path d="M21 4v6h-6"/></svg>`,
        check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
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

    async function fetchRealM3u8(url) {
        const text = await new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: REQUEST_TIMEOUT,
                onload: r => resolve(r.responseText),
                onerror: () => resolve(null), ontimeout: () => resolve(null)
            });
        });
        if (!text) return null;

        if (text.includes('#EXT-X-STREAM-INF')) {
            const lines = text.split('\n');
            let bestBandwidth = 0, bestUrl = '';
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('#EXT-X-STREAM-INF')) {
                    const bw = parseInt((line.match(/BANDWIDTH=(\d+)/) || [])[1]) || 0;
                    if (i + 1 < lines.length) {
                        const sub = lines[i + 1].trim();
                        if (sub && !sub.startsWith('#')) {
                            if (bw > bestBandwidth) { bestBandwidth = bw; bestUrl = sub; }
                        }
                    }
                }
            }
            if (bestUrl) return fetchRealM3u8(new URL(bestUrl, url).href);
            return null;
        }

        const lines = text.split('\n');
        let mapUri = null;
        const segments = [];
        let totalDuration = 0;
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('#EXT-X-MAP:URI=')) {
                const m = t.match(/URI="([^"]+)"/);
                if (m) mapUri = new URL(m[1], url).href;
            } else if (t.startsWith('#EXTINF:')) {
                const dur = parseFloat(t.split(':')[1].replace(',', ''));
                if (!isNaN(dur)) totalDuration += dur;
            } else if (t && !t.startsWith('#')) {
                try { segments.push(new URL(t, url).href); } catch (_) {}
            }
        }
        return { mapUri, segments, totalDuration, rawText: text };
    }

    function estimateFileSize(duration) {
        return duration * ESTIMATED_BITRATE / 8 * 1.1;
    }

    function downloadSegment(url, referer, signal, retries = MAX_RETRIES) {
        return new Promise((resolve, reject) => {
            const attempt = (n) => {
                if (signal && signal.aborted) return reject(new Error('aborted'));
                const xhr = GM_xmlhttpRequest({
                    method: 'GET', url, responseType: 'blob', timeout: REQUEST_TIMEOUT,
                    headers: { 'Referer': referer, 'Origin': new URL(referer).origin },
                    onload: r => {
                        if (signal && signal.aborted) return reject(new Error('aborted'));
                        if (r.status >= 200 && r.status < 300 && r.response && r.response.size > 0) resolve(r.response);
                        else if (n > 1) setTimeout(() => attempt(n - 1), 500);
                        else reject(new Error(`HTTP ${r.status}`));
                    },
                    onerror: () => {
                        if (signal && signal.aborted) return reject(new Error('aborted'));
                        if (n > 1) setTimeout(() => attempt(n - 1), 500);
                        else reject(new Error('network'));
                    },
                    ontimeout: () => {
                        if (signal && signal.aborted) return reject(new Error('aborted'));
                        if (n > 1) setTimeout(() => attempt(n - 1), 500);
                        else reject(new Error('timeout'));
                    }
                });
                signal?.addEventListener('abort', () => { try { xhr.abort?.(); } catch(_){} });
            };
            attempt(retries);
        });
    }

    async function getDirectoryHandle() {
        if (savedDirHandle) {
            try { for await (const _ of savedDirHandle.values()) break; return savedDirHandle; }
            catch (e) { savedDirHandle = null; }
        }
        try {
            savedDirHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
            return savedDirHandle;
        } catch (err) {
            if (err.name === 'AbortError') throw new Error('用户取消');
            // 跨域 iframe 无法使用文件选择器
            if (err.name === 'SecurityError' && window.self !== window.top) {
                throw new Error('CrossOriginIframe');
            }
            throw err;
        }
    }

    // ========== 下载控制类 ==========
    class DownloadController {
        constructor(ui, url, concurrency) {
            this.ui = ui;
            this.url = url;
            this.concurrency = concurrency;
            this.abortController = null;
            this.paused = false;
            this.queue = [];
            this.failed = [];
            this.completed = 0;
            this.total = 0;
            this.bytes = 0;
            this.startTime = 0;
            this.mode = 'memory';
            this.writable = null;
            this.dirHandle = null;
            this.memoryBlobs = [];
            this.currentFilename = '';
            this.previousFilename = '';
            this.segments = [];
            this.mapUri = null;
        }

        async run() {
            const { panel, ball } = this.ui;
            const progressBar = panel.querySelector('.progress-bar');
            const progressText = panel.querySelector('#progress-text');
            const speedText = panel.querySelector('#speed-text');
            const statusText = panel.querySelector('#status-text');
            const downloadBtn = panel.querySelector('#download-btn');
            const pauseBtn = panel.querySelector('#pause-btn');

            progressBar.style.width = '0%'; progressBar.classList.remove('error-bar');
            progressText.textContent = '0%'; speedText.textContent = '0 KB/s';
            statusText.textContent = '📡 获取 M3U8...'; statusText.classList.remove('error-text');
            downloadBtn.disabled = true; downloadBtn.classList.remove('retry'); downloadBtn.innerHTML = ICONS.download;
            pauseBtn.disabled = true; pauseBtn.innerHTML = ICONS.pause;
            ball.classList.remove('done','error');

            try {
                const manifest = await fetchRealM3u8(this.url);
                if (!manifest || !manifest.segments.length) {
                    throw new Error('无法解析 M3U8');
                }

                if (manifest.rawText.includes('#EXT-X-KEY:METHOD=AES-128')) {
                    statusText.textContent = '🔐 加密视频，已复制链接';
                    statusText.classList.add('error-text');
                    GM_setClipboard(this.url, 'text');
                    throw new Error('encrypted');
                }

                this.mapUri = manifest.mapUri;
                this.segments = manifest.segments;
                this.total = this.segments.length;
                this.totalDuration = manifest.totalDuration;
                this.estimatedSize = estimateFileSize(this.totalDuration);
                this.mode = (this.estimatedSize > SIZE_THRESHOLD || this.totalDuration === 0) ? 'disk' : 'memory';
                const modeLabel = this.mode === 'disk' ? '边下边存' : '内存下载';
                const sizeEst = this.totalDuration > 0 ? `预估 ${(this.estimatedSize/1024/1024).toFixed(0)}MB` : '无法预估';

                if (this.mode === 'disk') {
                    try {
                        this.dirHandle = await getDirectoryHandle();
                    } catch (err) {
                        if (err.message === 'CrossOriginIframe') {
                            statusText.textContent = '⚠️ 当前页面为跨域 iframe，无法使用边下边存，已复制链接，请使用外部工具下载';
                            GM_setClipboard(this.url, 'text');
                            throw new Error('CrossOriginIframe');
                        } else if (err.message === '用户取消') {
                            statusText.textContent = '已取消';
                            throw new Error('用户取消');
                        } else {
                            throw err;
                        }
                    }
                    if (typeof window.showDirectoryPicker !== 'function') {
                        statusText.textContent = '⚠️ 浏览器不支持边下边存，已复制链接';
                        GM_setClipboard(this.url, 'text');
                        throw new Error('no-fs');
                    }
                    this.currentFilename = `video_${Date.now()}.mp4`;
                    const fh = await this.dirHandle.getFileHandle(this.currentFilename, { create: true });
                    this.writable = await fh.createWritable();
                }

                if (this.mapUri) {
                    statusText.textContent = `📥 初始化段 (${modeLabel})...`;
                    const blob = await downloadSegment(this.mapUri, this.url, null);
                    if (this.mode === 'disk') await this.writable.write(blob);
                    else this.memoryBlobs.push(blob);
                }

                this.queue = this.segments.slice();
                this.completed = 0;
                this.bytes = 0;
                this.startTime = Date.now();
                this.failed = [];
                this.abortController = new AbortController();

                pauseBtn.disabled = false;
                pauseBtn.innerHTML = ICONS.pause;
                pauseBtn.onclick = () => this.togglePause();

                const updateProgress = () => {
                    const pct = (this.completed / this.total * 100).toFixed(1);
                    progressBar.style.width = pct + '%';
                    progressText.textContent = `${pct}% (${this.completed}/${this.total})`;
                    const elapsed = (Date.now() - this.startTime) / 1000;
                    const spd = elapsed > 0 ? (this.bytes / 1024 / elapsed).toFixed(1) : '0';
                    speedText.textContent = `${spd} KB/s`;
                };

                const workers = [];
                for (let i = 0; i < this.concurrency; i++) {
                    workers.push((async () => {
                        while (this.queue.length > 0) {
                            if (this.paused) { await new Promise(r => setTimeout(r, 200)); continue; }
                            const segUrl = this.queue.shift();
                            if (!segUrl) continue;
                            try {
                                const blob = await downloadSegment(segUrl, this.url, this.abortController.signal);
                                if (this.paused) { this.queue.unshift(segUrl); continue; }
                                if (this.mode === 'disk') await this.writable.write(blob);
                                else this.memoryBlobs.push(blob);
                                this.bytes += blob.size;
                                this.completed++;
                                updateProgress();
                            } catch (err) {
                                if (err.message === 'aborted') { this.queue.unshift(segUrl); continue; }
                                this.failed.push({ url: segUrl, idx: this.completed });
                                this.completed++;
                                updateProgress();
                            }
                        }
                    })());
                }
                await Promise.all(workers);

                for (let round = 0; round < FINAL_RETRY_ROUNDS && this.failed.length > 0 && !this.paused; round++) {
                    statusText.textContent = `🔄 重试第 ${round+1}/${FINAL_RETRY_ROUNDS} 轮 (${this.failed.length}个失败)`;
                    const retryList = [...this.failed];
                    this.failed = [];
                    const retryWorkers = [];
                    for (let i = 0; i < this.concurrency; i++) {
                        retryWorkers.push((async () => {
                            while (retryList.length > 0) {
                                if (this.paused) { await new Promise(r => setTimeout(r, 200)); continue; }
                                const item = retryList.shift();
                                try {
                                    const blob = await downloadSegment(item.url, this.url, this.abortController.signal);
                                    if (this.paused) { retryList.unshift(item); continue; }
                                    if (this.mode === 'disk') await this.writable.write(blob);
                                    else this.memoryBlobs.push(blob);
                                    this.bytes += blob.size;
                                } catch (err) {
                                    if (err.message === 'aborted') { retryList.unshift(item); continue; }
                                    this.failed.push(item);
                                }
                            }
                        })());
                    }
                    await Promise.all(retryWorkers);
                }

                if (this.writable) { try { await this.writable.close(); } catch(_){} }

                if (this.paused) {
                    statusText.textContent = '⏸️ 已暂停，点击 ▶ 继续';
                    pauseBtn.disabled = false;
                    downloadBtn.disabled = true;
                    return;
                }

                if (this.failed.length === 0) {
                    if (this.previousFilename && this.dirHandle) {
                        try { await this.dirHandle.removeEntry(this.previousFilename); } catch(_){}
                    }
                    const sizeMB = (this.bytes / 1024 / 1024).toFixed(2);
                    progressBar.style.width = '100%'; progressBar.classList.remove('error-bar');
                    progressText.textContent = '100%'; ball.classList.add('done');
                    downloadBtn.disabled = false; pauseBtn.disabled = true;
                    downloadBtn.classList.remove('retry'); downloadBtn.innerHTML = ICONS.download;

                    if (this.mode === 'disk') {
                        statusText.textContent = `✅ 完成：${this.currentFilename} (${sizeMB}MB)`;
                    } else {
                        const blob = new Blob(this.memoryBlobs, { type: 'video/mp4' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a'); a.href = url; a.download = `video_${Date.now()}.mp4`;
                        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
                        statusText.textContent = `✅ 完成 (${sizeMB}MB)`;
                    }
                    if (typeof GM_notification !== 'undefined') {
                        GM_notification({ title: '下载完成', text: `${sizeMB}MB`, timeout: 5000 });
                    }
                } else {
                    progressBar.classList.add('error-bar');
                    statusText.textContent = `⚠️ ${this.failed.length}个片段失败，请重试`;
                    statusText.classList.add('error-text');
                    if (this.mode === 'disk') this.previousFilename = this.currentFilename;
                    downloadBtn.disabled = false; pauseBtn.disabled = true;
                    downloadBtn.classList.add('retry'); downloadBtn.innerHTML = ICONS.retry;
                    ball.classList.add('error');
                }
            } catch (err) {
                if (err.message === 'encrypted' || err.message === 'no-fs' || err.message === 'CrossOriginIframe' || err.message === '用户取消') {
                    ball.classList.add('error');
                    downloadBtn.disabled = false;
                    pauseBtn.disabled = true;
                    return;
                }
                statusText.textContent = '❌ ' + err.message;
                statusText.classList.add('error-text');
                downloadBtn.disabled = false; pauseBtn.disabled = true;
                ball.classList.add('error');
            } finally {
                if (!this.paused) {
                    this.cleanup();
                }
                currentDownload = null;
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
                this.ui.panel.querySelector('#status-text').textContent = '📥 继续下载...';
                this.run();
            }
        }

        cleanup() {
            if (this.memoryBlobs) {
                this.memoryBlobs.forEach(b => b = null);
                this.memoryBlobs = null;
            }
            this.queue = null;
            this.segments = null;
            this.failed = null;
            if (this.abortController) {
                try { this.abortController.abort(); } catch(_){}
                this.abortController = null;
            }
            if (this.writable) {
                try { this.writable.close(); } catch(_){}
                this.writable = null;
            }
        }
    }

    // ========== UI 创建 ==========
    function createUI() {
        const ball = document.createElement('div');
        ball.id = 'm3u8-drag-ball';
        ball.innerHTML = '🎬';
        ball.title = 'M3U8 下载';
        document.body.appendChild(ball);

        const panel = document.createElement('div');
        panel.className = 'm3u8-panel';
        panel.innerHTML = `
            <div class="input-group">
                <div class="input-icon" id="link-icon" title="复制链接">${ICONS.link}</div>
                <input class="m3u8-input" type="text" placeholder="m3u8 链接" id="url-input">
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
            </div>
            <div class="progress-wrap"><div class="progress-bar"></div></div>
            <div class="info-row">
                <span id="progress-text">0%</span>
                <span id="speed-text">0 KB/s</span>
            </div>
            <div class="status-text" id="status-text">就绪</div>
        `;
        document.body.appendChild(panel);

        const linkIcon = panel.querySelector('#link-icon');
        const urlInput = panel.querySelector('#url-input');
        linkIcon.addEventListener('click', async (e) => {
            e.stopPropagation();
            const link = urlInput.value.trim();
            if (!link) return;
            if (await copyToClipboard(link)) {
                linkIcon.classList.add('copied');
                linkIcon.innerHTML = ICONS.check;
                setTimeout(() => { linkIcon.classList.remove('copied'); linkIcon.innerHTML = ICONS.link; }, 1500);
                const st = panel.querySelector('#status-text');
                st.textContent = '✅ 已复制';
                setTimeout(() => { st.textContent = '就绪'; }, 1500);
            }
        });

        let selThreads = 16;
        const chips = panel.querySelectorAll('.thread-chip');
        chips.forEach(c => c.addEventListener('click', (e) => {
            e.stopPropagation();
            chips.forEach(x => x.classList.remove('active'));
            c.classList.add('active');
            selThreads = parseInt(c.dataset.threads);
        }));

        let dragging = false, edge = 'right', sx = 0, sy = 0, sTop = 0;
        const updateEdge = () => {
            const r = ball.getBoundingClientRect();
            edge = (r.left + r.width/2) < window.innerWidth/2 ? 'left' : 'right';
            ball.style.left = edge === 'left' ? '8px' : 'auto';
            ball.style.right = edge === 'right' ? '8px' : 'auto';
        };
        ball.style.top = '80px'; ball.style.right = '12px';
        ball.addEventListener('pointerdown', e => {
            if (e.target !== ball) return;
            dragging = true; ball.setPointerCapture(e.pointerId); e.preventDefault();
            sx = e.clientX; sy = e.clientY; sTop = ball.getBoundingClientRect().top; updateEdge();
        });
        window.addEventListener('pointermove', e => {
            if (!dragging) return;
            const dx = e.clientX - sx, dy = e.clientY - sy;
            if (Math.abs(dx) > BALL_SIZE/2) {
                if (dx > 0 && edge === 'right') { edge = 'left'; sx = e.clientX; ball.style.left = '8px'; ball.style.right = 'auto'; }
                else if (dx < 0 && edge === 'left') { edge = 'right'; sx = e.clientX; ball.style.right = '8px'; ball.style.left = 'auto'; }
                sTop = ball.getBoundingClientRect().top; sy = e.clientY; return;
            }
            ball.style.top = Math.max(0, Math.min(sTop + dy, window.innerHeight - BALL_SIZE)) + 'px';
        });
        window.addEventListener('pointerup', () => { dragging = false; });
        window.addEventListener('resize', () => { if (!dragging) updateEdge(); });

        ball.addEventListener('click', () => {
            if (dragging) return;
            panel.classList.toggle('open');
            if (panel.classList.contains('open')) {
                const br = ball.getBoundingClientRect();
                panel.style.top = Math.max(10, br.top - 10) + 'px';
                panel.style.left = edge === 'left' ? (br.right + 10) + 'px' : 'auto';
                panel.style.right = edge === 'right' ? (window.innerWidth - br.left + 10) + 'px' : 'auto';
            }
        });
        document.addEventListener('click', e => {
            if (!panel.contains(e.target) && e.target !== ball) panel.classList.remove('open');
        });

        return {
            ball, panel,
            showBall: () => { ball.style.display = 'flex'; },
            hideBall: () => { ball.style.display = 'none'; },
            setUrl: (url) => { urlInput.value = url; ball.classList.add('has-url'); },
            getConcurrency: () => selThreads,
            getUrl: () => urlInput.value.trim()
        };
    }

    function init() {
        const ui = createUI();

        const sniffed = sniffM3u8();
        if (sniffed) { ui.setUrl(sniffed); ui.showBall(); }

        const origFetch = window.fetch;
        window.fetch = async function(...args) {
            const resp = await origFetch.apply(this, args);
            try { const u = typeof args[0] === 'string' ? args[0] : args[0]?.url; if (u?.includes('.m3u8')) { ui.setUrl(u); ui.showBall(); } } catch(_) {}
            return resp;
        };
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
            if (url?.includes('.m3u8')) { ui.setUrl(url); ui.showBall(); }
            return origOpen.apply(this, arguments);
        };

        document.querySelectorAll('video').forEach(v => v.addEventListener('play', () => {
            const u = sniffM3u8(); if (u) { ui.setUrl(u); ui.showBall(); }
        }, { once: true }));

        const downloadBtn = ui.panel.querySelector('#download-btn');
        downloadBtn.addEventListener('click', () => {
            const url = ui.getUrl();
            if (!url) { ui.panel.querySelector('#status-text').textContent = '请输入链接'; return; }
            if (currentDownload && !currentDownload.paused) {
                ui.panel.querySelector('#status-text').textContent = '已有下载任务，请先暂停';
                return;
            }
            currentDownload = new DownloadController(ui, url, ui.getConcurrency());
            currentDownload.run();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();