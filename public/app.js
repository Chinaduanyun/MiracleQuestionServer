const state = {
    searchKeyword: '',
    canvasItems: [],
    selectedCanvasItemId: null,
    dragSource: null,
    nextZIndex: 1,
    icons: [],
    total: 0,
    loading: false,
    searched: false,
    source: ''
};

const SIZE_MIN = 24;
const SIZE_MAX = 600;

const categoryTitleElement = document.querySelector('#categoryTitle');
const iconCountElement = document.querySelector('#iconCount');
const iconGridElement = document.querySelector('#iconGrid');
const canvasElement = document.querySelector('#canvas');
const canvasHintElement = document.querySelector('#canvasHint');
const searchInputElement = document.querySelector('#searchInput');
const settingsButton = document.querySelector('#settingsButton');
const iconCardTemplate = document.querySelector('#iconCardTemplate');
const toolbarElement = document.querySelector('#canvasToolbar');
const sourceHintElement = document.querySelector('#sourceHint');
const importCanvasButton = document.querySelector('#importCanvasButton');
const exportCanvasButton = document.querySelector('#exportCanvasButton');
const importFileInput = document.querySelector('#importFileInput');
const generateImageButton = document.querySelector('#generateImageButton');
const aiPromptInput = document.querySelector('#aiPromptInput');
const apiKeyModal = document.querySelector('#apiKeyModal');
const apiKeyInput = document.querySelector('#apiKeyInput');
const apiKeyCancelBtn = document.querySelector('#apiKeyCancel');
const apiKeySaveBtn = document.querySelector('#apiKeySave');
const seed2ModelInput = document.querySelector('#seed2ModelInput');
const resultModal = document.querySelector('#resultModal');
const resultContent = document.querySelector('#resultContent');
const resultCloseBtn = document.querySelector('#resultClose');
const resultConfirmBtn = document.querySelector('#resultConfirm');

function createEmptyState(message) {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.textContent = message;
    return el;
}

function renderIconGrid() {
    categoryTitleElement.textContent = '图标搜索';
    iconGridElement.innerHTML = '';

    if (state.loading) {
        iconCountElement.textContent = '搜索中…';
        iconGridElement.appendChild(createEmptyState('正在搜索图标…'));
        return;
    }

    iconCountElement.textContent = state.searched
        ? state.icons.length + ' / ' + state.total + ' 个结果'
        : '输入关键词搜索';

    if (sourceHintElement) {
        if (state.source) {
            sourceHintElement.textContent = '来源: ' + state.source;
            sourceHintElement.classList.remove('is-hidden');
        } else {
            sourceHintElement.classList.add('is-hidden');
        }
    }

    if (!state.searched) {
        iconGridElement.appendChild(createEmptyState('输入关键词搜索图标，支持中文（如"孩子"）和英文（如"star"）'));
        return;
    }

    if (state.icons.length === 0) {
        iconGridElement.appendChild(createEmptyState('没有找到匹配的图标，换个关键词试试？'));
        return;
    }

    state.icons.forEach((icon) => {
        const fragment = iconCardTemplate.content.cloneNode(true);
        const button = fragment.querySelector('.icon-card');
        const image = fragment.querySelector('img');
        const label = fragment.querySelector('.icon-card-label');

        image.src = icon.url;
        image.alt = icon.name;
        label.textContent = icon.name;

        button.addEventListener('dragstart', (event) => {
            state.dragSource = { type: 'catalog', icon };
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData('text/plain', JSON.stringify(icon));
        });

        iconGridElement.appendChild(fragment);
    });
}

let searchTimer = null;

