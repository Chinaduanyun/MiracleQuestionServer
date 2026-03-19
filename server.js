const http = require('http');
const https = require('https');
const fs = require('fs/promises');
const path = require('path');

const workspaceRoot = __dirname;
const publicDir = path.join(workspaceRoot, 'public');
const port = process.env.PORT || 3838;

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
};

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, { 'Content-Type': mimeTypes['.json'] });
    response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message) {
    response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(message);
}

function resolveSafePath(baseDir, requestPath) {
    const decodedPath = decodeURIComponent(requestPath.split('?')[0]);
    const normalizedPath = path.normalize(decodedPath).replace(/^([.][.][/\\])+/, '');
    const absolutePath = path.join(baseDir, normalizedPath);
    if (!absolutePath.startsWith(baseDir)) return null;
    return absolutePath;
}

/* ---- HTTP helpers ---- */

function fetchJsonGet(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'icon-canvas/1.0' } }, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                reject(new Error(`HTTP ${res.statusCode}`));
                res.resume();
                return;
            }
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        if (timeoutMs > 0) req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    });
}

function fetchPost(urlStr, body, headers, timeoutMs) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const postData = typeof body === 'string' ? body : JSON.stringify(body);
        const opts = {
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname + u.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'icon-canvas/1.0',
                ...headers
            }
        };
        const req = https.request(opts, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                reject(new Error(`HTTP ${res.statusCode}`));
                res.resume();
                return;
            }
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        if (timeoutMs > 0) req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
        req.write(postData);
        req.end();
    });
}

/* ---- iconfont.cn (primary, supports Chinese) ---- */

const ICONFONT_TIMEOUT = 8000;

async function searchIconfont(query, pageSize) {
    const safePageSize = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 100);
    const body = `type=icon&q=${encodeURIComponent(query.slice(0, 100))}&page=1&pageSize=${safePageSize}&fromCollection=-1`;
    const headers = {
        'Cookie': 'ctoken=icon_canvas_token',
        'x-csrf-token': 'icon_canvas_token'
    };
    const result = await fetchPost(
        'https://www.iconfont.cn/api/icon/search.json',
        body, headers, ICONFONT_TIMEOUT
    );
    if (!result || result.code !== 200 || !result.data) {
        throw new Error('iconfont returned unexpected data');
    }
    const icons = (result.data.icons || []).map((ic) => {
        const svg = ic.show_svg || '';
        const url = svg
            ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
            : '';
        return { id: 'iconfont-' + ic.id, name: ic.name || '', url };
    }).filter((ic) => ic.url);
    return { icons, total: result.data.count || icons.length, source: 'iconfont.cn' };
}

/* ---- Iconify (fallback, English) ---- */

const ICONIFY_MIRRORS = [
    'https://api.iconify.design',
    'https://api.simplesvg.com',
    'https://api.unisvg.com'
];
const ICONIFY_TIMEOUT = 5000;
const IMAGE_EXTRA_PROMPT = '参考图片中的元素，构建一个合理的结构布置顺序，禁止使用原始的图标。\n生成在现实生活中物品和人物的场景。\n图片风格充满生活化';

/* ---- Seed 2.0 Vision Analysis Prompt ---- */

const SEED2_ANALYSIS_PROMPT = `结合图标图片的元素与文字描述，提取以下要素，并将其简明、具体地转化为中文图像生成提示词：

时间（如：清晨/傍晚/春天/夏天等）
地点/环境（如：卧室/花园/公园/城市/乡村等）
人物（如：独自/与朋友/家庭成员等，人物外貌、年龄、性别等可选）
主要动作（如：散步/阅读/享受早餐/微笑/交谈等）
细节元素（如：阳光/花朵/鸟鸣/窗户/健康早餐/书本等）
氛围与情感（如：温暖/平静/充满希望/安全感/明亮/柔和等）

请用中文简洁地描述上述要素，合成为一句适合AI绘画模型的图像生成提示词（prompt），避免冗长和抽象词汇，突出画面感和细节

输出格式：

时间+地点+人物+动作+细节+氛围`;

/* ---- Debug log system (in-memory, keeps last 50 entries) ---- */

const debugLogs = [];
const MAX_DEBUG_LOGS = 50;

function addDebugLog(entry) {
    entry.id = Date.now() + '-' + Math.random().toString(16).slice(2, 8);
    entry.timestamp = new Date().toISOString();
    debugLogs.unshift(entry);
    if (debugLogs.length > MAX_DEBUG_LOGS) debugLogs.length = MAX_DEBUG_LOGS;
    console.log(`[debug] ${entry.step || 'log'}: ${entry.status || ''} ${entry.message || ''}`);
    return entry;
}

