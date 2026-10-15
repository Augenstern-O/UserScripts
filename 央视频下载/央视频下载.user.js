// ==UserScript==
// @name         央视频下载
// @name:en      CCTV Video Downloader
// @namespace    https://github.com/Augenstern-O
// @version      1.0.0
// @description  提取央视网视频 M3U8 地址，自动选择可用的最高清晰度；支持右侧吸附面板、复制链接及推送到已启动的本地 M3U8 下载器。
// @description:en Extract CCTV video M3U8 URLs, select the highest available quality, and copy or send links to a running local M3U8 downloader from a dockable sidebar.
// @author       Augenstern-O
// @license      LGPL-3.0
// @homepage     https://github.com/Augenstern-O/UserScripts/tree/main/央视频下载
// @supportURL   https://github.com/Augenstern-O/UserScripts/issues
// @match        *://*.cctv.com/*
// @match        *://*.cntv.cn/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      cctv.com
// @connect      cntv.cn
// @connect      lxdns.com
// @connect      cdn20.com
// @connect      qcloudcdn.com
// @connect      kcdnvip.com
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-start
// ==/UserScript==

// 初始化视频接口监听与下载面板。
(function () {
    'use strict';

    // 明文档位候选,按从高到低探测;4000 仅 4K 频道存在
    const CLEAR_QUALITIES = ['4000', '3000', '2000', '1200', '850', '450'];
    // 各档位大致分辨率标签(依据主列表 RESOLUTION 实测)
    const QUALITY_LABELS = { 4000: '4K·2160P', 3000: '1080P', 2000: '720P高码率', 1200: '720P', 850: '360P', 450: '270P' };
    // 最近一次捕获记录,3 秒内同一地址只处理一次,防止 XHR/Fetch 双钩子重复弹窗
    let lastCapture = { url: '', ts: 0 };

    // 油猴菜单:修改本地下载器的推送端口(下载器默认 8787,被占用会自动顺延,实际端口看它标题栏)
    if (typeof GM_registerMenuCommand === 'function') {
        // 提示输入并保存有效的本地端口号。
        GM_registerMenuCommand('设置下载器推送端口', function () {
            const v = prompt('M3U8下载器默认监听 8787 端口(被占用会顺延)。\n请输入实际端口(可在下载器标题栏查看):', getPushPort());
            const p = parseInt(v, 10);
            if (p > 0 && p < 65536) { GM_setValue('m3u8d_port', p); alert('已保存,推送端口改为 ' + p); }
        });
    }

    // 读取本地下载器推送端口(脚本菜单可改),默认 8787
    function getPushPort() {
        return (typeof GM_getValue === 'function' && GM_getValue('m3u8d_port')) || 8787;
    }

    // 推送任务到本地 M3U8 下载器(吾爱破解·逍遥一仙版)
    // 协议:POST http://127.0.0.1:{端口}/,body 为 JSON {data:配置内容, type:'2'}
    // 配置内容一行一条"名称,链接";模式2会按请求方式自动识别编码,UTF-8 中文任务名可正常入库
    function sendToDownloader(name, url, onDone) {
        // 配置行内不允许出现英文逗号和换行,统一替换成空格防止任务列错位
        const clean = String(name).replace(/[,\r\n]/g, ' ').trim() || 'cctv-video';
        const payload = JSON.stringify({ data: clean + ',' + url, type: '2' });
        GM_xmlhttpRequest({
            method: 'POST',
            url: 'http://127.0.0.1:' + getPushPort() + '/',
            data: payload,
            timeout: 5000,
            headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            // 校验本地下载器是否返回约定的 JSON 应答。
            onload: function (r) {
                // 下载器约定成功应答是 JSON;若 8787 被其他程序(如 Next.js 服务)占用,会返回 HTML 网页,需判为失败
                const body = (r.responseText || '').trim();
                let isJson = false;
                try { JSON.parse(body); isJson = true; } catch (e) { /* 不是 JSON */ }
                onDone(isJson, isJson ? body : 'HTML');
            },
            // 网络错误时通知面板显示启动提示。
            onerror: function () { onDone(false, ''); },
            // 请求超时时结束本次推送并提示重试。
            ontimeout: function () { onDone(false, ''); }
        });
    }

    // 反转义接口返回的 URL(处理 \/ 和 \u002F 两种转义写法)
    function unescapeUrl(u) {
        return (u || '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
    }

    // 把列表地址上的 maxbr(码率上限)参数拉满,让服务端放出全部档位(仅 h5e/enc 主列表需要)
    function maxMaxbr(url) {
        if (/([?&])maxbr=\d+/.test(url)) return url.replace(/([?&])maxbr=\d+/, '$1maxbr=99999');
        return url + (url.indexOf('?') > -1 ? '&' : '?') + 'maxbr=99999';
    }

    // 用 GM_xmlhttpRequest 拉取文本(绕过页面 CORS),失败返回空字符串
    function fetchText(url) {
        // 将脚本管理器的回调请求转换为可等待的文本结果。
        return new Promise(function (resolve) {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                timeout: 8000,
                headers: { Referer: 'https://tv.cctv.com/' },
                // 仅接受成功响应的正文。
                onload: function (r) { resolve(r.status === 200 ? r.responseText : ''); },
                // 网络错误视为当前档位不可用。
                onerror: function () { resolve(''); },
                // 超时后允许继续尝试其他档位。
                ontimeout: function () { resolve(''); }
            });
        });
    }

    // 从明文 450 档地址提取可替换的基础路径;形如 https://host/asp/hls/450/0303000a/3/default/{guid}/450.m3u8
    // 返回 {origin, dir} 或 null;dir 为档位号之前的目录部分(含尾部斜杠)
    function findClearBase(hlsUrl) {
        const m = (hlsUrl || '').match(/^(https:\/\/[^/]+\/asp\/hls\/)(?:main|4000|3000|2000|1200|850|450)(\/[^/?#]+\/[^/?#]+\/[^/?#]+\/[^/?#]+\/)(?:main|4000|3000|2000|1200|850|450)\.m3u8/);
        return m ? { origin: m[1], dir: m[2] } : null;
    }

    // 按档位号拼出明文子列表地址(不带 query,实测可直接访问)
    function buildClearUrl(base, quality) {
        return base.origin + quality + base.dir + quality + '.m3u8';
    }

    // 并行探测各档位是否存在(200 且内容是 m3u8 即存在),返回存在档位数组(从高到低)
    async function probeClearQualities(base) {
        // 为每个候选档位检查播放列表标记。
        const checks = CLEAR_QUALITIES.map(async function (q) {
            const body = await fetchText(buildClearUrl(base, q));
            return { q, ok: body.indexOf('#EXTM3U') === 0 };
        });
        const results = await Promise.all(checks);
        return results
            // 保留成功探测到的播放列表。
            .filter(function (r) { return r.ok; })
            // 按原有顺序返回可用档位号。
            .map(function (r) { return r.q; });
    }

    // 解析主播放列表的全部档位,按码率从高到低(h5e 回退路径用)
    function parseMaster(text, baseUrl) {
        if (!text || text.indexOf('#EXT-X-STREAM-INF') === -1) return [];
        const lines = text.split('\n');
        const list = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('#EXT-X-STREAM-INF') !== 0) continue;
            const bw = (lines[i].match(/BANDWIDTH=(\d+)/) || [])[1] || '0';
            const res = (lines[i].match(/RESOLUTION=([\dx]+)/i) || [])[1] || '';
            let uri = '';
            for (let k = i + 1; k < lines.length; k++) {
                const t = lines[k].trim();
                if (t && t.indexOf('#') !== 0) { uri = t; break; }
            }
            if (uri) list.push({ url: new URL(uri, baseUrl).href, bandwidth: parseInt(bw, 10), resolution: res });
        }
        // 将高码率档位排在前面，作为默认选择。
        return list.sort(function (a, b) { return b.bandwidth - a.bandwidth; });
    }

    // 入口:处理捕获到的接口响应
    function handleResponse(raw) {
        try {
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (data && (data.hls_url || data.manifest)) handleVideoInfo(data);
        } catch (e) { /* 非目标响应,静默忽略 */ }
    }

    // 主流程:明文高清探测 → h5e 回退 → 原地址兜底
    async function handleVideoInfo(data) {
        const title = data.title || '视频';
        // 1) 首选:从明文 450 地址模板探测更高档位(4000/3000/2000...),未加密可直接下载
        const base = findClearBase(unescapeUrl(data.hls_url));
        if (base) {
            const found = await probeClearQualities(base);
            if (found.length > 0) {
                // 把可用明文档位转换为面板选项。
                showPanel(title, found.map(function (q) {
                    return { url: buildClearUrl(base, q), label: QUALITY_LABELS[q] || (q + 'kbps') };
                }), false);
                return;
            }
        }
        // 2) 回退:h5e 主列表(载荷加扰,需支持解密的下载器),拉满 maxbr 取全部档位
        const h5e = data.manifest && data.manifest.hls_h5e_url;
        if (h5e) {
            const master = maxMaxbr(unescapeUrl(h5e));
            const variants = parseMaster(await fetchText(master), master);
            if (variants.length > 0) {
                // 展示加扰列表的分辨率与码率，保留加扰提示。
                showPanel(title, variants.map(function (v) {
                    return { url: v.url, label: (v.resolution || '未知') + '·' + Math.round(v.bandwidth / 1000) + 'kbps' };
                }), true);
                return;
            }
        }
        // 3) 兜底:直接给原 hls_url(通常只有 270P)
        showPanel(title, [{ url: unescapeUrl(data.hls_url), label: '默认档' }], false);
    }

    // 渲染默认收起的右侧面板，鼠标移入展开、移出立即收起。
    function showPanel(title, qualities, encrypted) {
        // 页面尚未挂载时延后渲染，避免提前去重导致首次面板被跳过。
        if (!document.body) {
            // DOM 就绪后使用本次捕获的数据渲染面板。
            document.addEventListener('DOMContentLoaded', function () { showPanel(title, qualities, encrypted); }, { once: true });
            return;
        }

        // 去重:3 秒内同一最高档地址只弹一次
        const now = Date.now();
        if (qualities[0].url === lastCapture.url && now - lastCapture.ts < 3000) return;
        lastCapture = { url: qualities[0].url, ts: now };

        // 替换旧面板，新视频同样默认收起。
        const old = document.getElementById('cctv-hls-dock');
        if (old) old.remove();

        const dock = document.createElement('div');
        dock.id = 'cctv-hls-dock';
        dock.style = 'position:fixed;top:20px;right:0;width:426px;max-width:100vw;display:flex;align-items:flex-start;z-index:99999;transition:transform .25s ease;transform:translateX(calc(100% - 36px));';

        const tab = document.createElement('button');
        tab.id = 'cctv-hls-tab';
        tab.type = 'button';
        tab.textContent = '视频下载';
        tab.title = '悬停或点击展开下载面板';
        tab.setAttribute('aria-controls', 'cctv-hls-panel');
        tab.setAttribute('aria-expanded', 'false');
        tab.style = 'flex:0 0 36px;box-sizing:border-box;width:36px;margin-top:16px;padding:12px 9px;border:0;border-radius:8px 0 0 8px;background:#2196f3;color:#fff;font-size:14px;line-height:18px;writing-mode:vertical-rl;letter-spacing:3px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.15);';

        const panel = document.createElement('div');
        panel.id = 'cctv-hls-panel';
        panel.setAttribute('aria-label', '央视频下载');
        // 挂载前设置收起状态，避免首次显示闪出完整面板。
        panel.inert = true;
        panel.setAttribute('aria-hidden', 'true');
        panel.style = 'flex:1;min-width:0;box-sizing:border-box;max-height:calc(100vh - 40px);overflow:auto;background:#fff;padding:15px;box-shadow:0 2px 10px rgba(0,0,0,0.2);border-radius:8px 0 0 8px;';

        // 加密回退时禁用发送按钮:该下载器只认标准 AES KEY,推加扰流只会下载出一堆花屏分片
        const sendBtn = encrypted
            ? '<button id="cctv-hls-send" disabled title="载荷加扰,普通下载器推送后无法解密,请用支持 H5E 解密的下载器(如 CCTVVideoDownloader)" style="flex:1;padding:8px;background:#ccc;color:#fff;border:none;border-radius:4px;cursor:not-allowed;">📤 推送下载</button>'
            : '<button id="cctv-hls-send" style="flex:1;padding:8px;background:#FF9800;color:#fff;border:none;border-radius:4px;cursor:pointer;">📤 推送下载</button>';

        panel.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
                '<h3 id="cctv-hls-title" style="margin:0;color:#333;font-size:15px;overflow-wrap:anywhere;"></h3>' +
                '<button id="cctv-hls-close" title="收起到右侧" aria-label="收起到右侧" style="background:none;border:none;cursor:pointer;color:#999;font-size:20px;line-height:1;padding:0 4px;">›</button>' +
            '</div>' +
            (encrypted
                ? '<div style="margin-bottom:8px;color:#e65100;font-size:12px;">⚠️ h5e/enc 流载荷加扰,直接下载会花屏,需用支持 H5E 解密的下载器(如 CCTVVideoDownloader)</div>'
                : '<div style="margin-bottom:8px;color:#2e7d32;font-size:12px;">✅ 明文流,已自动选取最高清晰度,可直接下载</div>') +
            '<select id="cctv-hls-quality" aria-label="视频清晰度" style="width:100%;padding:6px;margin-bottom:8px;border:1px solid #ddd;border-radius:4px;font-size:12px;"></select>' +
            '<input id="cctv-hls-url" readonly style="width:100%;box-sizing:border-box;padding:8px;margin-bottom:12px;border:1px solid #ddd;border-radius:4px;font-family:monospace;font-size:12px;cursor:text;">' +
            '<div style="display:flex;gap:8px;">' +
                '<button id="cctv-hls-copy" style="flex:1;padding:8px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;">📋 复制</button>' +
                '<button id="cctv-hls-open" style="flex:1;padding:8px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;">🔗 打开</button>' +
                sendBtn +
            '</div>' +
            '<div style="margin-top:10px;color:#666;font-size:12px;line-height:1.6;">支持推送到本地 M3U8 下载器，请先启动程序。<a href="https://xyyx.lanzouw.com/i9hcAwj48be" target="_blank" rel="noopener noreferrer" style="color:#1976d2;">下载 M3U8 下载器</a></div>' +
            '<div id="cctv-hls-status" style="display:none;margin-top:8px;font-size:12px;line-height:1.5;word-break:break-all;"></div>';

        dock.appendChild(tab);
        dock.appendChild(panel);
        document.body.appendChild(dock);
        panel.querySelector('#cctv-hls-title').textContent = '🎬 ' + title.slice(0, 22);

        const input = panel.querySelector('#cctv-hls-url');
        const select = panel.querySelector('#cctv-hls-quality');
        // 使用文本节点生成清晰度选项，避免把接口内容作为页面标记解析。
        qualities.forEach(function (quality, index) {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = quality.label + (index === 0 ? '（最高）' : '');
            select.appendChild(option);
        });
        input.value = qualities[0].url;

        // 切换清晰度:同步更新地址栏
        select.addEventListener('change', function () {
            input.value = qualities[parseInt(select.value, 10)].url;
        });

        // 手动收起时保留侧边入口和当前清晰度，稍后可直接展开。
        panel.querySelector('#cctv-hls-close').addEventListener('click', collapsePanel);

        // 复制当前下拉框对应的地址
        document.getElementById('cctv-hls-copy').addEventListener('click', function () {
            GM_setClipboard(input.value, 'text');
            GM_notification({ title: '✅ 复制成功', text: 'm3u8 地址已复制到剪贴板', timeout: 2000, highlight: true });
            panel.style.background = '#f8fff9';
            // 复制反馈结束后恢复面板背景色。
            setTimeout(function () { panel.style.background = '#fff'; }, 500);
        });

        // 打开:新标签页打开当前地址,交给在线 ffmpeg 等工具处理
        document.getElementById('cctv-hls-open').addEventListener('click', function () {
            window.open(input.value, '_blank');
        });

        // 发送:把当前地址作为任务推送到本地 M3U8 下载器,结果用内联状态行展示
        document.getElementById('cctv-hls-send').addEventListener('click', function () {
            const status = document.getElementById('cctv-hls-status');
            const label = qualities[parseInt(select.value, 10)].label;
            status.style.display = 'block';
            status.style.color = '#888';
            status.textContent = '⏳ 正在推送到 127.0.0.1:' + getPushPort() + ' …';
            // 任务名带上清晰度标签,避免同视频不同档位推送后在下载器队列里重名
            // 展示下载器响应，并提示启动程序或修正监听端口。
            sendToDownloader(title + '·' + label, input.value, function (ok, text) {
                if (ok) {
                    status.style.color = '#2e7d32';
                    status.textContent = '✅ 已推送,请到 M3U8 下载器窗口查看任务';
                } else if (text === 'HTML') {
                    // 端口被其他程序(如 Next.js 服务)占用:HTTP 通了但对方不是下载器
                    status.style.color = '#c62828';
                    status.textContent = '❌ ' + getPushPort() + ' 端口被其他程序占用(应答是网页不是下载器)。下载器实际监听的是顺延后的其他端口——看下载器标题栏的实际端口,点油猴菜单"设置下载器推送端口"修改后重试';
                } else {
                    // 连接失败/超时:端口上没有程序在听
                    status.style.color = '#c62828';
                    status.textContent = '❌ 推送失败:' + getPushPort() + ' 端口未检测到下载器。请先启动 M3U8 下载器;若它因 8787 被占用改用了其他端口,请在脚本菜单"设置下载器推送端口"里修改';
                }
            });
        });

        // 把内容滑到屏幕右侧，仅保留三十六像素宽的入口。
        function collapsePanel() {
            if (panel.contains(document.activeElement)) document.activeElement.blur();
            panel.inert = true;
            panel.setAttribute('aria-hidden', 'true');
            tab.setAttribute('aria-expanded', 'false');
            dock.style.transform = 'translateX(calc(100% - 36px))';
        }

        // 悬停、点击或聚焦侧边入口时恢复面板及原有选择。
        function expandPanel() {
            panel.inert = false;
            panel.removeAttribute('aria-hidden');
            tab.setAttribute('aria-expanded', 'true');
            dock.style.transform = 'translateX(0)';
        }

        dock.addEventListener('mouseenter', expandPanel);
        dock.addEventListener('mouseleave', collapsePanel);
        // 键盘焦点离开时同步收起，鼠标仍在面板内则保持展开。
        dock.addEventListener('focusout', function (event) {
            if (!dock.contains(event.relatedTarget) && !dock.matches(':hover')) collapsePanel();
        });
        tab.addEventListener('click', expandPanel);
        tab.addEventListener('focus', expandPanel);
    }

    // 拦截 XHR:监听 getHttpVideoInfo.do 接口的响应
    const originalOpen = XMLHttpRequest.prototype.open;
    // 保留原请求行为，仅为视频信息接口附加响应监听。
    XMLHttpRequest.prototype.open = function (method, url) {
        if (typeof url === 'string' && url.indexOf('getHttpVideoInfo.do') > -1) {
            // 请求完成后读取并解析视频信息。
            this.addEventListener('load', function () {
                try { handleResponse(this.responseText); } catch (e) { console.error('[m3u8提取] 解析失败:', e); }
            });
        }
        return originalOpen.apply(this, arguments);
    };

    // 拦截 Fetch:兼容传入字符串与 Request 对象两种调用方式
    const originalFetch = window.fetch;
    // 复制视频信息响应供面板解析，原响应仍交给网站使用。
    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('getHttpVideoInfo.do') > -1) {
            const response = await originalFetch.apply(this, arguments);
            try { response.clone().text().then(handleResponse); } catch (e) { /* 忽略 */ }
            return response;
        }
        return originalFetch.apply(this, arguments);
    };
})();