async function performSearch(query) {
    if (!query.trim()) {
        state.icons = [];
        state.total = 0;
        state.searched = false;
        state.loading = false;
        state.source = '';
        renderIconGrid();
        return;
    }

    state.loading = true;
    renderIconGrid();

    try {
        const resp = await fetch('/api/search?q=' + encodeURIComponent(query) + '&limit=50');
        if (!resp.ok) throw new Error('Search failed');
        const data = await resp.json();
        state.icons = data.icons || [];
        state.total = data.total || 0;
        state.source = data.source || '';
        state.searched = true;
    } catch (e) {
        state.icons = [];
        state.total = 0;
        state.source = '';
        state.searched = true;
    }
    state.loading = false;
    renderIconGrid();
}

/* ---- Canvas helpers ---- */

function getSelectedItem() {
    return state.canvasItems.find((i) => i.id === state.selectedCanvasItemId) || null;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function renderToolbar() {
    const item = getSelectedItem();
    toolbarElement.classList.toggle('is-hidden', !item);
    if (!item) return;
    const idx = state.canvasItems.indexOf(item);
    document.querySelector('#tbLayer').textContent = (idx + 1) + ' / ' + state.canvasItems.length;
}

function renderCanvas() {
    canvasElement.innerHTML = '';
    canvasHintElement.classList.toggle('is-hidden', state.canvasItems.length > 0);

    state.canvasItems.forEach((item) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'canvas-item' + (item.id === state.selectedCanvasItemId ? ' is-selected' : '');
        wrapper.style.left = item.x + 'px';
        wrapper.style.top = item.y + 'px';
        wrapper.style.width = item.size + 'px';
        wrapper.style.height = item.size + 'px';
        wrapper.style.zIndex = item.zIndex;
        if (item.rotation !== 0) {
            wrapper.style.transform = 'rotate(' + item.rotation + 'deg)';
        }
        wrapper.dataset.id = item.id;

        const image = document.createElement('img');
        image.src = item.url;
        image.alt = item.name;
        wrapper.appendChild(image);

        // Resize & rotate handles for selected item
        if (item.id === state.selectedCanvasItemId) {
            ['tl', 'tr', 'bl', 'br'].forEach((corner) => {
                const handle = document.createElement('div');
                handle.className = 'resize-handle ' + corner;
                handle.addEventListener('pointerdown', (e) => startResizeDrag(e, item, corner));
                wrapper.appendChild(handle);
            });

            const rotateLine = document.createElement('div');
            rotateLine.className = 'rotate-handle-line';
            wrapper.appendChild(rotateLine);

            const rotateHandle = document.createElement('div');
            rotateHandle.className = 'rotate-handle';
            rotateHandle.addEventListener('pointerdown', (e) => startRotateDrag(e, item));
            wrapper.appendChild(rotateHandle);
        }

        // Drag to move (skip if clicking a handle)
        wrapper.addEventListener('pointerdown', (e) => {
            if (e.target.classList.contains('resize-handle') || e.target.classList.contains('rotate-handle')) return;
            startCanvasItemDrag(e, item);
        });

        // Select on click
        wrapper.addEventListener('click', (e) => {
            if (e.target.classList.contains('resize-handle') || e.target.classList.contains('rotate-handle')) return;
            state.selectedCanvasItemId = item.id;
            renderCanvas();
            renderToolbar();
        });

        canvasElement.appendChild(wrapper);
    });
    renderToolbar();
}

function addCanvasItem(icon, dropX, dropY) {
    const defaultSize = 84;
    const maxX = Math.max(0, canvasElement.clientWidth - defaultSize);
    const maxY = Math.max(0, canvasElement.clientHeight - defaultSize);
    const item = {
        id: Date.now() + '-' + Math.random().toString(16).slice(2),
        name: icon.name,
        url: icon.url,
        x: clamp(dropX - defaultSize / 2, 0, maxX),
        y: clamp(dropY - defaultSize / 2, 0, maxY),
        size: defaultSize,
        rotation: 0,
        zIndex: state.nextZIndex++
    };
    state.canvasItems.push(item);
    state.selectedCanvasItemId = item.id;
    renderCanvas();
}

