// ==UserScript==
// @name         万能网页限制解除
// @namespace    https://github.com/520luo/js/restriction-lifted.js
// @version      26.07.09
// @description  解除网页的复制、右键、文本选择、粘贴、拖拽、键盘等限制，支持动态内容
// @author       520LUO
// @match        *://*/*
// @license MIT
// @grant        none
// @icon         data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiM0ZmFjZmUiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjMDBmMmZlIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgoKICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iZ2xhc3MiIHgxPSIwIiB5MT0iMCIgeDI9IjAiIHkyPSIxIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0id2hpdGUiIHN0b3Atb3BhY2l0eT0iMC40NSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IndoaXRlIiBzdG9wLW9wYWNpdHk9IjAuMSIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICA8L2RlZnM+CgogIDwhLS0g6IOM5pmvIC0tPgogIDxyZWN0IHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiByeD0iMTEwIiBmaWxsPSJ1cmwoI2JnKSIvPgoKICA8IS0tIOa1j+iniOWZqOeql+WPoyAtLT4KICA8cmVjdCB4PSI5MCIgeT0iMTIwIiB3aWR0aD0iMzMyIiBoZWlnaHQ9IjI2MCIgcng9IjM1IgogICAgICAgIGZpbGw9InVybCgjZ2xhc3MpIgogICAgICAgIHN0cm9rZT0id2hpdGUiCiAgICAgICAgc3Ryb2tlLW9wYWNpdHk9IjAuNyIKICAgICAgICBzdHJva2Utd2lkdGg9IjgiLz4KCiAgPCEtLSDpobbpg6jmoI8gLS0+CiAgPGNpcmNsZSBjeD0iMTMwIiBjeT0iMTYwIiByPSIxMiIgZmlsbD0id2hpdGUiLz4KICA8Y2lyY2xlIGN4PSIxNzAiIGN5PSIxNjAiIHI9IjEyIiBmaWxsPSJ3aGl0ZSIvPgogIDxjaXJjbGUgY3g9IjIxMCIgY3k9IjE2MCIgcj0iMTIiIGZpbGw9IndoaXRlIi8+CgogIDwhLS0g572R6aG157q/5p2hIC0tPgogIDxyZWN0IHg9IjEzMCIgeT0iMjIwIiB3aWR0aD0iMTgwIiBoZWlnaHQ9IjE4IiByeD0iOSIKICAgICAgICBmaWxsPSJ3aGl0ZSIgb3BhY2l0eT0iMC44Ii8+CiAgPHJlY3QgeD0iMTMwIiB5PSIyNjAiIHdpZHRoPSIxMzAiIGhlaWdodD0iMTgiIHJ4PSI5IgogICAgICAgIGZpbGw9IndoaXRlIiBvcGFjaXR5PSIwLjUiLz4KCiAgPCEtLSDop6PplIHplIHkvZMgLS0+CiAgPHJlY3QgeD0iMjg1IiB5PSIyNjAiIHdpZHRoPSIxMDAiIGhlaWdodD0iOTAiCiAgICAgICAgcng9IjE4IgogICAgICAgIGZpbGw9IiNmZmZmZmYiLz4KCiAgPCEtLSDop6PplIHplIHnjq8gLS0+CiAgPHBhdGggZD0iTTMxMCAyNjAKICAgICAgICAgICBWMjIwCiAgICAgICAgICAgQzMxMCAxNjUgMzkwIDE2NSAzOTAgMjIwCiAgICAgICAgICAgVjI0NSIKICAgICAgICBmaWxsPSJub25lIgogICAgICAgIHN0cm9rZT0id2hpdGUiCiAgICAgICAgc3Ryb2tlLXdpZHRoPSIyMiIKICAgICAgICBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KCiAgPCEtLSDplIHlrZQgLS0+CiAgPGNpcmNsZSBjeD0iMzM1IiBjeT0iMzA1IiByPSIxMiIgZmlsbD0iIzRmYWNmZSIvPgogIDxyZWN0IHg9IjMzMCIgeT0iMzA1IiB3aWR0aD0iMTAiIGhlaWdodD0iMjUiCiAgICAgICAgcng9IjUiIGZpbGw9IiM0ZmFjZmUiLz4KCiAgPCEtLSDmsrnnjLTohJrmnKzmoIfor4YgLS0+CiAgPGNpcmNsZSBjeD0iMjU2IiBjeT0iNDMwIiByPSI0MiIKICAgICAgICAgIGZpbGw9IiMyNDI0MjQiLz4KICA8cGF0aCBkPSJNMjI1IDQyNQogICAgICAgICAgIEMyNDUgNDAwIDI3MCA0MDAgMjkwIDQyNQogICAgICAgICAgIEMyNzAgNDU1IDI0NSA0NTUgMjI1IDQyNVoiCiAgICAgICAgZmlsbD0iI2ZmY2MzMyIvPgogIDxjaXJjbGUgY3g9IjI0NSIgY3k9IjQyNSIgcj0iNiIgZmlsbD0iIzIyMiIvPgogIDxjaXJjbGUgY3g9IjI3NSIgY3k9IjQyNSIgcj0iNiIgZmlsbD0iIzIyMiIvPgoKPC9zdmc+
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ========== 可配置项 ==========
    const CONFIG = {
        enableRightClick: true,      // 启用右键菜单
        enableSelection: true,       // 允许文本选择
        enableCopy: true,            // 允许复制
        enablePaste: true,           // 允许粘贴
        enableCut: true,             // 允许剪切
        enableDrag: true,            // 允许拖拽
        enableKeyboard: true,        // 解除键盘限制（如F12、Ctrl+U等）
        removeOnAttributes: true,    // 移除元素上的on*事件属性（如oncontextmenu）
        removeUnselectable: true,    // 移除unselectable属性
        fixUserSelectCSS: true,      // 覆盖user-select样式
        watchDynamicDOM: true        // 监视动态插入的元素
    };

    // 需要阻止传播的事件列表（捕获阶段）
    const BLOCKED_EVENTS = [];
    if (CONFIG.enableRightClick) BLOCKED_EVENTS.push('contextmenu');
    if (CONFIG.enableSelection) BLOCKED_EVENTS.push('selectstart');
    if (CONFIG.enableCopy) BLOCKED_EVENTS.push('copy');
    if (CONFIG.enablePaste) BLOCKED_EVENTS.push('paste');
    if (CONFIG.enableCut) BLOCKED_EVENTS.push('cut');
    if (CONFIG.enableDrag) BLOCKED_EVENTS.push('dragstart');

    // 需要移除的on*属性名
    const ON_ATTRS = [
        'oncontextmenu', 'onselectstart', 'oncopy', 'onpaste', 'oncut',
        'ondragstart', 'ondrag', 'ondragover', 'ondrop',
        'onkeydown', 'onkeyup', 'onkeypress',
        'onmousedown', 'onmouseup'
    ];

    // ========== 核心功能 ==========

    // 1. 通过事件捕获阶段阻止所有相关事件监听器执行
    function blockEvents() {
        BLOCKED_EVENTS.forEach(eventType => {
            document.addEventListener(eventType, function(e) {
                e.stopImmediatePropagation(); // 阻止该元素上的其他监听器
                // 注意：不调用 e.preventDefault()，以保留浏览器的默认行为
            }, true); // 捕获阶段
        });

        // 键盘限制：允许F12、Ctrl+Shift+I、Ctrl+U、Ctrl+S等
        if (CONFIG.enableKeyboard) {
            document.addEventListener('keydown', function(e) {
                // 常见开发者工具快捷键
                const key = e.key;
                const ctrl = e.ctrlKey, shift = e.shiftKey;
                if (
                    key === 'F12' ||
                    (ctrl && shift && (key === 'I' || key === 'C' || key === 'J')) ||
                    (ctrl && (key === 'u' || key === 'U' || key === 's' || key === 'S' || key === 'p' || key === 'P'))
                ) {
                    e.stopImmediatePropagation();
                    // 不阻止默认，允许弹出开发者工具/保存等
                }
            }, true);
        }
    }

    // 2. 移除元素上的on*事件属性和unselectable
    function cleanElement(el) {
        if (!el || el.nodeType !== 1) return; // 只处理元素节点

        // 移除on*属性
        if (CONFIG.removeOnAttributes) {
            ON_ATTRS.forEach(attr => {
                if (el.hasAttribute(attr)) {
                    el.removeAttribute(attr);
                }
            });
        }

        // 移除unselectable属性
        if (CONFIG.removeUnselectable) {
            const unselectable = el.getAttribute('unselectable');
            if (unselectable === 'on' || unselectable === '') {
                el.setAttribute('unselectable', 'off');
            }
        }

        // 特殊处理body/html的onselectstart等（可能作为属性直接附加）
        if (el.onselectstart !== undefined && CONFIG.enableSelection) {
            el.onselectstart = null;
        }
        if (el.oncontextmenu !== undefined && CONFIG.enableRightClick) {
            el.oncontextmenu = null;
        }
        if (el.oncopy !== undefined && CONFIG.enableCopy) {
            el.oncopy = null;
        }
        if (el.onpaste !== undefined && CONFIG.enablePaste) {
            el.onpaste = null;
        }
        if (el.oncut !== undefined && CONFIG.enableCut) {
            el.oncut = null;
        }
        if (el.ondragstart !== undefined && CONFIG.enableDrag) {
            el.ondragstart = null;
        }
    }

    // 3. 添加全局CSS修复
    function injectCSS() {
        if (!CONFIG.fixUserSelectCSS) return;
        const style = document.createElement('style');
        style.textContent = `
            *, *::before, *::after {
                -webkit-user-select: auto !important;
                -moz-user-select: auto !important;
                -ms-user-select: auto !important;
                user-select: auto !important;
            }
            html, body {
                -webkit-user-select: auto !important;
                -moz-user-select: auto !important;
                -ms-user-select: auto !important;
                user-select: auto !important;
            }
        `;
        document.head.appendChild(style);
    }

    // 4. 遍历现有DOM进行清理
    function cleanAllElements() {
        const allElements = document.querySelectorAll('*');
        allElements.forEach(cleanElement);
        // 同时清理document和documentElement，body等
        cleanElement(document.documentElement);
        cleanElement(document.body);
    }

    // 5. 监视动态添加的内容
    function watchDOM() {
        if (!CONFIG.watchDynamicDOM) return;
        const observer = new MutationObserver(mutations => {
            let shouldCleanAll = false;
            mutations.forEach(mutation => {
                // 新增节点
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        cleanElement(node);
                        // 递归处理子树
                        const children = node.querySelectorAll('*');
                        children.forEach(cleanElement);
                    }
                });
                // 属性变化也可能添加禁止属性（如unselectable、on*）
                if (mutation.type === 'attributes' && mutation.target.nodeType === 1) {
                    cleanElement(mutation.target);
                }
                // 如果body或html本身被替换（极端情况），标记全量清理
                if (mutation.target === document.body || mutation.target === document.documentElement) {
                    shouldCleanAll = true;
                }
            });
            if (shouldCleanAll) {
                cleanAllElements();
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['unselectable', 'oncontextmenu', 'onselectstart', 'oncopy', 'onpaste', 'oncut', 'ondragstart', 'style', 'class']
        });
    }

    // ========== 启动 ==========
    function init() {
        blockEvents();
        injectCSS();

        // 当DOM可用时立即清理，也可在DOMContentLoaded后再次确保
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                cleanAllElements();
                watchDOM();
            });
        } else {
            cleanAllElements();
            watchDOM();
        }
    }

    init();
})();
