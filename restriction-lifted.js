// ==UserScript==
// @name         万能网页限制解除
// @namespace    https://github.com/520luo/js/restriction-lifted.js
// @version      26.11.07.1
// @description  解除网页的复制、右键、文本选择、粘贴、拖拽及部分键盘限制，可通过脚本菜单随时开关
// @author       520LUO
// @match        *://*/*
// @license      MIT
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_unregisterMenuCommand
// @icon         https://raw.githubusercontent.com/520LUO/icons/refs/heads/main/wnjc.png
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置 ====================
    const CONFIG = Object.freeze({
        enableRightClick: true,
        enableSelection: true,
        enableCopy: true,
        enablePaste: true,
        enableCut: true,
        enableDrag: true,
        enableKeyboard: true,
        fixUserSelectCSS: true,
        watchStyleRemoval: true
    });

    const STORAGE_KEY = 'restriction-lifted.enabled';
    const STYLE_ID = 'restriction-lifted-override-style';

    // 默认开启；用户在菜单中修改后会跨页面刷新保存。
    let enabled = loadEnabled();

    // ==================== 状态持久化 ====================
    function loadEnabled() {
        try {
            if (typeof GM_getValue === 'function') {
                const value = GM_getValue(STORAGE_KEY, true);
                if (typeof value === 'boolean') return value;
            }
        } catch (error) {
            console.warn('[网页限制解除] GM_getValue 读取失败：', error);
        }

        try {
            const value = localStorage.getItem(STORAGE_KEY);
            if (value === 'true') return true;
            if (value === 'false') return false;
        } catch (_) {
            // 某些页面可能禁止访问 localStorage，忽略并使用默认值。
        }
        return true;
    }

    function saveEnabled(value) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(STORAGE_KEY, value);
                return;
            }
        } catch (error) {
            console.warn('[网页限制解除] GM_setValue 保存失败：', error);
        }

        try {
            localStorage.setItem(STORAGE_KEY, String(value));
        } catch (error) {
            console.warn('[网页限制解除] 设置无法持久化：', error);
        }
    }

    // ==================== 样式控制 ====================
    const OVERRIDE_CSS = `
        html, body, body * {
            -webkit-user-select: text !important;
            -moz-user-select: text !important;
            -ms-user-select: text !important;
            user-select: text !important;
            -webkit-touch-callout: default !important;
        }
    `;

    function ensureStyle() {
        if (!enabled || !CONFIG.fixUserSelectCSS || !document.documentElement) return;

        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = OVERRIDE_CSS;
            (document.head || document.documentElement).appendChild(style);
        }
    }

    function removeStyle() {
        const style = document.getElementById(STYLE_ID);
        if (style) style.remove();
    }

    // ==================== 事件拦截 ====================
    const blockedEvents = [];

    if (CONFIG.enableRightClick) blockedEvents.push('contextmenu');
    if (CONFIG.enableSelection) blockedEvents.push('selectstart');
    if (CONFIG.enableCopy) blockedEvents.push('copy');
    if (CONFIG.enablePaste) blockedEvents.push('paste');
    if (CONFIG.enableCut) blockedEvents.push('cut');
    if (CONFIG.enableDrag) {
        blockedEvents.push('dragstart', 'drag', 'dragover', 'drop');
    }

    function interceptEvent(event) {
        if (!enabled) return;

        // 不调用 preventDefault：只阻止网页脚本取消浏览器原生操作，
        // 保留浏览器自身的复制、粘贴、右键菜单等默认行为。
        event.stopImmediatePropagation();
    }

    blockedEvents.forEach(type => {
        document.addEventListener(type, interceptEvent, true);
    });

    // 仅拦截网页用于禁用开发者工具、查看源码、保存/打印的快捷键。
    // 不拦截普通按键，避免影响输入框、快捷键和网页正常交互。
    function isAllowedShortcut(event) {
        const key = String(event.key || '').toLowerCase();
        const ctrlOrMeta = event.ctrlKey || event.metaKey;

        if (key === 'f12') return true;

        if (ctrlOrMeta && event.shiftKey &&
            ['i', 'c', 'j', 'k'].includes(key)) {
            return true;
        }

        return ctrlOrMeta && ['u', 's', 'p'].includes(key);
    }

    if (CONFIG.enableKeyboard) {
        ['keydown', 'keypress', 'keyup'].forEach(type => {
            document.addEventListener(type, event => {
                if (!enabled || !isAllowedShortcut(event)) return;
                event.stopImmediatePropagation();
            }, true);
        });
    }

    // ==================== 动态 DOM / 样式维护 ====================
    let observer = null;

    function startStyleObserver() {
        if (!CONFIG.watchStyleRemoval || observer || !document.documentElement) return;

        observer = new MutationObserver(() => {
            if (enabled && CONFIG.fixUserSelectCSS &&
                !document.getElementById(STYLE_ID)) {
                ensureStyle();
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    function setEnabled(value, persist = true) {
        enabled = Boolean(value);

        if (enabled) {
            ensureStyle();
            startStyleObserver();
        } else {
            removeStyle();
        }

        if (persist) saveEnabled(enabled);

        console.info(`[网页限制解除] ${enabled ? '已开启' : '已关闭'}`);
    }

    // ==================== 脚本菜单 ====================
    // 菜单中始终只注册一个命令：显示当前状态，点击后切换到相反状态。
    let menuCommandId = null;

    function registerToggleMenu() {
        if (typeof GM_registerMenuCommand !== 'function') {
            console.warn('[网页限制解除] 当前脚本管理器未提供 GM_registerMenuCommand，菜单命令不可用。');
            return;
        }

        // 先移除旧菜单项，避免 ON/OFF 同时出现或重复注册。
        if (menuCommandId !== null && typeof GM_unregisterMenuCommand === 'function') {
            try {
                GM_unregisterMenuCommand(menuCommandId);
            } catch (error) {
                console.warn('[网页限制解除] 更新菜单命令失败：', error);
            }
        }

        const label = enabled ? '✅解除网页限制状态-ON' : '🚫解除网页限制状态-OFF';
        menuCommandId = GM_registerMenuCommand(label, () => {
            setEnabled(!enabled);
            registerToggleMenu();
        });
    }

    // ==================== 启动 ====================
    function init() {
        registerToggleMenu();

        // document-start 时 head 可能尚未创建，等 html 可用后再注入。
        if (document.documentElement) {
            setEnabled(enabled, false);
        } else {
            const bootstrapObserver = new MutationObserver(() => {
                if (!document.documentElement) return;
                bootstrapObserver.disconnect();
                setEnabled(enabled, false);
            });
            bootstrapObserver.observe(document, {
                childList: true,
                subtree: true
            });
        }
    }

    init();
})();