function startCanvasItemDrag(event, item) {
    event.preventDefault();
    state.selectedCanvasItemId = item.id;
    renderCanvas();

    const canvasRect = canvasElement.getBoundingClientRect();
    const pointerOffsetX = event.clientX - canvasRect.left - item.x;
    const pointerOffsetY = event.clientY - canvasRect.top - item.y;

    const handlePointerMove = (moveEvent) => {
        item.x = moveEvent.clientX - canvasRect.left - pointerOffsetX;
        item.y = moveEvent.clientY - canvasRect.top - pointerOffsetY;
        renderCanvas();
    };

    const handlePointerUp = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
}

/* ---- Resize by corner drag ---- */

function startResizeDrag(event, item, corner) {
    event.preventDefault();
    event.stopPropagation();
    state.selectedCanvasItemId = item.id;

    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = item.size;
    const startItemX = item.x;
    const startItemY = item.y;

    const rad = (item.rotation * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);

    const handleMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const localDx = dx * cosR + dy * sinR;
        const localDy = -dx * sinR + dy * cosR;

        let sizeDelta = 0;
        if (corner === 'br') sizeDelta = Math.max(localDx, localDy);
        else if (corner === 'bl') sizeDelta = Math.max(-localDx, localDy);
        else if (corner === 'tr') sizeDelta = Math.max(localDx, -localDy);
        else if (corner === 'tl') sizeDelta = Math.max(-localDx, -localDy);

        const newSize = clamp(startSize + sizeDelta, SIZE_MIN, SIZE_MAX);
        const actualDelta = newSize - startSize;

        let newX = startItemX;
        let newY = startItemY;
        if (corner === 'tl') { newX = startItemX - actualDelta; newY = startItemY - actualDelta; }
        else if (corner === 'tr') { newY = startItemY - actualDelta; }
        else if (corner === 'bl') { newX = startItemX - actualDelta; }

        item.size = newSize;
        item.x = newX;
        item.y = newY;
        renderCanvas();
    };

    const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
}

/* ---- Rotate by handle drag ---- */

function startRotateDrag(event, item) {
    event.preventDefault();
    event.stopPropagation();
    state.selectedCanvasItemId = item.id;

    const canvasRect = canvasElement.getBoundingClientRect();
    const centerX = canvasRect.left + item.x + item.size / 2;
    const centerY = canvasRect.top + item.y + item.size / 2;

    const handleMove = (e) => {
        const dx = e.clientX - centerX;
        const dy = e.clientY - centerY;
        let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
        if (e.shiftKey) angle = Math.round(angle / 15) * 15;
        item.rotation = ((Math.round(angle) % 360) + 360) % 360;
        renderCanvas();
    };

    const handleUp = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
}

/* ---- Event listeners ---- */

searchInputElement.addEventListener('input', (event) => {
    const value = event.target.value;
    state.searchKeyword = value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => performSearch(value), 500);
});

settingsButton.addEventListener('click', () => {
    apiKeyInput.value = getApiKey();
    seed2ModelInput.value = getSeed2Model();
    apiKeySaveBtn._fromSettings = true;
    showModal(apiKeyModal);
});

canvasElement.addEventListener('dragover', (event) => {
    event.preventDefault();
    canvasElement.classList.add('is-dragover');
});

canvasElement.addEventListener('dragleave', () => {
    canvasElement.classList.remove('is-dragover');
});

canvasElement.addEventListener('drop', (event) => {
    event.preventDefault();
    canvasElement.classList.remove('is-dragover');
    const rawPayload = event.dataTransfer.getData('text/plain');
    if (!rawPayload) return;
    const icon = JSON.parse(rawPayload);
    const canvasRect = canvasElement.getBoundingClientRect();
    addCanvasItem(icon, event.clientX - canvasRect.left, event.clientY - canvasRect.top);
});

// Click canvas background to deselect
canvasElement.addEventListener('click', (event) => {
    if (event.target === canvasElement) {
        state.selectedCanvasItemId = null;
        renderCanvas();
    }
});

