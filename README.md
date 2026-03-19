# MiracleQuestion · Icon-to-Scene Studio

把“图标拼贴”变成“可编辑的生活场景图”的轻量 AI 创作工具。  
用户可以搜索图标、在画布排版、自动生成高质量图像，并进入二次修改流程。

---

## 项目定位（Portfolio Pitch）

MiracleQuestion 是一个 **交互体验 + AI 工作流设计** 的 Web 项目：

- 前端提供低门槛可视化编排（拖拽、缩放、旋转、图层管理）
- 后端将用户画布转为 AI 可理解输入，串联两阶段推理与生成
- 最终交付“可继续编辑”的图像结果，形成完整闭环

一句话总结：**从符号化素材到语义化场景图的端到端体验原型**。

---

## 在线体验路径（本地）

- 主流程：`/`（图标搜索 → 画布编排 → AI 生成）
- 二次编辑：`/modify.html`（对生成图继续涂抹/局部修改后再生成）
- 调试面板：`/debug.html`（查看全链路日志）

---

## 核心亮点

### 1) 双阶段 AI 流程（可解释）

项目不是直接把一句 prompt 丢给文生图，而是采用两步：

1. **Seed 2.0 Vision 分析**：读取画布截图 + 用户辅助文字，抽取时间/地点/人物/动作/氛围等结构化语义
2. **Seedream 生成**：将分析结果拼接为更具画面感的提示词，再生成最终图像

优势：提示词更稳定、生成目标更清晰、便于调试与复现。

### 2) 图标检索容灾设计

- 主通道：iconfont（支持中文检索）
- 回退通道：Iconify 多镜像

在上游不稳定时仍能给用户可用结果，保证主流程连续性。

### 3) 以交互为中心的画布编辑

- 拖拽放置图标
- 角点缩放、旋转手柄
- 图层上移/下移/置顶/置底
- 键盘快捷操作（如删除、图层移动）

这使项目更像“创作工具”而不是一次性表单。

### 4) 调试可观测性

后端维护最近 50 条内存日志，记录每次生成会话的关键阶段：

- 请求开始
- Seed 2.0 请求/响应
- Seedream 请求/响应
- 错误信息与会话 ID

便于面试展示“如何排查线上问题”。

---

## 技术架构

### Frontend

- 原生 HTML/CSS/JavaScript
- Canvas + DOM 交互混合实现
- 本地状态管理（含 localStorage 存储 API 配置）

### Backend

- Node.js 原生 `http/https` 服务
- 静态资源托管 + API 代理
- 外部服务聚合：iconfont / Iconify / Ark API

### External APIs

- 图标检索：iconfont.cn、Iconify
- 图像理解：Seed 2.0（Ark Chat Completions）
- 图像生成：Seedream（Ark Images）

---

## 快速启动

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

```bash
npm start
```

默认端口：`3838`  
自定义端口：

```bash
PORT=8080 npm start
```

### 3. 打开页面

- `http://localhost:3838/`

---

## API 一览

### `GET /api/search`

参数：

- `q`：关键词（必填）
- `limit`：数量上限（可选）

返回：图标列表、总数、来源。

### `POST /api/generate-image`

入参：

- `image`：画布截图（DataURL）
- `prompt`：辅助描述
- `apiKey`：Ark API Key
- `seed2Model`：Seed 2.0 模型端点/模型名

出参：

- `b64_json` 或 `url`
- `analysisText`
- `sessionId`

### `POST /api/modify-image`

用于二次编辑后的再生成，入参包含图片、修改文本与 API Key。

### `GET /api/debug-logs`

查看调试日志（最近 50 条）。

### `GET /api/debug-logs/clear`

清空调试日志。

---

## 项目结构

```text
MiracleQuestion/
├─ server.js
├─ package.json
├─ README.md
└─ public/
	├─ index.html
	├─ app.js
	├─ style.css
	├─ modify.html
	└─ debug.html
```