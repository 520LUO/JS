// ==UserScript==
// @name         Cloudflare 站点检测 (Trace + DNS 目标IP + ECS + 边缘归属)
// @namespace    https://github.com/52luo/js/cf-detector
// @version      6.3
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

    // ==================== 配置 ====================
    const DNS_RESOLVER_URL = 'https://cloudflare-dns.com/dns-query';
    const IPINFO_API_TEMPLATE = 'https://api.db-ip.com/v2/free/${ip}'; // 准确率高
    const CACHE_KEY = 'cf_trace_dns_cache';
    const CACHE_TTL = 30000;
    // ==================== 配置结束 ====================

    // 隐藏滚动条
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        #cf-detail-panel::-webkit-scrollbar, .cf-ip-scroll::-webkit-scrollbar { display: none; }
        #cf-detail-panel, .cf-ip-scroll { scrollbar-width: none; -ms-overflow-style: none; }
    `;
    document.head.appendChild(styleEl);

    // ---------- 缓存 ----------
    function cacheGet() {
        try {
            var raw = sessionStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            var data = JSON.parse(raw);
            if (Date.now() - data.t > CACHE_TTL) return null;
            return data.v;
        } catch (e) { return null; }
    }
    function cacheSet(v) {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), v }));
    }

    // ---------- 工具 ----------
    function countryCodeToFlag(code) {
        if (!code || code.length !== 2) return '';
        var a = code.charCodeAt(0) - 65 + 0x1F1E6;
        var b = code.charCodeAt(1) - 65 + 0x1F1E6;
        return String.fromCodePoint(a, b);
    }

    var coloCountryMap = {
        KHN:'CN',CAN:'CN',SZX:'CN',SHA:'CN',PVG:'CN',PEK:'CN',BJS:'CN',
        CKG:'CN',CTU:'CN',KMG:'CN',XIY:'CN',HGH:'CN',WUH:'CN',CSX:'CN',
        SHE:'CN',DLC:'CN',TAO:'CN',XMN:'CN',NGB:'CN',NKG:'CN',HRB:'CN',
        TSN:'CN',URC:'CN',LXA:'CN',KWE:'CN',FOC:'CN',CZX:'CN',CGD:'CN',
        ACX:'CN',BHY:'CN',CGO:'CN',FUO:'CN',HAK:'CN',HFE:'CN',HYN:'CN',
        JXG:'CN',LHW:'CN',LYA:'CN',NNG:'CN',PKX:'CN',SJW:'CN',TEN:'CN',
        TNA:'CN',TYN:'CN',WHU:'CN',XFN:'CN',XNN:'CN',ZGN:'CN',
        TPE:'TW',KHH:'TW',HKG:'HK',MFM:'MO',
        NRT:'JP',HND:'JP',KIX:'JP',NGO:'JP',FUK:'JP',OKA:'JP',
        ICN:'KR',PUS:'KR',SIN:'SG',KUL:'MY',KCH:'MY',JHB:'MY',
        CGK:'ID',DPS:'ID',JOG:'ID',MLG:'ID',MNL:'PH',CEB:'PH',CRK:'PH',CGY:'PH',
        BKK:'TH',CNX:'TH',URT:'TH',SGN:'VN',HAN:'VN',DAD:'VN',
        DEL:'IN',BOM:'IN',MAA:'IN',BLR:'IN',HYD:'IN',CCU:'IN',
        AMD:'IN',AGR:'IN',BBI:'IN',CJB:'IN',COK:'IN',CNN:'IN',IXC:'IN',KNU:'IN',NAG:'IN',PAT:'IN',PNQ:'IN',
        SEA:'US',PDX:'US',SFO:'US',OAK:'US',SJC:'US',SMF:'US',LAX:'US',SAN:'US',LAS:'US',PHX:'US',SLC:'US',DEN:'US',
        ABQ:'US',TUS:'US',OKC:'US',DFW:'US',IAH:'US',AUS:'US',SAT:'US',MCI:'US',STL:'US',MEM:'US',MSY:'US',BNA:'US',
        ATL:'US',JAX:'US',MCO:'US',TPA:'US',MIA:'US',CLT:'US',RDU:'US',IAD:'US',DCA:'US',BWI:'US',RIC:'US',ORF:'US',
        PHL:'US',JFK:'US',EWR:'US',LGA:'US',BOS:'US',BUF:'US',PIT:'US',CLE:'US',CVG:'US',CMH:'US',IND:'US',DTW:'US',
        MKE:'US',ORD:'US',MSP:'US',OMA:'US',FSD:'US',ANC:'US',HNL:'US',
        YVR:'CA',YYC:'CA',YEG:'CA',YXE:'CA',YWG:'CA',YYZ:'CA',YOW:'CA',YUL:'CA',YHZ:'CA',
        LHR:'GB',LGW:'GB',MAN:'GB',EDI:'GB',BHX:'GB',GLA:'GB',
        FRA:'DE',MUC:'DE',DUS:'DE',TXL:'DE',BER:'DE',HAM:'DE',STR:'DE',HAJ:'DE',
        CDG:'FR',ORY:'FR',MRS:'FR',LYS:'FR',NCE:'FR',BOD:'FR',
        AMS:'NL',RTM:'NL',
        MXP:'IT',LIN:'IT',BGY:'IT',FCO:'IT',NAP:'IT',VCE:'IT',PMO:'IT',
        MAD:'ES',BCN:'ES',VLC:'ES',AGP:'ES',SVQ:'ES',
        ZRH:'CH',GVA:'CH',ARN:'SE',GOT:'SE',CPH:'DK',OSL:'NO',HEL:'FI',
        WAW:'PL',WRO:'PL',KRK:'PL',VIE:'AT',BRU:'BE',DUB:'IE',ORK:'IE',
        LIS:'PT',OPO:'PT',
        DME:'RU',LED:'RU',KJA:'RU',SVX:'RU',
        IST:'TR',ADB:'TR',ANK:'TR',DXB:'AE',AUH:'AE',JED:'SA',RUH:'SA',DMM:'SA',
        GRU:'BR',CGH:'BR',VCP:'BR',GIG:'BR',BSB:'BR',CNF:'BR',CWB:'BR',POA:'BR',FLN:'BR',SSA:'BR',
        REC:'BR',FOR:'BR',BEL:'BR',MAO:'BR',GOI:'BR',UDI:'BR',CGB:'BR',PMW:'BR',JDO:'BR',RAO:'BR',
        SJK:'BR',SJP:'BR',SOD:'BR',ITJ:'BR',JOI:'BR',NVT:'BR',CAW:'BR',ARU:'BR',CFC:'BR',BNU:'BR',
        XAP:'BR',QWJ:'BR',
        PER:'AU',ADL:'AU',MEL:'AU',SYD:'AU',CBR:'AU',BNE:'AU',HBA:'AU',
        AKL:'NZ',WLG:'NZ',CHC:'NZ',JNB:'ZA',CPT:'ZA',DUR:'ZA',
        MEX:'MX',GDL:'MX',MTY:'MX',QRO:'MX',
        BOG:'CO',MDE:'CO',CLO:'CO',BAQ:'CO',
        EZE:'AR',AEP:'AR',COR:'AR',NQN:'AR',
        SCL:'CL',ARI:'CL',CCP:'CL',
        LIM:'PE',CUZ:'PE',UIO:'EC',GYE:'EC',LPB:'BO',VVI:'BO',ASU:'PY',MVD:'UY',GEO:'GY',PBM:'SR',
        SJO:'CR',PTY:'PA',GUA:'GT',SAP:'HN',TGU:'HN',
        GCM:'KY',NAS:'BS',KIN:'JM',PAP:'HT',SDQ:'DO',STI:'DO',SJU:'PR',BGI:'BB',GND:'GD',MBJ:'JM',SXM:'SX',UVF:'LC',
        LOS:'NG',ABV:'NG',NBO:'KE',MBA:'KE',DAR:'TZ',MPM:'MZ',LLW:'MW',LUN:'ZM',HRE:'ZW',GBE:'BW',WDH:'NA',TNR:'MG',MRU:'MU',
        ADD:'ET',JIB:'DJ',KGL:'RW',EBB:'UG',CAI:'EG',ALY:'EG',CMN:'MA',RAK:'MA',
        ALG:'DZ',ORN:'DZ',CZL:'DZ',AAE:'DZ',TUN:'TN',DKR:'SN',DSS:'SN',ACC:'GH',ABJ:'CI',ASK:'CI',
        LFW:'TG',COO:'BJ',BKO:'ML',OUA:'BF',FIH:'CD',
        ULN:'MN',KIV:'MD',MSQ:'BY',KBP:'UA',RIX:'LV',VNO:'LT',TLL:'EE',KEF:'IS',LUX:'LU',PRG:'CZ',BTS:'SK',BUD:'HU',
        LJU:'SI',ZAG:'HR',BEG:'RS',TIA:'AL',SKP:'MK',SOF:'BG',OTP:'RO',CLJ:'RO',ATH:'GR',SKG:'GR',HER:'GR',MLA:'MT',
        BEY:'LB',AMM:'JO',TLV:'IL',HFA:'IL',ZDM:'PS',BGW:'IQ',BSR:'IQ',EBL:'IQ',ISU:'IQ',NJF:'IQ',XNH:'IQ',
        EVN:'AM',GYD:'AZ',TBS:'GE',LLK:'AZ',SUV:'FJ',NAN:'FJ',NOU:'NC',PPT:'PF',GUM:'GU',
        LOCAL:'','N/A':''
    };

    function getCountryName(code) {
        try {
            return new Intl.DisplayNames('zh-Hans', { type: 'region' }).of(code) || code;
        } catch (e) { return code; }
    }

    // ---------- DNS (ECS) ----------
    function dnsResolve(hostname, type, clientIP) {
        return new Promise(function (resolve) {
            var url = DNS_RESOLVER_URL + '?name=' + encodeURIComponent(hostname) + '&type=' + type;
            if (clientIP) url += '&edns_client_subnet=' + clientIP;
            GM.xmlHttpRequest({
                method: 'GET',
                url: url,
                headers: { 'Accept': 'application/dns-json' },
                timeout: 5000,
                onload: function (resp) {
                    if (resp.status !== 200) return resolve([]);
                    try {
                        var data = JSON.parse(resp.responseText);
                        if (!data.Answer) return resolve([]);
                        var ips = data.Answer.filter(function (r) { return r.type === 1 || r.type === 28; }).map(function (r) { return r.data; });
                        resolve(ips);
                    } catch (e) { resolve([]); }
                },
                onerror: function () { resolve([]); },
                ontimeout: function () { resolve([]); }
            });
        });
    }

    async function resolveTargetIPs(hostname, clientIP) {
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(hostname)) {
            return [hostname];
        }
        var a = dnsResolve(hostname, 'A', clientIP);
        var aaaa = dnsResolve(hostname, 'AAAA', clientIP);
        var arrA = await a;
        var arrAAAA = await aaaa;
        var all = arrA.concat(arrAAAA);
        return [...new Set(all)];
    }

    // ---------- 归属地 (db-ip) ----------
    function getIPInfo(ip) {
        return new Promise(function (resolve) {
            var url = IPINFO_API_TEMPLATE.replace('${ip}', ip);
            GM.xmlHttpRequest({
                method: 'GET',
                url: url,
                headers: { 'Accept': 'application/json' },
                timeout: 8000,
                onload: function (resp) {
                    try {
                        if (resp.status !== 200) return resolve({ error: 'HTTP ' + resp.status });
                        var data = JSON.parse(resp.responseText);
                        if (data.countryName) {
                            var parts = [data.countryName, data.city].filter(Boolean);
                            resolve({ info: parts.join(', '), countryCode: data.countryCode || '' });
                            return;
                        }
                        resolve({ error: '格式异常' });
                    } catch (e) { resolve({ error: '解析失败' }); }
                },
                onerror: function () { resolve({ error: '网络错误' }); },
                ontimeout: function () { resolve({ error: '超时' }); }
            });
        });
    }

    // ---------- 检测 ----------
    async function detectAll() {
        var cached = cacheGet();
        if (cached) return cached;

        var result = { cf: false, colo: null, trace: false, clientIP: null, targetIPs: [], ipInfoCache: {} };

        // 1. HEAD
        try {
            var headResp = await fetch(location.href, { method: 'HEAD', cache: 'no-store' });
            var server = headResp.headers.get('server') || '';
            var cfRay = headResp.headers.get('cf-ray') || '';
            if (server.toLowerCase().indexOf('cloudflare') !== -1 || cfRay) result.cf = true;
        } catch (e) {}

        // 2. Trace
        if (result.cf) {
            try {
                var ctrl = new AbortController();
                var timer = setTimeout(function () { ctrl.abort(); }, 3000);
                var traceResp = await fetch(location.origin + '/cdn-cgi/trace', { signal: ctrl.signal, cache: 'no-store' });
                clearTimeout(timer);
                if (traceResp.ok) {
                    var text = await traceResp.text();
                    var coloMatch = text.match(/^colo=([A-Z]+)$/m);
                    var ipMatch = text.match(/^ip=([^\s]+)$/m);
                    if (coloMatch) { result.colo = coloMatch[1].trim(); result.trace = true; }
                    if (ipMatch) result.clientIP = ipMatch[1].trim();
                }
            } catch (e) {}
        }

        // 3. 目标 IP + 归属地
        if (result.cf) {
            var ips = await resolveTargetIPs(location.hostname, result.clientIP);
            result.targetIPs = ips;
            var infoPromises = ips.map(function (ip) {
                return getIPInfo(ip).then(function (info) {
                    result.ipInfoCache[ip] = info;
                });
            });
            await Promise.all(infoPromises);
        }

        cacheSet(result);
        return result;
    }

    function getStatus(data) {
        if (!data.cf) return { text: '非 Cloudflare站点', dot: '🔴', color: '#ef4444' };
        if (data.trace) return { text: 'Cloudflare 站点', dot: '🟢', color: '#18a058' };
        return { text: 'Cloudflare 已启用', dot: '🟡', color: '#f59e0b' };
    }

    // ========== UI ==========
    var cloudElement = null, detailPanel = null;
    var currentData = null;
    var debugMessages = [];
    var showDebug = false;

    function addDebug(msg) {
        debugMessages.push(msg);
        if (debugMessages.length > 10) debugMessages.shift();
        if (detailPanel && detailPanel.style.display === 'block' && showDebug) updateDebugArea();
    }

    function updateDebugArea() {
        var debugDiv = detailPanel && detailPanel.querySelector('#cf-debug-area');
        if (debugDiv) {
            debugDiv.innerHTML = showDebug ? debugMessages.map(function (m) { return '<div style="font-size:10px; color:#555; word-break:break-all;">' + m + '</div>'; }).join('') : '';
        }
    }

    function toggleDebugVisibility() {
        showDebug = !showDebug;
        updateDebugArea();
    }

    function renderPanel(data) {
        if (!detailPanel) return;
        var st = getStatus(data);
        var html = '<div style="padding-bottom: 40px;">';

        html += '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">';
        html += '<div style="font-weight:bold; font-size:14px;">🌐 ' + location.hostname + '</div>';
        html += '<button id="cf-refresh-btn" title="刷新" style="width:28px; height:28px; border-radius:50%; background:rgba(255,255,255,0.5); border:0.5px solid rgba(255,255,255,0.9); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); box-shadow:inset 0 1px 3px rgba(255,255,255,0.8), 0 2px 6px rgba(0,0,0,0.08); display:flex; align-items:center; justify-content:center; cursor:pointer; color:#555; font-size:16px;">↻</button>';
        html += '</div>';

        html += '<div style="margin-bottom:8px;"><span>状态：</span><span style="font-weight:bold; color:' + st.color + ';">' + st.dot + ' ' + st.text + '</span></div>';

        if (data.clientIP) {
            html += '<div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;"><span>本机 IP：</span>';
            html += '<span class="cf-ip-addr" data-ip="' + data.clientIP + '" style="font-family:monospace; font-size:12px; color:#1a1a1a; background:rgba(255,255,255,0.5); padding:2px 8px; border-radius:6px; cursor:pointer;">' + data.clientIP + '</span></div>';
        }

        if (data.cf && data.colo) {
            var cc = coloCountryMap[data.colo] || '';
            var flag = cc ? countryCodeToFlag(cc) + ' ' : '';
            var cn = cc ? getCountryName(cc) : '未知';
            html += '<div style="margin-bottom:8px;">实际访问的边缘IP归属：' + flag + data.colo + ' ' + cn + '</div>';
        } else if (data.cf && !data.colo) {
            html += '<div style="margin-bottom:8px; color:#888;">边缘节点未知</div>';
        }

        if (data.cf && data.targetIPs.length > 0) {
            html += '<div style="margin-top:12px;"><div style="font-weight:bold; font-size:12px; color:#444; margin-bottom:6px;">DOH解析到的目标IP (' + data.targetIPs.length + ')</div><div style="padding-left:4px;">';
            data.targetIPs.forEach(function (ip) {
                var info = data.ipInfoCache[ip];
                var infoText = info ? (info.info || '查询失败') : '查询中...';
                var ipFlag = info && info.countryCode ? countryCodeToFlag(info.countryCode) + ' ' : '';
                var isError = info && !info.info;
                html += '<div style="display:flex; align-items:center; margin-bottom:6px; gap:8px;">';
                html += '<div class="cf-ip-scroll" style="width:150px; min-width:150px; max-width:150px; overflow-x:auto; white-space:nowrap; background:rgba(255,255,255,0.5); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.8); border-radius:10px; padding:4px 8px; box-shadow:0 0 8px rgba(255,255,255,0.4), inset 0 1px 4px rgba(255,255,255,0.6);">';
                html += '<span class="cf-ip-addr" data-ip="' + ip + '" style="font-family:monospace; font-size:12px; color:#1a1a1a; cursor:pointer;">' + ip + '</span></div>';
                html += '<span style="color:' + (isError ? '#c00' : '#333') + '; font-size:11px; flex:1; word-break:break-word;">' + ipFlag + infoText + '</span></div>';
            });
            html += '</div></div>';
        } else if (data.cf && data.targetIPs.length === 0) {
            html += '<div style="color:#888; margin-top:10px;">无法解析目标 IP</div>';
        }

        html += '<div id="cf-debug-area" style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.1); display:' + (showDebug ? 'block' : 'none') + ';">';
        html += (showDebug ? debugMessages.map(function (m) { return '<div style="font-size:10px; color:#555; word-break:break-all;">' + m + '</div>'; }).join('') : '');
        html += '</div></div>';

        detailPanel.innerHTML = html;

        // 粘性日志按钮
        var oldSticky = detailPanel.querySelector('#cf-debug-sticky');
        if (oldSticky) oldSticky.remove();
        var stickyBtn = document.createElement('div');
        stickyBtn.id = 'cf-debug-sticky';
        stickyBtn.style.cssText = 'position:sticky; bottom:0; display:flex; justify-content:flex-end; margin-top:-40px; pointer-events:none; z-index:15;';
        var toggleBtn = document.createElement('button');
        toggleBtn.id = 'cf-debug-toggle';
        toggleBtn.title = showDebug ? '收起日志' : '展开日志';
        toggleBtn.style.cssText = 'width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,0.6); border:0.5px solid rgba(255,255,255,0.9); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); box-shadow:0 2px 8px rgba(0,0,0,0.08), inset 0 1px 3px rgba(255,255,255,0.8); display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:16px; color:#444; pointer-events:auto; margin-right:8px; margin-bottom:8px;';
        toggleBtn.innerHTML = '📋';
        toggleBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleDebugVisibility();
            this.title = showDebug ? '收起日志' : '展开日志';
            var debugArea = detailPanel.querySelector('#cf-debug-area');
            if (debugArea) {
                debugArea.style.display = showDebug ? 'block' : 'none';
                if (showDebug) updateDebugArea();
            }
        });
        stickyBtn.appendChild(toggleBtn);
        detailPanel.appendChild(stickyBtn);

        // 刷新按钮
        var refreshBtn = detailPanel.querySelector('#cf-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                (async function () { await refreshDetection(); })();
            });
        }

// IP 复制
        var ipSpans = detailPanel.querySelectorAll('.cf-ip-addr');
        ipSpans.forEach(function (span) {
            span.addEventListener('click', function (e) {
                e.stopPropagation();
                var ip = this.dataset.ip;
                (async function () {
                    try { await navigator.clipboard.writeText(ip); } catch (ex) {
                        var textarea = document.createElement('textarea');
                        textarea.value = ip;
                        document.body.appendChild(textarea);
                        textarea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textarea);
                    }
                    var original = span.textContent;
                    span.textContent = '已复制 ✓';
                    span.style.color = '#0a0';
                    setTimeout(function () { span.textContent = original; span.style.color = '#1a1a1a'; }, 1500);
                })();
            });
        });
    }

    function createCloudUI() {
        if (cloudElement) return;
        cloudElement = document.createElement('div');
        cloudElement.id = 'cf-cloud-indicator';
        cloudElement.title = 'Cloudflare 站点';
        cloudElement.style.cssText = 'position:fixed; bottom:16px; right:16px; width:22px; height:22px; background:rgba(255,255,0,0.45); border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:2147483647; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); box-shadow:0 0 16px rgba(255,255,0,0.6), inset 0 1px 5px rgba(255,255,255,0.9); border:0.5px solid rgba(255,255,255,0.5);';
        var icon = document.createElement('span');
        icon.textContent = '☁️';
        icon.style.cssText = 'font-size:13px;';
        var dot = document.createElement('span');
        dot.style.cssText = 'position:absolute; top:1px; right:1px; width:5px; height:5px; background:#0f0; border-radius:50%; box-shadow:0 0 4px #0f0;';
        cloudElement.appendChild(icon);
        cloudElement.appendChild(dot);
        document.body.appendChild(cloudElement);

        detailPanel = document.createElement('div');
        detailPanel.id = 'cf-detail-panel';
        detailPanel.style.cssText = 'position:fixed; bottom:45px; right:16px; width:310px; max-height:400px; overflow-y:auto; background:rgba(240,240,245,0.65); backdrop-filter:blur(30px) saturate(90%); -webkit-backdrop-filter:blur(30px) saturate(90%); border-radius:20px; padding:18px 18px 0 18px; font-size:13px; color:#1a1a1a; z-index:2147483646; box-shadow:inset 0 0 25px rgba(255,255,255,0.6), 0 6px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.6); border:none; display:none;';
        document.body.appendChild(detailPanel);

        cloudElement.addEventListener('click', function () {
            if (detailPanel.style.display === 'none') {
                detailPanel.style.display = 'block';
                if (currentData) renderPanel(currentData);
            } else {
                detailPanel.style.display = 'none';
            }
        });

        document.addEventListener('click', function (e) {
            if (detailPanel.style.display === 'block' && !cloudElement.contains(e.target) && !detailPanel.contains(e.target)) {
                detailPanel.style.display = 'none';
            }
        }, true);
    }

    async function refreshDetection() {
        debugMessages = [];
        addDebug('🔄 手动刷新...');
        sessionStorage.removeItem(CACHE_KEY);
        var data = await detectAll();
        currentData = data;
        addDebug(data.cf ? (data.trace ? '✅ Cloudflare 正常' : '⚠️ Trace 不可用') : 'ℹ️ 非 CF 站点');
        if (data.clientIP) addDebug('本机 IP: ' + data.clientIP);
        if (data.colo) addDebug('边缘节点: ' + data.colo);
        data.targetIPs.forEach(function (ip) {
            var info = data.ipInfoCache[ip];
            if (info && info.info) addDebug('目标 IP: ' + ip + ' (' + info.info + ')');
            else if (info && info.error) addDebug('目标 IP: ' + ip + ' (归属地查询失败)');
        });
        if (!cloudElement && data.cf) createCloudUI();
        if (detailPanel && detailPanel.style.display === 'block') renderPanel(data);
    }

    // 启动
    (async function main() {
        var hostname = location.hostname;
        if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return;

        addDebug('🔍 检测: ' + hostname);
        var data = await detectAll();
        currentData = data;
        addDebug(data.cf ? (data.trace ? '✅ Cloudflare 正常' : '⚠️ Trace 不可用') : 'ℹ️ 非 CF 站点');
        if (data.clientIP) addDebug('本机 IP: ' + data.clientIP);
        if (data.colo) addDebug('边缘节点: ' + data.colo);
        data.targetIPs.forEach(function (ip) {
            var info = data.ipInfoCache[ip];
            if (info && info.info) addDebug('目标 IP: ' + ip + ' (' + info.info + ')');
            else if (info && info.error) addDebug('目标 IP: ' + ip + ' (归属地查询失败)');
        });
        if (data.cf) createCloudUI();
    })();
})();