async function searchIconify(query, limit) {
    const safeQuery = encodeURIComponent(query.slice(0, 100));
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 64, 1), 200);
    let lastError = null;
    for (const mirror of ICONIFY_MIRRORS) {
        try {
            const result = await fetchJsonGet(`${mirror}/search?query=${safeQuery}&limit=${safeLimit}`, ICONIFY_TIMEOUT);
            const icons = (result.icons || []).map((fullName) => {
                const [prefix, ...rest] = fullName.split(':');
                const name = rest.join(':');
                return {
                    id: fullName,
                    name,
                    prefix,
                    url: `${mirror}/${prefix}/${name}.svg`
                };
            });
            return { icons, total: result.total || icons.length, source: mirror };
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error('All Iconify mirrors failed');
}

/* ---- Combined search: iconfont first, Iconify fallback ---- */

async function searchIcons(query, limit) {
    try {
        return await searchIconfont(query, limit);
    } catch (e) {
        console.log('[search] iconfont failed:', e.message, '→ trying Iconify');
    }
    try {
        return await searchIconify(query, limit);
    } catch (e) {
        console.log('[search] Iconify also failed:', e.message);
    }
    return { icons: [], total: 0, source: '' };
}

/* ---- Seedream image generation proxy ---- */

function fetchJsonPost(urlStr, body, headers, timeoutMs) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const postData = JSON.stringify(body);
        const opts = {
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname + u.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                ...headers
            }
        };
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch (e) { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        if (timeoutMs > 0) req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
        req.write(postData);
        req.end();
    });
}

/* ---- Seed 2.0 Vision Analysis ---- */

async function callSeed2Vision(imageBase64, userText, apiKey, seed2Model) {
    const userContent = [];

    // Add the analysis prompt + user auxiliary text
    let textPrompt = SEED2_ANALYSIS_PROMPT;
    if (userText && userText.trim()) {
        textPrompt = `用户的辅助描述文字：${userText.trim()}\n\n${textPrompt}`;
    }
    userContent.push({ type: 'text', text: textPrompt });

    // Add the image
    if (imageBase64) {
        userContent.push({
            type: 'image_url',
            image_url: { url: imageBase64 }
        });
    }

    const chatBody = {
        model: seed2Model,
        messages: [
            { role: 'user', content: userContent }
        ],
        thinking: {
            type: 'disabled'
        }
    };

    const result = await fetchJsonPost(
        'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        chatBody,
        { 'Authorization': 'Bearer ' + apiKey },
        30000
    );

    return result;
}

/* ---- Seedream image generation (step 2) ---- */

async function callSeedream(prompt, apiKey) {
    const model = 'doubao-seedream-4-5-251128';
    const mergedPrompt = `${prompt}\n${IMAGE_EXTRA_PROMPT}`.trim();

    const seedreamBody = {
        model,
        prompt: mergedPrompt,
        size: '2048x2048',
        response_format: 'b64_json',
        watermark: false
    };

    const result = await fetchJsonPost(
        'https://ark.cn-beijing.volces.com/api/v3/images/generations',
        seedreamBody,
        { 'Authorization': 'Bearer ' + apiKey },
        60000
    );

    return result;
}

/* ---- Combined generate handler (2-step) ---- */

