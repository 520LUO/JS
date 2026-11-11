// ==UserScript==
// @name         网站HTTP/3协议探测器
// @namespace    https://github.com/520luo/js/h3-detector
// @version      1.2
// @description  检测网站是否支持H3/QUIC，以及当前连接所使用的协议类型
// @author       520luo
// @icon         https://raw.githubusercontent.com/520LUO/icons/refs/heads/main/h3.png
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      *
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置 ====================
    const CONFIG = {
        ballSize: 22,
        fontSize: 10,
        collapsedLeft: -16,          // 隐藏时 left（只露出光晕）
        expandedLeft: 14,            // 展开时 left
        bottom: 18,
        autoCollapseDelay: 10000,    // 10秒无操作自动隐藏
        glowIntensity: {
            h3: '0 0 6px 3px rgba(34, 197, 94, 0.7), 0 0 14px 6px rgba(34, 197, 94, 0.35), 0 0 24px 10px rgba(34, 197, 94, 0.18)',
            other: '0 0 6px 3px rgba(234, 179, 8, 0.7), 0 0 14px 6px rgba(234, 179, 8, 0.35), 0 0 24px 10px rgba(234, 179, 8, 0.18)',
            unknown: '0 0 6px 3px rgba(156, 163, 175, 0.55), 0 0 14px 6px rgba(156, 163, 175, 0.25), 0 0 24px 10px rgba(156, 163, 175, 0.12)',
        },
        zIndex: 2147483646,
    };

    // ==================== 状态 ====================
    const state = {
        currentProtocol: null,
        allResourceProtocols: new Set(),
        altSvcInfo: null,
        isH3Supported: null,
        detectionComplete: false,
        ballExpanded: false,
        autoCollapseTimer: null,     // 自动隐藏计时器
    };

    // ==================== 工具函数 ====================
    function formatProtocol(protocol) {
        if (!protocol || protocol === '') return '未知';
        const map = {
            'h3': 'HTTP/3 (QUIC)',
            'h3-29': 'HTTP/3 (QUIC v29)',
            'h3-32': 'HTTP/3 (QUIC v32)',
            'h2': 'HTTP/2',
            'h2c': 'HTTP/2 (明文)',
            'http/1.1': 'HTTP/1.1',
            'http/1.0': 'HTTP/1.0',
            'quic': 'QUIC',
        };
        const lower = (protocol || '').toLowerCase();
        if (lower.startsWith('h3')) return 'HTTP/3 (QUIC)';
        return map[lower] || protocol.toUpperCase();
    }

    function getShortLabel(protocol) {
        if (!protocol || protocol === '') return '?';
        const lower = protocol.toLowerCase();
        if (lower.startsWith('h3') || lower === 'quic') return 'h3';
        if (lower === 'h2' || lower === 'h2c') return 'h2';
        if (lower === 'http/1.1' || lower === 'http/1.0') return 'h1';
        return '?';
    }

    function isH3Protocol(protocol) {
        if (!protocol) return false;
        const lower = protocol.toLowerCase();
        return lower.startsWith('h3') || lower === 'quic';
    }

    // ==================== 协议检测 ====================
    function detectCurrentProtocol() {
        try {
            const navEntries = performance.getEntriesByType('navigation');
            if (navEntries && navEntries.length > 0) {
                const protocol = navEntries[0].nextHopProtocol;
                if (protocol && protocol !== '') return protocol;
            }
            return null;
        } catch (e) { return null; }
    }

    function collectResourceProtocols() {
        try {
            const entries = performance.getEntriesByType('resource');
            const protocols = new Set();
            for (const entry of entries) {
                if (entry.nextHopProtocol && entry.nextHopProtocol !== '') {
                    protocols.add(entry.nextHopProtocol.toLowerCase());
                }
            }
            return protocols;
        } catch (e) { return new Set(); }
    }

    async function probeWithFetch() {
        try {
            const probeUrl = window.location.origin + '/favicon.ico?_h3probe=' + Date.now();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            await fetch(probeUrl, { method: 'HEAD', cache: 'no-store', signal: controller.signal }).catch(() => {});
            clearTimeout(timeoutId);
            await new Promise(resolve => setTimeout(resolve, 200));
            const entries = performance.getEntriesByType('resource');
            for (let i = entries.length - 1; i >= 0; i--) {
                const entry = entries[i];
                if (entry.name && entry.name.includes('_h3probe=')) {
                    if (entry.nextHopProtocol && entry.nextHopProtocol !== '') return entry.nextHopProtocol;
                    break;
                }
            }
            return null;
        } catch (e) { return null; }
    }

    function detectAltSvc() {
        return new Promise((resolve) => {
            if (typeof GM_xmlhttpRequest !== 'function') { resolve(null); return; }
            try {
                GM_xmlhttpRequest({
                    method: 'HEAD',
                    url: window.location.origin + '/',
                    headers: { 'Accept': '*/*' },
                    responseHeaders: true,
                    timeout: 5000,
                    onload: function (response) {
                        try {
                            let altSvc = null;
                            if (response.responseHeaders) {
                                const headers = response.responseHeaders;
                                if (typeof headers === 'string') {
                                    const match = headers.match(/^alt-svc:\s*(.+)$/im);
                                    if (match) altSvc = match[1].trim();
                                } else if (typeof headers === 'object') {
                                    altSvc = headers['alt-svc'] || headers['Alt-Svc'] || null;
                                }
                            }
                            resolve(altSvc);
                        } catch (e) { resolve(null); }
                    },
                    onerror: () => resolve(null),
                    ontimeout: () => resolve(null),
                });
            } catch (e) { resolve(null); }
        });
    }

    function parseAltSvc(altSvcString) {
        if (!altSvcString) return [];
        const protocols = new Set();
        const parts = altSvcString.split(',');
        for (const part of parts) {
            const match = part.trim().match(/^([a-zA-Z0-9][a-zA-Z0-9-]*)/);
            if (match) protocols.add(match[1].toLowerCase());
        }
        return [...protocols];
    }

    function evaluateH3Support(currentProtocol, resourceProtocols, altSvcProtocols) {
        const allProtocols = new Set([
            ...(currentProtocol ? [currentProtocol.toLowerCase()] : []),
            ...resourceProtocols,
            ...(altSvcProtocols || []).map(p => p.toLowerCase()),
        ]);
        for (const proto of allProtocols) {
            if (proto.startsWith('h3') || proto === 'quic') return true;
        }
        return false;
    }

    // ==================== UI 组件 ====================
    function injectStyles() {
        const css = `
            #h3-detector-ball {
                position: fixed;
                width: ${CONFIG.ballSize}px;
                height: ${CONFIG.ballSize}px;
                border-radius: 50%;
                bottom: ${CONFIG.bottom}px;
                left: ${CONFIG.collapsedLeft}px;
                z-index: ${CONFIG.zIndex};
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                user-select: none;
                -webkit-user-select: none;
                -webkit-tap-highlight-color: transparent;
                transition: left 0.3s cubic-bezier(0.22, 0.61, 0.36, 1), transform 0.2s ease, box-shadow 0.4s ease;
                animation: h3-ball-pulse 2.5s ease-in-out infinite;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-weight: 700;
                font-size: ${CONFIG.fontSize}px;
                line-height: 1;
                color: #fff;
                text-shadow: 0 1px 2px rgba(0,0,0,0.3);
                border: 1.5px solid rgba(255,255,255,0.25);
                box-sizing: border-box;
                pointer-events: auto;
                text-transform: lowercase;
            }
            #h3-detector-ball.expanded {
                left: ${CONFIG.expandedLeft}px;
            }
            #h3-detector-ball:hover {
                transform: scale(1.12);
            }
            #h3-detector-ball:active {
                transform: scale(0.94);
            }
            #h3-detector-ball.h3-protocol {
                background: radial-gradient(circle at 35% 35%, #4ade80, #16a34a 70%, #15803d 100%);
                box-shadow: ${CONFIG.glowIntensity.h3};
                border-color: rgba(255,255,255,0.35);
            }
            #h3-detector-ball.other-protocol {
                background: radial-gradient(circle at 35% 35%, #fbbf24, #d97706 70%, #b45309 100%);
                box-shadow: ${CONFIG.glowIntensity.other};
                border-color: rgba(255,255,255,0.3);
            }
            #h3-detector-ball.unknown-protocol {
                background: radial-gradient(circle at 35% 35%, #9ca3af, #6b7280 70%, #4b5563 100%);
                box-shadow: ${CONFIG.glowIntensity.unknown};
                border-color: rgba(255,255,255,0.2);
            }
            @keyframes h3-ball-pulse {
                0%, 100% { filter: brightness(1); }
                50% { filter: brightness(1.12); }
            }
            #h3-detector-popup {
                position: fixed;
                z-index: ${CONFIG.zIndex + 1};
                background: #1e1e2e;
                color: #cdd6f4;
                border-radius: 14px;
                padding: 16px 18px;
                min-width: 260px;
                max-width: 340px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 13px;
                line-height: 1.5;
                box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3);
                border: 1px solid rgba(255,255,255,0.1);
                pointer-events: auto;
                animation: h3-popup-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
                user-select: text;
                -webkit-user-select: text;
                display: none;
            }
            @keyframes h3-popup-in {
                from { opacity: 0; transform: translateY(8px) scale(0.94); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            #h3-detector-popup .popup-title {
                font-weight: 700;
                font-size: 14px;
                margin-bottom: 10px;
                color: #f5f5f5;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            #h3-detector-popup .popup-title .dot {
                display: inline-block;
                width: 9px;
                height: 9px;
                border-radius: 50%;
                flex-shrink: 0;
            }
            #h3-detector-popup .popup-title .dot.h3-dot { background: #4ade80; box-shadow: 0 0 8px #4ade80; }
            #h3-detector-popup .popup-title .dot.other-dot { background: #fbbf24; box-shadow: 0 0 8px #fbbf24; }
            #h3-detector-popup .popup-row {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                padding: 6px 0;
                border-bottom: 1px solid rgba(255,255,255,0.06);
                gap: 12px;
            }
            #h3-detector-popup .popup-row:last-child { border-bottom: none; }
            #h3-detector-popup .popup-label { color: #a0a0b8; font-size: 11px; flex-shrink: 0; white-space: nowrap; }
            #h3-detector-popup .popup-value { color: #e8e8f0; font-weight: 500; text-align: right; word-break: break-all; font-size: 12px; }
            #h3-detector-popup .popup-value.highlight-h3 { color: #4ade80; font-weight: 700; }
            #h3-detector-popup .popup-value.highlight-warn { color: #fbbf24; font-weight: 700; }
            #h3-detector-popup .popup-value.code {
                font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
                font-size: 11px;
                background: rgba(255,255,255,0.05);
                padding: 3px 7px;
                border-radius: 5px;
                display: inline-block;
            }
            #h3-detector-popup .popup-close {
                position: absolute;
                top: 8px;
                right: 10px;
                background: none;
                border: none;
                color: #8888a0;
                cursor: pointer;
                font-size: 16px;
                padding: 2px 6px;
                border-radius: 4px;
                line-height: 1;
                transition: color 0.15s, background 0.15s;
            }
            #h3-detector-popup .popup-close:hover { color: #fff; background: rgba(255,255,255,0.1); }
            #h3-detector-popup .popup-footer {
                margin-top: 8px;
                font-size: 10px;
                color: #6c6c80;
                text-align: center;
                font-style: italic;
            }
            #h3-detector-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                z-index: ${CONFIG.zIndex};
                pointer-events: auto;
                background: transparent;
                display: none;
            }
        `;
        if (typeof GM_addStyle === 'function') {
            GM_addStyle(css);
        } else {
            const style = document.createElement('style');
            style.textContent = css;
            document.head.appendChild(style);
        }
    }

    let ballElement, popupElement, overlayElement;

    function createBall() {
        const ball = document.createElement('div');
        ball.id = 'h3-detector-ball';
        ball.className = 'unknown-protocol';
        ball.textContent = '?';
        return ball;
    }

    function createPopup() {
        const popup = document.createElement('div');
        popup.id = 'h3-detector-popup';
        return popup;
    }

    function createOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'h3-detector-overlay';
        return overlay;
    }

    function updateBallAppearance(protocol) {
        if (!ballElement) return;
        ballElement.classList.remove('h3-protocol', 'other-protocol', 'unknown-protocol');
        const label = getShortLabel(protocol);
        ballElement.textContent = label;
        if (isH3Protocol(protocol)) {
            ballElement.classList.add('h3-protocol');
        } else if (protocol && protocol !== '') {
            ballElement.classList.add('other-protocol');
        } else {
            ballElement.classList.add('unknown-protocol');
        }
    }

    function buildPopupContent() {
        const currentProtocol = state.currentProtocol;
        const isH3 = isH3Protocol(currentProtocol);
        const dotClass = isH3 ? 'h3-dot' : 'other-dot';
        const statusText = isH3 ? '✅ 使用 HTTP/3' : (currentProtocol ? '⚠️ 未使用 HTTP/3' : '⚠️ 协议未知');

        const allDetected = new Set(state.allResourceProtocols);
        if (currentProtocol && currentProtocol !== '') allDetected.add(currentProtocol.toLowerCase());

        const altSvcProtocols = parseAltSvc(state.altSvcInfo);
        const supportedSet = new Set([...allDetected, ...altSvcProtocols.map(p => p.toLowerCase())]);

        let supportedListHtml = '';
        if (supportedSet.size > 0) {
            const items = [...supportedSet].sort().map(p => {
                const isH3Proto = p.startsWith('h3') || p === 'quic';
                const cls = isH3Proto ? 'highlight-h3' : '';
                return `<span class="code ${cls}">${formatProtocol(p)}</span>`;
            });
            supportedListHtml = items.join('、');
        } else {
            supportedListHtml = '<span style="color:#888;">未能检测到</span>';
        }

        let altSvcHtml = '';
        if (state.altSvcInfo) {
            altSvcHtml = `
                <div class="popup-row">
                    <span class="popup-label">🔖 Alt-Svc 声明</span>
                    <span class="popup-value code" style="font-size:10px;max-width:180px;">${escapeHtml(state.altSvcInfo)}</span>
                </div>`;
        } else if (state.altSvcInfo === null && typeof GM_xmlhttpRequest === 'function') {
            altSvcHtml = `
                <div class="popup-row">
                    <span class="popup-label">🔖 Alt-Svc 声明</span>
                    <span class="popup-value" style="color:#888;">未获取到</span>
                </div>`;
        }

        const h3SupportVerdict = state.isH3Supported === true
            ? '<span style="color:#4ade80;font-weight:700;">✅ 是 — 网站支持 HTTP/3</span>'
            : (state.isH3Supported === false
                ? '<span style="color:#fbbf24;font-weight:700;">⚠️ 未检测到 — 可能不支持 HTTP/3</span>'
                : '<span style="color:#9ca3af;">⏳ 检测中...</span>');

        return `
            <button class="popup-close" id="h3-popup-close-btn">✕</button>
            <div class="popup-title">
                <span class="dot ${dotClass}"></span>
                ${statusText}
            </div>
            <div class="popup-row">
                <span class="popup-label">🔗 当前连接协议</span>
                <span class="popup-value ${isH3 ? 'highlight-h3' : 'highlight-warn'}">${formatProtocol(currentProtocol)}</span>
            </div>
            <div class="popup-row">
                <span class="popup-label">🌐 检测到的协议</span>
                <span class="popup-value">${supportedListHtml}</span>
            </div>
            ${altSvcHtml}
            <div class="popup-row">
                <span class="popup-label">📋 综合判断</span>
                <span class="popup-value">${h3SupportVerdict}</span>
            </div>
            <div class="popup-footer">
                数据来源: Performance API${typeof GM_xmlhttpRequest === 'function' ? ' + GM_xhr' : ''} · 10秒无操作自动隐藏
            </div>
        `;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function positionPopup() {
        if (!popupElement || !ballElement) return;
        const ballRect = ballElement.getBoundingClientRect();
        const popupWidth = popupElement.offsetWidth || 280;
        const popupHeight = popupElement.offsetHeight || 200;
        const margin = 14;

        let left = ballRect.right + margin;
        let top = ballRect.top + ballRect.height / 2 - popupHeight / 2;

        if (left + popupWidth > window.innerWidth - 10) {
            left = ballRect.left - popupWidth - margin;
        }
        top = Math.max(10, Math.min(top, window.innerHeight - popupHeight - 10));

        popupElement.style.left = left + 'px';
        popupElement.style.top = top + 'px';
    }

    // ==================== 自动隐藏定时器管理 ====================
    function clearAutoCollapseTimer() {
        if (state.autoCollapseTimer) {
            clearTimeout(state.autoCollapseTimer);
            state.autoCollapseTimer = null;
        }
    }

    function resetAutoCollapseTimer() {
        clearAutoCollapseTimer();
        // 只有小球展开时才启动定时器
        if (state.ballExpanded) {
            state.autoCollapseTimer = setTimeout(() => {
                // 10秒到，收起小球并关闭弹窗
                collapseBallAndPopup();
            }, CONFIG.autoCollapseDelay);
        }
    }

    function collapseBallAndPopup() {
        hidePopup();
        collapseBall();
        clearAutoCollapseTimer();
    }

    // ==================== 小球与弹窗控制 ====================
    function expandBall() {
        if (state.ballExpanded) return;
        ballElement.classList.add('expanded');
        state.ballExpanded = true;
        resetAutoCollapseTimer();   // 展开后开始计时
    }

    function collapseBall() {
        if (!state.ballExpanded) return;
        ballElement.classList.remove('expanded');
        state.ballExpanded = false;
        clearAutoCollapseTimer();
    }

    function showPopup() {
        if (!popupElement || !ballElement || !overlayElement) return;
        popupElement.innerHTML = buildPopupContent();
        popupElement.style.display = 'block';
        overlayElement.style.display = 'block';

        const closeBtn = popupElement.querySelector('#h3-popup-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', hidePopup);

        requestAnimationFrame(positionPopup);

        // 如果 Alt-Svc 未检测，后台更新
        if (!state.detectionComplete || state.altSvcInfo === null) {
            performAltSvcDetection().then(() => {
                if (popupElement.style.display === 'block') {
                    popupElement.innerHTML = buildPopupContent();
                    positionPopup();
                    const btn = popupElement.querySelector('#h3-popup-close-btn');
                    if (btn) btn.addEventListener('click', hidePopup);
                }
            });
        }

        // 显示弹窗也是一种操作，重置自动隐藏定时器
        resetAutoCollapseTimer();
    }

    function hidePopup() {
        if (popupElement) popupElement.style.display = 'none';
        if (overlayElement) overlayElement.style.display = 'none';
        // 关闭弹窗也属于用户操作，重置定时器
        resetAutoCollapseTimer();
    }

    function onBallClick(e) {
        e.stopPropagation();
        if (!state.ballExpanded) {
            // 第一次点击：展开小球
            expandBall();
            hidePopup();  // 确保弹窗关闭
        } else {
            // 已展开：切换详情弹窗
            if (popupElement.style.display === 'block') {
                hidePopup();
            } else {
                showPopup();
            }
        }
        // 任何点击小球的操作都重置定时器（expandBall/showPopup/hidePopup内部已调用，但为安全再调一次）
        resetAutoCollapseTimer();
    }

    function onOverlayClick(e) {
        e.stopPropagation();
        hidePopup();
        // hidePopup 已重置定时器
    }

    function onKeyDown(e) {
        if (e.key === 'Escape' && popupElement && popupElement.style.display === 'block') {
            hidePopup();
        }
    }

    function onResize() {
        if (popupElement && popupElement.style.display === 'block') {
            positionPopup();
        }
    }

    function onScroll() {
        if (popupElement && popupElement.style.display === 'block') {
            positionPopup();
        }
    }

    // ==================== 检测流程 ====================
    async function performAltSvcDetection() {
        if (state.altSvcInfo !== null) return;
        const altSvc = await detectAltSvc();
        state.altSvcInfo = altSvc;
        const altSvcProtocols = parseAltSvc(altSvc);
        state.isH3Supported = evaluateH3Support(
            state.currentProtocol,
            state.allResourceProtocols,
            altSvcProtocols
        );
    }

    async function performFullDetection() {
        state.currentProtocol = detectCurrentProtocol();
        state.allResourceProtocols = collectResourceProtocols();

        if (!state.currentProtocol || state.currentProtocol === '') {
            const probeResult = await probeWithFetch();
            if (probeResult) {
                state.currentProtocol = probeResult;
                state.allResourceProtocols.add(probeResult.toLowerCase());
            }
        }

        performAltSvcDetection();

        state.isH3Supported = evaluateH3Support(
            state.currentProtocol,
            state.allResourceProtocols,
            parseAltSvc(state.altSvcInfo)
        );
        state.detectionComplete = true;
    }

    // ==================== 初始化 ====================
    function initUI() {
        injectStyles();
        ballElement = createBall();
        popupElement = createPopup();
        overlayElement = createOverlay();

        document.body.appendChild(overlayElement);
        document.body.appendChild(ballElement);
        document.body.appendChild(popupElement);

        ballElement.addEventListener('click', onBallClick);
        overlayElement.addEventListener('click', onOverlayClick);
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', onResize);
        window.addEventListener('scroll', onScroll, { passive: true });

        // 页面卸载前清除定时器
        window.addEventListener('beforeunload', () => {
            clearAutoCollapseTimer();
        });
    }

    async function main() {
        initUI();
        await performFullDetection();
        updateBallAppearance(state.currentProtocol);

        // 监听后续资源更新
        try {
            const observer = new PerformanceObserver((list) => {
                let updated = false;
                for (const entry of list.getEntries()) {
                    if (entry.nextHopProtocol && entry.nextHopProtocol !== '') {
                        const proto = entry.nextHopProtocol.toLowerCase();
                        if (!state.allResourceProtocols.has(proto)) {
                            state.allResourceProtocols.add(proto);
                            updated = true;
                        }
                    }
                }
                if (updated) {
                    const altSvcProtocols = parseAltSvc(state.altSvcInfo);
                    state.isH3Supported = evaluateH3Support(
                        state.currentProtocol,
                        state.allResourceProtocols,
                        altSvcProtocols
                    );
                }
            });
            observer.observe({ type: 'resource', buffered: false });
        } catch (e) {}

        console.log(
            '%c[H3探测器]%c 当前协议: ' + formatProtocol(state.currentProtocol) +
            ' | 网站' + (state.isH3Supported ? '支持' : '可能不支持') + ' HTTP/3',
            'font-weight:bold;color:#4ade80;', ''
        );
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(main, 300));
    } else {
        setTimeout(main, 200);
    }
})();
