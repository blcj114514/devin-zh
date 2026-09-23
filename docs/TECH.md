# 技术细节与维护指南

> 面向想深入理解或接手维护的人。项目概况见 [README](../README.md)。

## 一、Devin Desktop 的架构侦察

### 1.1 形态

- 基于 **VS Code 1.126.0** 的定制 fork（Windsurf 血统），`product.json` 显示 `windsurfVersion: 3.10.31`
- 安装目录（示例）：`<安装盘>\Devin\`，`Devin.exe` + `resources\app\`
- 用户数据目录：`~/.devin/`（配置 `argv.json`、扩展 `extensions/`）；Electron userData 在 `%APPDATA%\Devin\`

### 1.2 界面分两层

| 层 | 渲染位置 | 说明 |
|---|---|---|
| VS Code 内核 | `out/vs/workbench/workbench.desktop.main.js` | 菜单、编辑器、设置页等标准 VS Code UI |
| Devin 自研 | ① `out/vs/sessions/sessions.desktop.main.js`（主界面骨架：侧栏、输入区）② `app.devin.ai`（远程 Web UI：自动化/安全/设置/插件市场等页面） | 通过 CDP `Target.getTargets` 可观察到独立的 iframe target |

### 1.3 三个关键发现

**(a) 强制英文的代码逻辑**（`out/main.js`，约 1.77MB 处）

```js
async function lw({userLocale:r, osLocale:n, userDataPath:e, commit:t, nlsMetadataPath:i}) {
  if (it("code/willGenerateNls"), process.env.VSCODE_DEV || r === "pseudo" || r.startsWith("en") || !t || !e)
    return lm(r, n, i);   // fallback 到英文配置
  ...
}
// 以及：
if (process.platform === "win32" || process.platform === "linux") {
  let r = !Vg || Vg === "qps-ploc" ? "en" : Vg;
  ze.commandLine.appendSwitch("lang", r)
}
```

`Vg = zK(JS)`，而 `JS = FK(ri)` 中的 `FK()` 是一份 **argv.json 键白名单**：

```js
let n = ["disable-hardware-acceleration","force-color-profile","disable-lcd-text",
         "proxy-bypass-list","remote-debugging-port"];   // ← locale 不在其中