async function handleGenerateImage(request, response) {
    // Read request body
    let bodyStr = '';
    for await (const chunk of request) { bodyStr += chunk; }

    let parsed;
    try {
        parsed = JSON.parse(bodyStr);
    } catch (e) {
        sendJson(response, 400, { message: 'Invalid JSON body' });
        return;
    }

    const { image, prompt, apiKey, seed2Model } = parsed;
    if (!apiKey) {
        sendJson(response, 400, { message: 'Missing apiKey' });
        return;
    }
    if (!seed2Model) {
        sendJson(response, 400, { message: 'Missing seed2Model (Seed 2.0 模型端点 ID)' });
        return;
    }

    const sessionId = Date.now() + '-' + Math.random().toString(16).slice(2, 8);
    const userText = (prompt || '').slice(0, 600);

    // Log: start
    addDebugLog({
        sessionId,
        step: 'start',
        status: 'info',
        message: '开始生成流程',
        userText,
        seed2Model,
        hasImage: !!image,
        imagePreview: image ? image.slice(0, 80) + '...' : null
    });

    // ---- Step 1: Seed 2.0 Vision Analysis ----
    let analysisText = '';
    try {
        addDebugLog({
            sessionId,
            step: 'seed2_request',
            status: 'pending',
            message: '正在调用 Seed 2.0 分析画布图片…',
            seed2Model
        });

        const seed2Result = await callSeed2Vision(image, userText, apiKey, seed2Model);

        if (seed2Result.status >= 200 && seed2Result.status < 300
            && seed2Result.body && seed2Result.body.choices && seed2Result.body.choices.length > 0) {
            analysisText = seed2Result.body.choices[0].message.content || '';
            addDebugLog({
                sessionId,
                step: 'seed2_response',
                status: 'success',
                message: 'Seed 2.0 分析完成',
                analysisText,
                rawResponse: seed2Result.body
            });
        } else {
            const errMsg = (seed2Result.body && seed2Result.body.error && seed2Result.body.error.message)
                || (seed2Result.body && seed2Result.body.message)
                || 'Seed 2.0 API error (HTTP ' + seed2Result.status + ')';
            addDebugLog({
                sessionId,
                step: 'seed2_response',
                status: 'error',
                message: errMsg,
                rawResponse: seed2Result.body
            });
            sendJson(response, 502, { message: 'Seed 2.0 分析失败: ' + errMsg, sessionId });
            return;
        }
    } catch (err) {
        addDebugLog({
            sessionId,
            step: 'seed2_response',
            status: 'error',
            message: 'Seed 2.0 请求异常: ' + err.message
        });
        sendJson(response, 502, { message: 'Seed 2.0 请求失败: ' + err.message, sessionId });
        return;
    }

    if (!analysisText.trim()) {
        addDebugLog({
            sessionId,
            step: 'seed2_response',
            status: 'error',
            message: 'Seed 2.0 返回空文本'
        });
        sendJson(response, 502, { message: 'Seed 2.0 返回了空的分析结果', sessionId });
        return;
    }

    // ---- Step 2: Seedream Image Generation ----
    try {
        addDebugLog({
            sessionId,
            step: 'seedream_request',
            status: 'pending',
            message: '正在调用 Seedream 生成图片…',
            prompt: analysisText
        });

        const seedreamResult = await callSeedream(analysisText, apiKey);

        if (seedreamResult.status >= 200 && seedreamResult.status < 300
            && seedreamResult.body && seedreamResult.body.data) {
            const firstImage = seedreamResult.body.data[0] || {};
            addDebugLog({
                sessionId,
                step: 'seedream_response',
                status: 'success',
                message: 'Seedream 图片生成完成',
                hasImage: !!(firstImage.b64_json || firstImage.url)
            });
            sendJson(response, 200, {
                b64_json: firstImage.b64_json || null,
                url: firstImage.url || null,
                analysisText,
                sessionId
            });
        } else {
            const errMsg = (seedreamResult.body && seedreamResult.body.error && seedreamResult.body.error.message)
                || (seedreamResult.body && seedreamResult.body.message)
                || 'Seedream API error (HTTP ' + seedreamResult.status + ')';
            addDebugLog({
                sessionId,
                step: 'seedream_response',
                status: 'error',
                message: errMsg,
                rawResponse: seedreamResult.body
            });
            sendJson(response, 502, { message: 'Seedream 生成失败: ' + errMsg, analysisText, sessionId });
        }
    } catch (err) {
        addDebugLog({
            sessionId,
            step: 'seedream_response',
            status: 'error',
            message: 'Seedream 请求异常: ' + err.message
        });
        sendJson(response, 502, { message: 'Seedream 请求失败: ' + err.message, analysisText, sessionId });
    }
}

/* ---- Modify image handler (from modify.html) ---- */

/* Pick the best Seedream size string based on aspect ratio */
function pickSeedreamSize(w, h) {
    const ratio = w / h;
    // Seedream supported sizes: WIDTHxHEIGHT format
    const sizes = [
        { name: '1024x1024', r: 1 },
        { name: '1280x960', r: 4 / 3 },
        { name: '960x1280', r: 3 / 4 },
        { name: '1920x1080', r: 16 / 9 },
        { name: '1080x1920', r: 9 / 16 },
        { name: '1440x960', r: 3 / 2 },
        { name: '960x1440', r: 2 / 3 },
    ];
    let best = sizes[0];
    let bestDiff = Math.abs(Math.log(ratio) - Math.log(best.r));
    for (const s of sizes) {
        const diff = Math.abs(Math.log(ratio) - Math.log(s.r));
        if (diff < bestDiff) {
            bestDiff = diff;
            best = s;
        }
    }
    return best.name;
}

const MODIFY_SYSTEM_PROMPT = '请按照画面上的内容和文本对图片做出修改。';

