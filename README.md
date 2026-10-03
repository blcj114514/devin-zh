# Devin Desktop 简体中文汉化（devin-zh）

给 **Devin Desktop**（Cognition 的 AI 编程助手桌面端，基于 VS Code 1.126 / Windsurf 血统）做界面汉化。
**不修改安装目录下任何文件**，通过「官方语言包 + 运行时注入」两层方案实现，官方升级不受影响。

> 当前状态：词库 **1632 条**（精确匹配）+ **14 条正则规则**（动态文案），覆盖 Devin 主界面、会话页、评审、自动化、安全、云端设置、模型选择器、扩展面板等。

---

## 快速开始

### 环境要求

- Windows 10/11
- **Node.js 22+**（注入器依赖内置 `fetch` / `WebSocket`）— <https://nodejs.org/>
- Devin Desktop 已安装（任意目录，脚本自动探测）

### 首次：安装官方中文语言包

第①层（VS Code 内核界面：菜单栏、设置页等）依赖微软官方语言包 `ms-ceintl.vscode-language-pack-zh-hans`，**Devin 不自带，需手动装一次**：

1. 下载 vsix：Open VSX 上的 [ms-ceintl.vscode-language-pack-zh-hans](https://open-vsx.org/extension/ms-ceintl/vscode-language-pack-zh-hans)，**版本号需与内核 1.126.0 对齐**（页面右侧选对应版本下载）
2. 打开 Devin → 扩展面板（`Ctrl+Shift+X`）→ 右上角 `···` → **Install from VSIX…** → 选中下载的 vsix
3. 装好后**无需**在 Devin 里切换显示语言（`argv.json` 的 `locale` 键会被 Devin 丢弃），语言由启动器的 `--locale zh-cn` 统一控制
4. 验证：通过 `Devin-ZH.cmd` 启动后，菜单栏（File/Edit/… → 文件/编辑/…）变中文即生效；若只有 Devin 自研界面是中文而菜单仍英文，说明语言包没装上

### 使用

1. 双击 **`Devin-ZH.cmd`**
2. 脚本自动：探测 Devin 路径 → 清理旧注入器 → 后台启动注入器 → 以中文模式启动 Devin
3. 界面即显示中文。**那个最小化的注入器窗口不要关**（它负责持续翻译动态内容）

> 若 Devin 已在运行，启动器会提示先关闭——因为调试端口只在全新启动时开放。

### 卸载

- 直接正常启动 Devin 即恢复英文（不经过启动器就没有注入）
- 或删除整个目录

---

## 工作原理

### 为什么不能改文件？

Devin 在 `product.json` 里维护了一份 **11 个文件的完整性校验清单**（`checksums`），包含 `vs/sessions/sessions.desktop.main.js`、`vs/workbench/windsurf-chat-client/index.js` 等核心界面文件。修改其中任何一个，启动后右下角会弹出「**Devin 安装似乎损坏。请重新安装。**」
→ 本项目因此全程**不碰安装文件**，只在运行时注入。

### 两层汉化

| 层 | 方案 | 覆盖 |
|---|---|---|
| ① VS Code 内核 | 官方微软语言包 `ms-ceintl.vscode-language-pack-zh-hans`（1.126.0，与内核版本精确匹配）+ 启动参数 `--locale zh-cn` | 菜单栏、编辑器、命令面板、设置页、扩展面板等 |
| ② Devin 自研界面 | CDP 运行时注入 `dict/injector.mjs` + 词库 `dict/zh-dict.json` | 侧栏导航、会话页、评审页、自动化、安全、云端设置、模型选择器、DeepWiki 等 |

### 两个关键机制（踩坑换来）

1. **Devin 代码级强制英文**：主进程里有一段
   ```js
   if (process.platform === "win32" || process.platform === "linux") {
     let r = (!Vg || Vg === "qps-ploc") ? "en" : Vg;
     app.commandLine.appendSwitch("lang", r)
   }
   ```
   即「没传 `--locale` 就强制 `lang=en`」，且 **`argv.json` 的 `locale` 键会被白名单过滤掉**（只认 `disable-hardware-acceleration` / `remote-debugging-port` 等少数键）。
   → **唯一入口是命令行参数 `--locale zh-cn`**。（本项目启动器据此编写。）

2. **界面文案以硬编码为主**：Devin 虽然打包了 i18next 资源（11222 条），但实际 `t()` 调用仅 32 次，绝大多数文案直接硬编码在 JSX 里 → **资源替换无效，必须做 DOM 替换**。

### 注入器做什么

```
Devin 启动（--remote-debugging-port=9333）
   ↓
injector.mjs 连接 CDP，发现并注入全部渲染容器：
   · workbench 主页面
   · app.devin.ai（远程 Web UI，独立 iframe target）
   · 所有 vscode-webview 面板
   ↓
每个容器内注入翻译层：
   · 文本节点精确匹配词库 → 替换
   · 属性翻译（title / aria-label / placeholder / data-tooltip-content）
   · 正则规则处理动态文案（如 "0 MCP servers" → "0 个 MCP 服务器"）
   · MutationObserver 实时补翻 React 后续渲染
   · 3.5 秒兜底全量重扫 + 20 秒心跳 + 断线自动重连
   ↓
跳过区域：SCRIPT/STYLE/CODE/PRE/TEXTAREA/KBD/SAMP/INPUT/NOSCRIPT/CANVAS/SVG/IFRAME/SELECT/OPTION、
   .monaco-editor、.xterm、contenteditable，
   以及按容器排除的 [data-transcript-row-key]、[class*="prose"]、.monaco-list-row
   （会话正文 / Markdown 正文 / 列表行不翻译）
```

---

## 目录结构

```
devin-zh/
├── Devin-ZH.cmd              # 一键启动器（纯 ASCII，自动探测 Devin/Node）
├── dict/
│   ├── injector.mjs          # CDP 注入器（零依赖，Node 内置 WebSocket）
│   └── zh-dict.json          # 词库：1632 条精确匹配（en → zh）
├── tools/
│   ├── find-devin.ps1        # Devin.exe 多层探测（常见路径→注册表→进程→开始菜单）
│   └── privacy-scan.mjs      # 发布前隐私扫描
├── docs/
│   └── TECH.md               # 技术细节与维护指南
└── LICENSE                   # MIT
```

---

## 已知限制

- **会话内容不翻译**：对话正文由模型生成，属数据而非界面；注入器按容器排除会话正文（`[data-transcript-row-key]`、`[class*="prose"]`）与列表行（`.monaco-list-row`）
- **第三方扩展元数据不翻译**：扩展名、作者描述、发布者名（远程数据）
- **产品/模型名保留英文**：SWE-2、Claude Fable 5.1、Devin Local、Pro、Wiki 等
- ~~被 React 拆分成多个文本节点的动态文案~~ 已支持：注入脚本内置相邻文本节点合并匹配（`mergeMatch`），`{count} MCP servers` 这类拆分文案可正常命中
- 已测试于 Devin Desktop **v3.9.19 / v3.10.48**（Windows，内部 VS Code 基线均为 1.126.0）；其他版本可能需要调整词库或选择器

## 补翻译 / 维护

- **发现漏翻**：把英文原文加进 `dict/zh-dict.json`（格式 `"English": "中文"`），重启注入器即生效
- **词库热更新**（不重启）：在 Devin 的调试控制台执行（**合并式增量**，勿整体替换，否则会丢掉已有条目）
  ```js
  Object.assign(window.__DEVIN_ZH_DICT__, { 'New text': '新文案' });
  window.__devinZhRun();
  ```
- **Devin 升级后**：语言包不受影响；新增文案按上面方式补词库即可

## 与同类项目的差异

社区已有数个 Devin 汉化项目。本项目的差异点：

1. **`--locale` 走命令行参数**（而非 `argv.json`）——后者经实测会被 Devin 的主进程白名单静默丢弃，核心界面不会变中文；
2. **使用微软官方语言包**（21k+ 条目）而非自制 NLS 语言包，内核部分覆盖面更完整；
3. **多容器注入**：显式覆盖 `app.devin.ai` 远程 Web UI 的独立 iframe target（页面级 UI 主要渲染于此）。

## 隐私说明

- 本项目**不修改 Devin 安装目录下任何文件**，不含遥测，不联网上传任何数据
- 注入器仅在本机 `127.0.0.1:<port>` 上连接调试端口（端口只在启动器带参数启动时开放）
- 词库内容全部来自 Devin 界面文案的提取与翻译，不含用户数据

## 许可

MIT License — 见 [LICENSE](LICENSE)