/* ---- Toolbar actions ---- */

function moveLayer(direction) {
    const item = getSelectedItem();
    if (!item) return;
    const idx = state.canvasItems.indexOf(item);
    if (direction === 'up' && idx < state.canvasItems.length - 1) {
        [state.canvasItems[idx], state.canvasItems[idx + 1]] = [state.canvasItems[idx + 1], state.canvasItems[idx]];
    } else if (direction === 'down' && idx > 0) {
        [state.canvasItems[idx], state.canvasItems[idx - 1]] = [state.canvasItems[idx - 1], state.canvasItems[idx]];
    } else if (direction === 'top') {
        state.canvasItems.splice(idx, 1);
        state.canvasItems.push(item);
    } else if (direction === 'bottom') {
        state.canvasItems.splice(idx, 1);
        state.canvasItems.unshift(item);
    }
    state.canvasItems.forEach((ci, i) => { ci.zIndex = i + 1; });
    state.nextZIndex = state.canvasItems.length + 1;
    renderCanvas();
}

toolbarElement.querySelector('#tbLayerUp').addEventListener('click', () => moveLayer('up'));
toolbarElement.querySelector('#tbLayerDown').addEventListener('click', () => moveLayer('down'));
toolbarElement.querySelector('#tbLayerTop').addEventListener('click', () => moveLayer('top'));
toolbarElement.querySelector('#tbLayerBottom').addEventListener('click', () => moveLayer('bottom'));

/* ---- Keyboard shortcuts ---- */

window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (!state.selectedCanvasItemId) return;
    switch (event.key) {
        case 'Delete': case 'Backspace':
            state.canvasItems = state.canvasItems.filter((i) => i.id !== state.selectedCanvasItemId);
            state.canvasItems.forEach((ci, i) => { ci.zIndex = i + 1; });
            state.nextZIndex = state.canvasItems.length + 1;
            state.selectedCanvasItemId = null;
            renderCanvas();
            break;
        case 'ArrowUp': if (event.altKey) { event.preventDefault(); moveLayer('up'); } break;
        case 'ArrowDown': if (event.altKey) { event.preventDefault(); moveLayer('down'); } break;
    }
});

/* ---- AI Image Generation ---- */

function getApiKey() {
    return localStorage.getItem('ark_api_key') || '';
}

function setApiKey(key) {
    localStorage.setItem('ark_api_key', key);
}

function getSeed2Model() {
    return localStorage.getItem('seed2_model') || 'doubao-seed-2-0-pro-260215';
}

function setSeed2Model(model) {
    localStorage.setItem('seed2_model', model);
}

function showModal(el) { el.classList.remove('is-hidden'); }
function hideModal(el) { el.classList.add('is-hidden'); }

async function captureCanvasAsDataUrl() {
    const rect = canvasElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const offscreen = document.createElement('canvas');
    offscreen.width = w * 2;
    offscreen.height = h * 2;
    const ctx = offscreen.getContext('2d');
    ctx.scale(2, 2);
    ctx.fillStyle = '#fdf8ed';
    ctx.fillRect(0, 0, w, h);

    const sorted = [...state.canvasItems].sort((a, b) => a.zIndex - b.zIndex);
    for (const item of sorted) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
            img.src = item.url;
        });
        ctx.save();
        ctx.translate(item.x + item.size / 2, item.y + item.size / 2);
        if (item.rotation) ctx.rotate((item.rotation * Math.PI) / 180);
        ctx.drawImage(img, -item.size / 2, -item.size / 2, item.size, item.size);
        ctx.restore();
    }
    return offscreen.toDataURL('image/png');
}

let isGenerating = false;