```

→ 结论：**argv.json 里的 `locale` 会被丢弃；只有命令行 `--locale zh-cn` 有效**。
（`app.commandLine.appendSwitch("remote-debugging-port", ...)` 反而支持，这也是本项目开调试端口的方式之一；本项目选择命令行直接传。）

**(b) 文件完整性校验**

`resources/app/product.json` 的 `checksums` 字段列出 11 个文件的摘要，包括：

```
vs/base/parts/sandbox/electron-browser/preload.js
vs/workbench/workbench.desktop.main.js
vs/workbench/windsurf-chat-client/index.js
vs/workbench/workbench.desktop.main.css
vs/workbench/api/node/extensionHostProcess.js
vs/code/electron-browser/workbench/workbench.html
vs/code/electron-browser/workbench/workbench.js
vs/sessions/sessions.desktop.main.js        ← 曾尝试修改它，实测被检测
vs/sessions/sessions.desktop.main.css
vs/sessions/electron-browser/sessions.html
vs/sessions/electron-browser/sessions.js
```

修改其中任一文件后启动，右下角报「**Devin 安装似乎损坏。请重新安装。**」（界面仍可用，但属于被检测状态）。
→ 结论：放弃"打补丁"方案，改走运行时注入。

**(c) UI 文案的分布**

- 打包内 i18next 资源：`out/vs/sessions/sessions.desktop.main.js` 里 `JSON.parse(\`{...}\`)` 形式，主资源 11222 叶子（224 命名空间）+ review 资源 1110 叶子（40 命名空间），另有日文版同构资源
- 但全文件 `t("...")` 调用仅 **32 次**，`children:"..."` 硬编码却 **495+ 处**
- → 结论：**i18next 资源替换对界面无效，必须做 DOM 替换**

## 二、注入器实现要点

### 2.1 目标发现

```js
const MATCHERS = [
  { name: 'workbench', fn: t => t.type === 'page'    && t.url.includes('workbench') },
  { name: 'devin-web', fn: t => t.type === 'iframe'  && t.url.includes('app.devin.ai') },
  { name: 'webview',   fn: t => t.type === 'iframe'  && t.url.startsWith('vscode-webview://') }
];
```

每 6 秒重新枚举 target：SPA 路由切换会**替换 iframe target**（旧连接失效），靠轮询自动接管新容器；每 20 秒心跳，失败即摘除重连。

### 2.2 单容器内的翻译层

注入的脚本（`buildScript()`）包含：

1. **文本节点替换**——`TreeWalker` 遍历，跳过
   `SCRIPT|STYLE|CODE|PRE|TEXTAREA|INPUT|KBD|SAMP|NOSCRIPT|CANVAS|SVG|IFRAME|SELECT|OPTION`、`.monaco-editor`、`.xterm`、`contenteditable`；
   并按容器排除 `[data-transcript-row-key]`（会话正文）、`[class*="prose"]`（Markdown 正文）、`.monaco-list-row`（语言/扩展/快速选择列表行）
2. **属性替换**——`title` / `aria-label` / `placeholder` / `data-tooltip-content`（`placeholder` 仅限 INPUT/TEXTAREA）
3. **规则引擎**——词库未命中时跑正则表，处理动态文案：
   ```js
   [/^(\d+) MCP servers?$/, '$1 个 MCP 服务器'],
   [/^(\d+)mo$/, '$1 个月前'],
   [/^Promo until (.+)$/, '促销至 $1'],
   ```
4. **MutationObserver**——`childList + subtree + characterData`，补翻 React 后续渲染
5. **兜底重扫**——3.5 秒间隔全量重跑（覆盖 observer 边界情况）
6. **幂等保护**——`window.__DEVIN_ZH_OBS__`（observer）与 `window.__DEVIN_ZH_TIMER__`（兜底定时器）做存在性检查，重复注入时只注册一次；`__DEVIN_ZH_DICT__` 每次注入直接覆盖，以最新快照为准

### 2.3 热更新（不重启）

在 Devin 调试控制台（或再跑一次 CDP evaluate）：

```js
window.__DEVIN_ZH_DICT__ = Object.assign(window.__DEVIN_ZH_DICT__, { "New String": "新译文" });
window.__devinZhRun();
```

> 注意：注入器进程内存里保存的是启动时的词库快照。若要新开的页面也应用新词库，需要重启注入器进程。

## 三、词库是怎么来的

1. **提取**：从 `out/vs/sessions/sessions.desktop.main.js` 等 bundle 中按位置模式抽取 UI 文案
   `children:"..."` / `placeholder:` / `title:` / `aria-label:` / `label:` / `description:` / `tooltip:`
   （去重后 2767 条；其中约一半是图标检索关键词等噪音——保留进词库的此类条目已按中文译出，如 `"bee, fly"` → `"蜜蜂, 苍蝇"`；未收录的噪音不进词库）
2. **翻译**：分批人工/代理翻译，术语表统一（session=会话、automation=自动化、repository=仓库……）
3. **补漏**：用 CDP 巡检已渲染页面，抓"英文且不在词库"的文本与属性 → 翻译后并入
   - 注意：**JSX 裸字符串**（如 `{cond ? "A" : "B"}` 分支）无法用位置模式提取，只能靠 DOM 巡检补
4. **合并**：`en → zh` 扁平字典，转义序列（`\uXXXX`）已解码为真实字符（DOM 里是真实字符）

## 四、扩展词库

词库是纯 JSON 映射，直接编辑即可：

```json
{
  "Some English UI String": "对应的中文",
  "Dynamic {{count}} String": "动态 {{count}} 文案"
}
```

> 当前注入器对含占位符的动态文案走**精确匹配**；含变量的句子建议改用 `injector.mjs` 的 `RULES` 正则表。

## 五、已知技术债

| 问题 | 说明 | 可能的解法 |
|---|---|---|
| 相邻文本节点 | React 会把 `{count} MCP servers` 渲染成 `"0"` / `" MCP server"` / `"s"` 三个文本节点，精确匹配与规则都打不中 | 合并相邻同级文本节点后再匹配（需谨慎，避免破坏 React 渲染） |
| 误翻用户数据 | 已按容器排除会话正文 `[data-transcript-row-key]`、Markdown 正文 `[class*="prose"]`、列表行 `.monaco-list-row`；其余未覆盖容器（如扩展商店详情页）仍可能误翻 | 继续按需补充容器选择器；`title`/`aria-label` 等属性翻译目前无容器限制，可评估同样按容器排除 |
| `__DEVIN_ZH_DICT_VER__` 死写 | `injector.mjs` 只写不读，幂等实际靠 OBS/TIMER 检查 | 删除该字段，或改用它做版本校验 |
| `ws.__client` 死代码 | `makeClient` 中 `ws.__client` 从未赋值，`dead` 标志恒为 false | 删除或接线到 `conns` 清理逻辑 |
| `frameNavigated` 重复注入 | 任意子帧导航都会重放整份注入脚本（内嵌词库） | 按目标帧过滤，或只在主帧导航时重放 |
| 调试端口暴露面 | 9333 被占用时无回退/提示；端口开放期间本机任意进程可连 CDP | 占用检测 + 随机端口；文档注明风险窗口 |
| 语言包版本耦合 | 官方语言包需与 VS Code 内核版本匹配（当前 1.126.0） | Devin 升级后重新取对应版本 vsix |

## 六、排障

- **界面没变中文**：确认是通过 `Devin-ZH.cmd` 启动的（命令行应含 `--locale zh-cn --remote-debugging-port=9333`）
- **只有菜单中文，其余英文**：注入器没连上。检查 `netstat -ano | findstr 9333` 是否有监听；检查注入器窗口是否被关闭
- **提示「Devin 安装似乎损坏」**：说明安装目录文件被改过（不是本项目所为）。用官方安装包修复，或还原被改文件
- **获取 target 列表**：`curl http://127.0.0.1:9333/json/list`