async function handleModifyImage(request, response) {
    let bodyStr = '';
    for await (const chunk of request) { bodyStr += chunk; }

    let parsed;
    try {
        parsed = JSON.parse(bodyStr);
    } catch (e) {
        sendJson(response, 400, { message: 'Invalid JSON body' });
        return;
    }

    const { image, prompt, apiKey, width, height } = parsed;
    if (!apiKey) { sendJson(response, 400, { message: 'Missing apiKey' }); return; }

    const sessionId = Date.now() + '-' + Math.random().toString(16).slice(2, 8);
    const userText = (prompt || '').slice(0, 600);

    addDebugLog({
        sessionId, step: 'modify_start', status: 'info',
        message: '开始修改流程（直接 Seedream）',
        userText, hasImage: !!image, width, height
    });

    // Build prompt: system instruction + user text
    const mergedPrompt = `${MODIFY_SYSTEM_PROMPT}\n${userText || ''}\n${IMAGE_EXTRA_PROMPT}`.trim();

    // Use same size as first-step generation (2048x2048, 1:1)
    const model = 'doubao-seedream-4-5-251128';
    const seedreamBody = {
        model,
        prompt: mergedPrompt,
        size: '2048x2048',
        response_format: 'b64_json',
        watermark: false
    };

    // Attach the edited image as reference
    if (image && typeof image === 'string' && image.startsWith('data:')) {
        const base64Data = image.split(',')[1] || '';
        if (base64Data) {
            seedreamBody.image = 'data:image/png;base64,' + base64Data;
        }
    }

    try {
        addDebugLog({ sessionId, step: 'modify_seedream_request', status: 'pending', message: '正在调用 Seedream 生成修改后的图片…', prompt: mergedPrompt, size: '2k' });

        const seedreamResult = await fetchJsonPost(
            'https://ark.cn-beijing.volces.com/api/v3/images/generations',
            seedreamBody,
            { 'Authorization': 'Bearer ' + apiKey },
            60000
        );

        if (seedreamResult.status >= 200 && seedreamResult.status < 300 && seedreamResult.body && seedreamResult.body.data) {
            const firstImage = seedreamResult.body.data[0] || {};
            addDebugLog({ sessionId, step: 'modify_seedream_response', status: 'success', message: '修改后图片生成完成' });
            sendJson(response, 200, { b64_json: firstImage.b64_json || null, url: firstImage.url || null, sessionId });
        } else {
            const errMsg = (seedreamResult.body && seedreamResult.body.error && seedreamResult.body.error.message) || 'Seedream error';
            addDebugLog({ sessionId, step: 'modify_seedream_response', status: 'error', message: errMsg, rawResponse: seedreamResult.body });
            sendJson(response, 502, { message: 'Seedream 生成失败: ' + errMsg, sessionId });
        }
    } catch (err) {
        addDebugLog({ sessionId, step: 'modify_seedream_response', status: 'error', message: err.message });
        sendJson(response, 502, { message: 'Seedream 请求失败: ' + err.message, sessionId });
    }
}

/* ---- Static file serving ---- */

async function serveFile(response, absolutePath) {
    try {
        const stats = await fs.stat(absolutePath);
        const filePath = stats.isDirectory() ? path.join(absolutePath, 'index.html') : absolutePath;
        const extension = path.extname(filePath).toLowerCase();
        const content = await fs.readFile(filePath);
        response.writeHead(200, {
            'Content-Type': mimeTypes[extension] || 'application/octet-stream',
            'Cache-Control': /^\.(png|jpe?g|gif|webp|svg)$/.test(extension) ? 'public, max-age=3600' : 'no-cache'
        });
        response.end(content);
    } catch (error) {
        if (error.code === 'ENOENT') { sendText(response, 404, 'Not Found'); return; }
        sendText(response, 500, 'Internal Server Error');
    }
}

/* ---- HTTP server ---- */

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    // Handle POST for image generation
    if (request.method === 'POST' && requestUrl.pathname === '/api/generate-image') {
        await handleGenerateImage(request, response);
        return;
    }

    // Handle POST for image modification (from modify.html)
    if (request.method === 'POST' && requestUrl.pathname === '/api/modify-image') {
        await handleModifyImage(request, response);
        return;
    }

    if (request.method !== 'GET') {
        sendText(response, 405, 'Method Not Allowed');
        return;
    }

    // Debug logs API
    if (requestUrl.pathname === '/api/debug-logs') {
        sendJson(response, 200, { logs: debugLogs });
        return;
    }

    // Clear debug logs
    if (requestUrl.pathname === '/api/debug-logs/clear') {
        debugLogs.length = 0;
        sendJson(response, 200, { message: 'Logs cleared' });
        return;
    }

    if (requestUrl.pathname === '/api/search') {
        const query = requestUrl.searchParams.get('q') || '';
        const limit = requestUrl.searchParams.get('limit') || '50';
        if (!query.trim()) {
            sendJson(response, 400, { message: 'Missing query parameter "q".' });
            return;
        }
        try {
            const result = await searchIcons(query.trim(), limit);
            sendJson(response, 200, result);
        } catch (error) {
            sendJson(response, 502, { message: 'Icon search failed.' });
        }
        return;
    }

    const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    const publicPath = resolveSafePath(publicDir, pathname.slice(1));
    if (!publicPath) { sendText(response, 400, 'Bad Request'); return; }
    await serveFile(response, publicPath);
});

server.listen(port, () => {
    console.log(`Icon canvas is running at http://localhost:${port}`);
});