async function handleGenerateImage() {
    if (isGenerating) return;

    const apiKey = getApiKey();
    const seed2Model = getSeed2Model();
    if (!apiKey || !seed2Model) {
        apiKeyInput.value = apiKey;
        seed2ModelInput.value = seed2Model || 'doubao-seed-2-0-pro-260215';
        apiKeySaveBtn._fromSettings = false;
        showModal(apiKeyModal);
        return;
    }

    if (state.canvasItems.length === 0) {
        alert('画布为空，请先拖入一些图标再生成图像。');
        return;
    }

    isGenerating = true;
    generateImageButton.disabled = true;
    generateImageButton.textContent = '⏳ 生成中…';

    // Show progress in result modal
    resultContent.innerHTML = '<div class="generation-progress">' +
        '<div class="progress-step is-active" id="step1">'
        + '<span class="step-icon">🔍</span>'
        + '<span class="step-label">步骤 1/2：Seed 2.0 正在分析画布内容…</span>'
        + '</div>'
        + '<div class="progress-step" id="step2">'
        + '<span class="step-icon">🎨</span>'
        + '<span class="step-label">步骤 2/2：Seedream 生成图片</span>'
        + '</div>'
        + '</div>';
    showModal(resultModal);

    try {
        const imageDataUrl = await captureCanvasAsDataUrl();
        const prompt = aiPromptInput.value.trim();

        const resp = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: imageDataUrl, prompt, apiKey, seed2Model })
        });
        const data = await resp.json();

        if (!resp.ok) throw new Error(data.message || '生成失败');

        resultContent.innerHTML = '';

        if (data.url) {
            const img = document.createElement('img');
            img.src = data.url;
            img.alt = 'AI 生成的图片';
            resultContent.appendChild(img);
        } else if (data.b64_json) {
            const img = document.createElement('img');
            img.src = 'data:image/png;base64,' + data.b64_json;
            img.alt = 'AI 生成的图片';
            resultContent.appendChild(img);
        } else {
            resultContent.innerHTML += '<p class="loading-text">未能获取到生成的图片</p>';
        }
    } catch (err) {
        alert('图像生成失败：' + err.message);
    } finally {
        isGenerating = false;
        generateImageButton.disabled = false;
        generateImageButton.textContent = '✨ 生成图像';
    }
}

generateImageButton.addEventListener('click', handleGenerateImage);

apiKeyCancelBtn.addEventListener('click', () => hideModal(apiKeyModal));
apiKeySaveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    const model = seed2ModelInput.value.trim();
    if (!key) { alert('请输入 API Key'); return; }
    if (!model) { alert('请输入 Seed 2.0 模型端点 ID'); return; }
    setApiKey(key);
    setSeed2Model(model);
    const fromSettings = apiKeySaveBtn._fromSettings;
    apiKeySaveBtn._fromSettings = false;
    hideModal(apiKeyModal);
    if (!fromSettings) handleGenerateImage();
});

resultCloseBtn.addEventListener('click', () => hideModal(resultModal));

resultConfirmBtn.addEventListener('click', () => {
    const img = resultContent.querySelector('img');
    if (img && img.src) {
        sessionStorage.setItem('modify_image', img.src);
        window.location.href = '/modify.html';
    } else {
        alert('没有可编辑的图片');
    }
});

/* ---- Import / Export Canvas ---- */

exportCanvasButton.addEventListener('click', () => {
    const payload = {
        canvasItems: state.canvasItems,
        nextZIndex: state.nextZIndex
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '画布_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
});

importCanvasButton.addEventListener('click', () => {
    importFileInput.value = '';
    importFileInput.click();
});

importFileInput.addEventListener('change', () => {
    const file = importFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            if (!Array.isArray(data.canvasItems)) throw new Error('invalid');
            state.canvasItems = data.canvasItems;
            state.nextZIndex = data.nextZIndex || state.canvasItems.length + 1;
            state.selectedCanvasItemId = null;
            renderCanvas();
        } catch {
            alert('导入失败：文件格式不正确');
        }
    };
    reader.readAsText(file);
});

/* ---- Initial render ---- */
renderIconGrid();
renderCanvas();