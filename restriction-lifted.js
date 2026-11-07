// ==UserScript==
// @name         万能网页限制解除
// @namespace    https://github.com/520luo/js/restriction-lifted.js
// @version      26.11.07
// @description  解除网页的复制、右键、文本选择、粘贴、拖拽、键盘等限制，支持动态内容
// @author       520LUO
// @match        *://*/*
// @license MIT
// @grant        none
// @icon         https://raw.githubusercontent.com/520LUO/icons/refs/heads/main/wnjc.png
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
