// ==UserScript==
// @name         Cloudflare 站点检测 (Trace + DNS 目标IP + ECS + 边缘归属)
// @namespace    https://github.com/52luo/js/cf-detector
// @version      6.2.3
// @description  检测 Cloudflare CDN，解析当前网站IP（ECS），显示本机 IP、边缘归属（国旗/代号/国名）
// @author       520LUO
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cloudflare.com
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect       *
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 用户配置 ====================
    const DNS_RESOLVER_URL = 'https://cloudflare-dns.com/dns-query'; // 或 Google: https://dns.google/resolve
    const IPINFO_API_TEMPLATE = 'https://api.db-ip.com/v2/free/${ip}';
    const CACHE_KEY = 'cf_trace_dns_cache';
    const CACHE_TTL = 30000;
    // ==================== 配置结束 ====================

    // 隐藏滚动条
    const style = document.createElement('style');
    style.textContent = `
        #cf-detail-panel::-webkit-scrollbar,
        .cf-ip-scroll::-webkit-scrollbar { display: none; }
        #cf-detail-panel, .cf-ip-scroll { scrollbar-width: none; -ms-overflow-style: none; }
    `;
    document.head.appendChild(style);

    // ---------- 缓存 ----------
    function cacheGet() {
        try {
            const raw = sessionStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (Date.now() - data.t > CACHE_TTL) return null;
            return data.v;
        } catch { return null; }
    }
    function cacheSet(v) {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), v }));
    }

    // ---------- 工具函数 ----------
    function countryCodeToFlag(code) {
        if (!code || code.length !== 2) return '';
        const a = code.charCodeAt(0) - 65 + 0x1F1E6;
        const b = code.charCodeAt(1) - 65 + 0x1F1E6;
        return String.fromCodePoint(a, b);
    }

    // colo 三字码 → 国家代码映射（仅覆盖主要节点，可自行扩展）
    const coloCountryMap = {
        // 中国
        KHN: 'CN', CAN: 'CN', SZX: 'CN', SHA: 'CN', PVG: 'CN', PEK: 'CN', BJS: 'CN',
        CKG: 'CN', CTU: 'CN', KMG: 'CN', XIY: 'CN', HGH: 'CN', WUH: 'CN', CSX: 'CN',
        SHE: 'CN', DLC: 'CN', TAO: 'CN', XMN: 'CN', NGB: 'CN', NKG: 'CN', HRB: 'CN',
        TSN: 'CN', URC: 'CN', LXA: 'CN', KWE: 'CN', FOC: 'CN', CZX: 'CN', CGD: 'CN',
        ACX: 'CN', BHY: 'CN', CGO: 'CN', FUO: 'CN', HAK: 'CN', HFE: 'CN', HYN: 'CN',
        JXG: 'CN', LHW: 'CN', LYA: 'CN', NNG: 'CN', PKX: 'CN', SJW: 'CN', TEN: 'CN',
        TNA: 'CN', TYN: 'CN', WHU: 'CN', XFN: 'CN', XNN: 'CN', ZGN: 'CN',
        TPE: 'TW', KHH: 'TW', HKG: 'HK', MFM: 'MO',
        // 日本
        NRT: 'JP', HND: 'JP', KIX: 'JP', NGO: 'JP', FUK: 'JP', OKA: 'JP',
        // 韩国
        ICN: 'KR', PUS: 'KR',
        // 新加坡
        SIN: 'SG',
        // 马来西亚
        KUL: 'MY', KCH: 'MY', JHB: 'MY',
        // 印尼
        CGK: 'ID', DPS: 'ID', JOG: 'ID', MLG: 'ID',
        // 菲律宾
        MNL: 'PH', CEB: 'PH', CRK: 'PH', CGY: 'PH',
        // 泰国
        BKK: 'TH', CNX: 'TH', URT: 'TH',
        // 越南
        SGN: 'VN', HAN: 'VN', DAD: 'VN',
        // 印度
        DEL: 'IN', BOM: 'IN', MAA: 'IN', BLR: 'IN', HYD: 'IN', CCU: 'IN',
        AMD: 'IN', AGR: 'IN', BBI: 'IN', CJB: 'IN', COK: 'IN', CNN: 'IN',
        IXC: 'IN', KNU: 'IN', NAG: 'IN', PAT: 'IN', PNQ: 'IN',
        // 美国
        SEA: 'US', PDX: 'US', SFO: 'US', OAK: 'US', SJC: 'US', SMF: 'US',
        LAX: 'US', SAN: 'US', LAS: 'US', PHX: 'US', SLC: 'US', DEN: 'US',
        ABQ: 'US', TUS: 'US', OKC: 'US', DFW: 'US', IAH: 'US', AUS: 'US',
        SAT: 'US', MCI: 'US', STL: 'US', MEM: 'US', MSY: 'US', BNA: 'US',
        ATL: 'US', JAX: 'US', MCO: 'US', TPA: 'US', MIA: 'US', CLT: 'US',
        RDU: 'US', IAD: 'US', DCA: 'US', BWI: 'US', RIC: 'US', ORF: 'US',
        PHL: 'US', JFK: 'US', EWR: 'US', LGA: 'US', BOS: 'US', BUF: 'US',
        PIT: 'US', CLE: 'US', CVG: 'US', CMH: 'US', IND: 'US', DTW: 'US',
        MKE: 'US', ORD: 'US', MSP: 'US', OMA: 'US', FSD: 'US', ANC: 'US',
        HNL: 'US',
        // 加拿大
        YVR: 'CA', YYC: 'CA', YEG: 'CA', YXE: 'CA', YWG: 'CA', YYZ: 'CA',
        YOW: 'CA', YUL: 'CA', YHZ: 'CA',
        // 英国
        LHR: 'GB', LGW: 'GB', MAN: 'GB', EDI: 'GB', BHX: 'GB', GLA: 'GB',
        // 德国
        FRA: 'DE', MUC: 'DE', DUS: 'DE', TXL: 'DE', BER: 'DE', HAM: 'DE',
        STR: 'DE', HAJ: 'DE',
        // 法国
        CDG: 'FR', ORY: 'FR', MRS: 'FR', LYS: 'FR', NCE: 'FR', BOD: 'FR',
        // 荷兰
        AMS: 'NL', RTM: 'NL',
        // 意大利
        MXP: 'IT', LIN: 'IT', BGY: 'IT', FCO: 'IT', NAP: 'IT', VCE: 'IT', PMO: 'IT',
        // 西班牙
        MAD: 'ES', BCN: 'ES', VLC: 'ES', AGP: 'ES', SVQ: 'ES',
        // 瑞士
        ZRH: 'CH', GVA: 'CH',
        // 瑞典
        ARN: 'SE', GOT: 'SE',
        // 丹麦
        CPH: 'DK',
        // 挪威
        OSL: 'NO',
        // 芬兰
        HEL: 'FI',
        // 波兰
        WAW: 'PL', WRO: 'PL', KRK: 'PL',
        // 奥地利
        VIE: 'AT',
        // 比利时
        BRU: 'BE',
        // 爱尔兰
        DUB: 'IE', ORK: 'IE',
        // 葡萄牙
        LIS: 'PT', OPO: 'PT',
        // 俄罗斯
        DME: 'RU', LED: 'RU', KJA: 'RU', SVX: 'RU',
        // 土耳其
        IST: 'TR', ADB: 'TR', ANK: 'TR',
        // 阿联酋
        DXB: 'AE', AUH: 'AE',
        // 沙特
        JED: 'SA', RUH: 'SA', DMM: 'SA',
        // 巴西
        GRU: 'BR', CGH: 'BR', VCP: 'BR', GIG: 'BR', BSB: 'BR',
        CNF: 'BR', CWB: 'BR', POA: 'BR', FLN: 'BR', SSA: 'BR',
        REC: 'BR', FOR: 'BR', BEL: 'BR', MAO: 'BR', GOI: 'BR',
        UDI: 'BR', CGB: 'BR', PMW: 'BR', JDO: 'BR', RAO: 'BR',
        SJK: 'BR', SJP: 'BR', SOD: 'BR', ITJ: 'BR', JOI: 'BR',
        NVT: 'BR', CAW: 'BR', ARU: 'BR', CFC: 'BR', BNU: 'BR',
        XAP: 'BR', QWJ: 'BR',
        // 澳大利亚
        PER: 'AU', ADL: 'AU', MEL: 'AU', SYD: 'AU', CBR: 'AU',
        BNE: 'AU', HBA: 'AU',
        // 新西兰
        AKL: 'NZ', WLG: 'NZ', CHC: 'NZ',
        // 南非
        JNB: 'ZA', CPT: 'ZA', DUR: 'ZA',
        // 其他常见
        HKG: 'HK', MFM: 'MO', TPE: 'TW', KHH: 'TW',
        MEX: 'MX', GDL: 'MX', MTY: 'MX', QRO: 'MX',
        BOG: 'CO', MDE: 'CO', CLO: 'CO', BAQ: 'CO',
        EZE: 'AR', AEP: 'AR', COR: 'AR', NQN: 'AR',
        SCL: 'CL', ARI: 'CL', CCP: 'CL',
        LIM: 'PE', CUZ: 'PE',
        UIO: 'EC', GYE: 'EC',
        LPB: 'BO', VVI: 'BO',
        ASU: 'PY', MVD: 'UY', GEO: 'GY', PBM: 'SR',
        SJO: 'CR', PTY: 'PA', GUA: 'GT', SAP: 'HN', TGU: 'HN',
        GCM: 'KY', NAS: 'BS', KIN: 'JM', PAP: 'HT',
        SDQ: 'DO', STI: 'DO', SJU: 'PR', BGI: 'BB', GND: 'GD',
        MBJ: 'JM', SXM: 'SX', UVF: 'LC',
        // 非洲
        JNB: 'ZA', CPT: 'ZA', DUR: 'ZA',
        LOS: 'NG', ABV: 'NG',
        NBO: 'KE', MBA: 'KE',
        DAR: 'TZ', MPM: 'MZ', LLW: 'MW', LUN: 'ZM', HRE: 'ZW',
        GBE: 'BW', WDH: 'NA', TNR: 'MG', MRU: 'MU',
        ADD: 'ET', JIB: 'DJ', KGL: 'RW', EBB: 'UG',
        CAI: 'EG', ALY: 'EG',
        CMN: 'MA', RAK: 'MA',
        ALG: 'DZ', ORN: 'DZ', CZL: 'DZ', AAE: 'DZ',
        TUN: 'TN',
        DKR: 'SN', DSS: 'SN',
        ACC: 'GH', ABJ: 'CI', ASK: 'CI',
        LFW: 'TG', COO: 'BJ',
        BKO: 'ML', OUA: 'BF',
        FIH: 'CD',
        // 其他
        ULN: 'MN', // 蒙古
        // 补充遗漏
        KIV: 'MD', // 摩尔多瓦
        MSQ: 'BY', // 白俄罗斯
        KBP: 'UA', // 乌克兰
        RIX: 'LV', // 拉脱维亚
        VNO: 'LT', // 立陶宛
        TLL: 'EE', // 爱沙尼亚
        KEF: 'IS', // 冰岛
        LUX: 'LU', // 卢森堡
        PRG: 'CZ', // 捷克
        BTS: 'SK', // 斯洛伐克
        BUD: 'HU', // 匈牙利
        LJU: 'SI', // 斯洛文尼亚
        ZAG: 'HR', // 克罗地亚
        BEG: 'RS', // 塞尔维亚
        TIA: 'AL', // 阿尔巴尼亚
        SKP: 'MK', // 北马其顿
        SOF: 'BG', // 保加利亚
        OTP: 'RO', // 罗马尼亚
        CLJ: 'RO',
        ATH: 'GR', // 希腊
        SKG: 'GR', HER: 'GR',
        MLA: 'MT', // 马耳他
        BEY: 'LB', // 黎巴嫩
        AMM: 'JO', // 约旦
        TLV: 'IL', // 以色列
        HFA: 'IL',
        ZDM: 'PS', // 巴勒斯坦
        BGW: 'IQ', BSR: 'IQ', EBL: 'IQ', ISU: 'IQ', NJF: 'IQ', XNH: 'IQ',
        EVN: 'AM', // 亚美尼亚
        GYD: 'AZ', // 阿塞拜疆
        TBS: 'GE', // 格鲁吉亚
        LLK: 'AZ',
        SUV: 'FJ', NAN: 'FJ', // 斐济
        NOU: 'NC', // 新喀里多尼亚
        PPT: 'PF', // 法属波利尼西亚
        GUM: 'GU', // 关岛
        LOCAL: '', 'N/A': ''
    };

    function getCountryName(code) {
        try {
            return new Intl.DisplayNames('zh-Hans', { type: 'region' }).of(code) || code;
        } catch {
            return code;
        }
    }

    // ---------- DNS 解析 (DoH)，支持 ECS ----------
    function dnsResolve(hostname, type, clientIP) {
        return new Promise((resolve) => {
            let url = `${DNS_RESOLVER_URL}?name=${encodeURIComponent(hostname)}&type=${type}`;
            if (clientIP) {
                url += `&edns_client_subnet=${clientIP}`;
            }
            GM.xmlHttpRequest({
                method: 'GET',
                url: url,
                headers: { 'Accept': 'application/dns-json' },
                timeout: 5000,
                onload: function(resp) {
                    if (resp.status !== 200) return resolve([]);
                    try {
                        const data = JSON.parse(resp.responseText);
                        if (!data.Answer) return resolve([]);
                        const ips = data.Answer
                            .filter(r => r.type === 1 || r.type === 28)
                            .map(r => r.data);
                        resolve(ips);
                    } catch (e) { resolve([]); }
                },
                onerror: () => resolve([]),
                ontimeout: () => resolve([])
            });
        });
    }

    async function resolveTargetIPs(hostname, clientIP) {
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(hostname)) {
            return [hostname];
        }
        const [a, aaaa] = await Promise.all([
            dnsResolve(hostname, 'A', clientIP),
            dnsResolve(hostname, 'AAAA', clientIP)
        ]);
        return [...new Set([...a, ...aaaa])];
    }

    // ---------- 归属地查询 ----------
    function getIPInfo(ip) {
    return new Promise((resolve) => {
        const url = IPINFO_API_TEMPLATE.replace('${ip}', ip);
        GM.xmlHttpRequest({
            method: 'GET',
            url: url,
            headers: { 'Accept': 'application/json' },
            timeout: 8000,
            onload: function(resp) {
                try {
                    if (resp.status !== 200) return resolve({ error: `HTTP ${resp.status}` });
                    const data = JSON.parse(resp.responseText);
                    // db-ip.com free 返回: countryName, city (可能为空)
                    if (data.countryName) {
                        const parts = [data.countryName, data.city].filter(Boolean);
                        resolve({ info: parts.join(', '), countryCode: data.countryCode || '' });
                        return;
                    }
                    resolve({ error: '格式异常' });
                } catch (e) { resolve({ error: '解析失败' }); }
            },
            onerror: () => resolve({ error: '网络错误' }),
            ontimeout: () => resolve({ error: '超时' })
        });
    });
    }


    // ---------- 主检测 ----------
    async function detectAll() {
        const cached = cacheGet();
        if (cached) return cached;

        const result = {
            cf: false,
            colo: null,
            trace: false,
            clientIP: null, // 本机 IP
            targetIPs: [],
            ipInfoCache: {}
        };

        // 1. 检测 CF 状态
        try {
            const headResp = await fetch(location.href, { method: 'HEAD', cache: 'no-store' });
            const server = headResp.headers.get('server') || '';
            const cfRay = headResp.headers.get('cf-ray') || '';
            if (server.toLowerCase().includes('cloudflare') || cfRay) result.cf = true;
        } catch (e) {}

        // 2. 尝试 trace 获取 colo 及本机 IP
        if (result.cf) {
            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 3000);
                const traceResp = await fetch(location.origin + '/cdn-cgi/trace', {
                    signal: ctrl.signal,
                    cache: 'no-store'
                });
                clearTimeout(timer);
                if (traceResp.ok) {
                    const text = await traceResp.text();
                    const coloMatch = text.match(/^colo=([A-Z]+)$/m);
                    const ipMatch = text.match(/^ip=([^\s]+)$/m);
                    if (coloMatch) {
                        result.colo = coloMatch[1].trim();
                        result.trace = true;
                    }
                    if (ipMatch) {
                        result.clientIP = ipMatch[1].trim();
                    }
                }
            } catch (e) {}
        }

        // 3. 解析目标域名 IP（使用本机 IP 作为 ECS）
        if (result.cf) {
            const ips = await resolveTargetIPs(location.hostname, result.clientIP);
            result.targetIPs = ips;
            await Promise.all(ips.map(async ip => {
                if (!result.ipInfoCache[ip]) {
                    result.ipInfoCache[ip] = await getIPInfo(ip);
                }
            }));
        }

        cacheSet(result);
        return result;
    }

    function getStatus(data) {
        if (!data.cf) return { text: '非Cloudflare站点', dot: '🔴', color: '#ef4444' };
        if (data.trace) return { text: 'Cloudflare站点', dot: '🟢', color: '#18a058' };
        return { text: 'Cloudflare 已启用', dot: '🟡', color: '#f59e0b' };
    }

    // ========== UI 状态 ==========
    let cloudElement = null, detailPanel = null;
    let currentData = null;
    let debugMessages = [];
    let showDebug = false;

    function addDebug(msg) {
        debugMessages.push(msg);
        if (debugMessages.length > 10) debugMessages.shift();
        if (detailPanel && detailPanel.style.display === 'block' && showDebug) {
            updateDebugArea();
        }
    }

    function updateDebugArea() {
        const debugDiv = detailPanel?.querySelector('#cf-debug-area');
        if (debugDiv) {
            debugDiv.innerHTML = showDebug
                ? debugMessages.map(m => `<div style="font-size:10px; color:#555; word-break:break-all;">${m}</div>`).join('')
                : '';
        }
    }

    function toggleDebugVisibility() {
        showDebug = !showDebug;
        updateDebugArea();
    }

    // ========== 面板渲染 ==========
    function renderPanel(data) {
        if (!detailPanel) return;

        const st = getStatus(data);
        let html = `<div style="padding-bottom: 40px;">`;

        // 标题 + 刷新
        html += `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                <div style="font-weight:bold; font-size:14px;">🌐 ${location.hostname}</div>
                <button id="cf-refresh-btn" title="刷新" style="
                    width:28px; height:28px; border-radius:50%;
                    background:rgba(255,255,255,0.5);
                    border:0.5px solid rgba(255,255,255,0.9);
                    backdrop-filter:blur(12px);
                    -webkit-backdrop-filter:blur(12px);
                    box-shadow:inset 0 1px 3px rgba(255,255,255,0.8), 0 2px 6px rgba(0,0,0,0.08);
                    display:flex; align-items:center; justify-content:center;
                    cursor:pointer; color:#555; font-size:16px;
                ">↻</button>
            </div>`;

        // 状态
        html += `<div style="margin-bottom:8px;">
            <span>状态：</span>
            <span style="font-weight:bold; color:${st.color};">${st.dot} ${st.text} </span>
        </div>`;

        // 本机 IP（可复制）
        if (data.clientIP) {
            html += `
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                    <span>本机 IP：</span>
                    <span class="cf-ip-addr" data-ip="${data.clientIP}" style="
                        font-family:monospace; font-size:12px; color:#1a1a1a;
                        background:rgba(255,255,255,0.5); padding:2px 8px;
                        border-radius:6px; cursor:pointer; user-select:all;
                    ">${data.clientIP}</span>
                </div>`;
        }

        // 边缘 IP 归属（colo）
        if (data.cf && data.colo) {
            const countryCode = coloCountryMap[data.colo] || '';
            const flag = countryCode ? countryCodeToFlag(countryCode) + ' ' : '';
            const countryName = countryCode ? getCountryName(countryCode) : '未知';
            html += `<div style="margin-bottom:8px;">当前边缘IP归属地：${flag}${data.colo} ${countryName}</div>`;
        } else if (data.cf && !data.colo) {
            html += `<div style="margin-bottom:8px; color:#888;">边缘节点未知</div>`;
        }

        // 目标 IP 列表
        if (data.cf && data.targetIPs.length > 0) {
            html += `<div style="margin-top:12px;"><div style="font-weight:bold; font-size:12px; color:#444; margin-bottom:6px;"> CF DOH解析到的目标IP (${data.targetIPs.length})</div>`;
            html += `<div style="padding-left:4px;">`;
            data.targetIPs.forEach(ip => {
                const info = data.ipInfoCache[ip];
                let infoText = info ? (info.info || '查询失败') : '查询中...';
                const flag = info && info.countryCode ? countryCodeToFlag(info.countryCode) + ' ' : '';
                const isError = info && !info.info;
                html += `
                    <div style="display:flex; align-items:center; margin-bottom:6px; gap:8px;">
                        <div class="cf-ip-scroll" style="
                            width:150px; min-width:150px; max-width:150px;
                            overflow-x:auto; white-space:nowrap;
                            background:rgba(255,255,255,0.5);
                            backdrop-filter:blur(12px);
                            -webkit-backdrop-filter:blur(12px);
                            border:1px solid rgba(255,255,255,0.8);
                            border-radius:10px;
                            padding:4px 8px;
                            box-shadow:0 0 8px rgba(255,255,255,0.4), inset 0 1px 4px rgba(255,255,255,0.6);
                        ">
                            <span class="cf-ip-addr" data-ip="${ip}" style="
                                font-family:monospace; font-size:12px; color:#1a1a1a;
                                cursor:pointer; user-select:all;
                            ">${ip}</span>
                        </div>
                        <span style="color:${isError ? '#c00' : '#333'}; font-size:11px; flex:1; word-break:break-word;">${flag}${infoText}</span>
                    </div>`;
            });
            html += `</div></div>`;
        } else if (data.cf && data.targetIPs.length === 0) {
            html += `<div style="color:#888; margin-top:10px;">无法解析目标 IP</div>`;
        }

        // 调试区域
        html += `
            <div id="cf-debug-area" style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.1); display:${showDebug ? 'block' : 'none'};">
                ${showDebug ? debugMessages.map(m => `<div style="font-size:10px; color:#555; word-break:break-all;">${m}</div>`).join('') : ''}
            </div>`;
        html += `</div>`;

        detailPanel.innerHTML = html;

        // 粘性日志按钮
        const oldSticky = detailPanel.querySelector('#cf-debug-sticky');
        if (oldSticky) oldSticky.remove();
        const stickyBtn = document.createElement('div');
        stickyBtn.id = 'cf-debug-sticky';
        stickyBtn.style.cssText = 'position:sticky; bottom:0; display:flex; justify-content:flex-end; margin-top:-40px; pointer-events:none; z-index:15;';
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'cf-debug-toggle';
        toggleBtn.title = showDebug ? '收起日志' : '展开日志';
        toggleBtn.style.cssText = `
            width:32px; height:32px; border-radius:50%;
            background:rgba(255,255,255,0.6);
            border:0.5px solid rgba(255,255,255,0.9);
            backdrop-filter:blur(12px);
            -webkit-backdrop-filter:blur(12px);
            box-shadow:0 2px 8px rgba(0,0,0,0.08), inset 0 1px 3px rgba(255,255,255,0.8);
            display:flex; align-items:center; justify-content:center;
            cursor:pointer; font-size:16px; color:#444;
            pointer-events:auto; margin-right:8px; margin-bottom:8px;
        `;
        toggleBtn.innerHTML = '📋';
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDebugVisibility();
            toggleBtn.title = showDebug ? '收起日志' : '展开日志';
            const debugArea = detailPanel.querySelector('#cf-debug-area');
            if (debugArea) {
                debugArea.style.display = showDebug ? 'block' : 'none';
                if (showDebug) updateDebugArea();
            }
        });
        stickyBtn.appendChild(toggleBtn);
        detailPanel.appendChild(stickyBtn);

        // 刷新按钮事件
        const refreshBtn = detailPanel.querySelector('#cf-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await refreshDetection();
            });
        }

        // IP 复制事件（本机和目标）
        const ipSpans = detailPanel.querySelectorAll('.cf-ip-addr');
        ipSpans.forEach(span => {
            span.addEventListener('click', async function(e) {
                e.stopPropagation();
                const ip = this.dataset.ip;
                try { await navigator.clipboard.writeText(ip); } catch {
                    const textarea = document.createElement('textarea');
                    textarea.value = ip;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                }
                const original = this.textContent;
                this.textContent = '已复制 ✓';
                this.style.color = '#0a0';
                setTimeout(() => {
                    this.textContent = original;
                    this.style.color = '#1a1a1a';
                }, 1500);
            });
        });
    }

    // ========== UI 创建 ==========
    function createCloudUI() {
        if (cloudElement) return;

        cloudElement = document.createElement('div');
        cloudElement.id = 'cf-cloud-indicator';
        cloudElement.title = 'Cloudflare 站点';
        cloudElement.style.cssText = `
            position:fixed; bottom:16px; right:16px; width:22px; height:22px;
            background:rgba(255,255,0,0.45);
            border-radius:50%;
            display:flex; align-items:center; justify-content:center;
            cursor:pointer; z-index:2147483647;
            backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
            box-shadow:0 0 16px rgba(255,255,0,0.6), inset 0 1px 5px rgba(255,255,255,0.9);
            border:0.5px solid rgba(255,255,255,0.5);
        `;
        const icon = document.createElement('span');
        icon.textContent = '☁️'; icon.style.cssText = 'font-size:13px;';
        const dot = document.createElement('span');
        dot.style.cssText = `position:absolute; top:1px; right:1px; width:5px; height:5px; background:#0f0; border-radius:50%; box-shadow:0 0 4px #0f0;`;
        cloudElement.append(icon, dot);
        document.body.appendChild(cloudElement);

        detailPanel = document.createElement('div');
        detailPanel.id = 'cf-detail-panel';
        // 柔和边框高光：降低内发光亮度，外阴影更淡
        detailPanel.style.cssText = `
            position:fixed; bottom:45px; right:16px; width:310px; max-height:400px;
            overflow-y:auto;
            background:rgba(240,240,245,0.65);
            backdrop-filter:blur(30px) saturate(90%);
            -webkit-backdrop-filter:blur(30px) saturate(90%);
            border-radius:20px; padding:18px 18px 0 18px;
            font-size:13px; color:#1a1a1a;
            z-index:2147483646;
            box-shadow:
                inset 0 0 25px rgba(255,255,255,0.6),
                0 6px 24px rgba(0,0,0,0.12),
                0 0 0 1px rgba(255,255,255,0.6);
            border:none;
            display:none;
        `;
        document.body.appendChild(detailPanel);

        cloudElement.addEventListener('click', () => {
            if (detailPanel.style.display === 'none') {
                detailPanel.style.display = 'block';
                if (currentData) renderPanel(currentData);
            } else {
                detailPanel.style.display = 'none';
            }
        });

        document.addEventListener('click', e => {
            if (detailPanel.style.display === 'block' &&
                !cloudElement.contains(e.target) && !detailPanel.contains(e.target)) {
                detailPanel.style.display = 'none';
            }
        }, true);
    }

    // ========== 刷新 ==========
    async function refreshDetection() {
        debugMessages = [];
        addDebug('🔄 手动刷新...');
        sessionStorage.removeItem(CACHE_KEY);
        const data = await detectAll();
        currentData = data;
        addDebug(data.cf ? (data.trace ? '✅ Cloudflare 正常' : '⚠️ Trace 不可用') : 'ℹ️ 非 CF 站点');
        if (data.clientIP) addDebug(`本机 IP: ${data.clientIP}`);
        if (data.colo) addDebug(`边缘节点: ${data.colo}`);
        data.targetIPs.forEach(ip => {
            const info = data.ipInfoCache[ip];
            if (info && info.info) addDebug(`目标 IP: ${ip} (${info.info})`);
            else if (info && info.error) addDebug(`目标 IP: ${ip} (归属地查询失败)`);
        });
        if (!cloudElement && data.cf) createCloudUI();
        if (detailPanel && detailPanel.style.display === 'block') renderPanel(data);
    }

    // ========== 启动 ==========
    (async function main() {
        const hostname = location.hostname;
        if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return;

        addDebug('🔍 检测: ' + hostname);
        const data = await detectAll();
        currentData = data;
        addDebug(data.cf ? (data.trace ? '✅ Cloudflare 正常' : '⚠️ Trace 不可用') : 'ℹ️ 非 CF 站点');
        if (data.clientIP) addDebug(`本机 IP: ${data.clientIP}`);
        if (data.colo) addDebug(`边缘节点: ${data.colo}`);
        data.targetIPs.forEach(ip => {
            const info = data.ipInfoCache[ip];
            if (info && info.info) addDebug(`目标 IP: ${ip} (${info.info})`);
            else if (info && info.error) addDebug(`目标 IP: ${ip} (归属地查询失败)`);
        });
        if (data.cf) createCloudUI();
    })();
})();
