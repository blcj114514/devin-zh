// Devin 中文注入器 v3 —— 多容器版（workbench + app.devin.ai + webview + 规则引擎 + 节流）
// 覆盖: workbench 主页面 + app.devin.ai 远程 Web UI + vscode-webview 面板
// 用法: node injector.mjs [port]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildScript } from './dom-script.mjs';

const PORT = Number(process.argv[2] || 9333);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DICT_FILE = path.join(__dirname, 'zh-dict.json');   // 同目录定位，无本机硬编码
const LOG = (msg) => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + msg);

let DICT = {};
if (!fs.existsSync(DICT_FILE)) {
  LOG('[FATAL] 词库文件不存在: ' + DICT_FILE);
  LOG('        请确认 dict/zh-dict.json 与 injector.mjs 在同一目录');
  process.exit(2);
}
try {
  const raw = JSON.parse(fs.readFileSync(DICT_FILE, 'utf8'));
  for (const [en, zh] of Object.entries(raw)) if (zh && zh !== en) DICT[en] = zh;
  LOG('词库载入: ' + Object.keys(DICT).length + ' 条（文件内 ' + Object.keys(raw).length + ' 条，恒等条目已跳过）');
} catch (e) {
  LOG('[FATAL] 词库 JSON 解析失败: ' + e.message);
  LOG('        文件可能损坏，请重新获取 zh-dict.json');
  process.exit(3);
}

function makeClient(wsUrl, tag) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const client = {
      tag,
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const myId = ++id;
          // 计时器要随 settle 清掉，否则每个调用驻留一个 15s timer
          const timer = setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); rej(new Error('timeout ' + method)); } }, 15000);
          pending.set(myId, {
            res: v => { clearTimeout(timer); res(v); },
            rej: e => { clearTimeout(timer); rej(e); }
          });
          ws.send(JSON.stringify({ id: myId, method, params }));
        });
      },
      close() { try { ws.close(); } catch {} },
      dead: false
    };
    ws.onopen = () => resolve(client);
    ws.onclose = () => { client.dead = true; };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }  // 畸形帧直接丢，别在事件回调里抛
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
      } else if (m.method === 'Page.loadEventFired' || m.method === 'Page.frameNavigated') {
        // 页面/路由变化后重新应用
        const src = buildScript(DICT);
        ws.send(JSON.stringify({ id: ++id, method: 'Runtime.evaluate', params: { expression: src } }));
      }
    };
    ws.onerror = () => { try { ws.close(); } catch {} reject(new Error('ws error')); };
  });
}

// 需要注入的 target 匹配器
const MATCHERS = [
  { name: 'workbench', fn: t => t.type === 'page' && String(t.url).includes('workbench') },
  { name: 'devin-web', fn: t => t.type === 'iframe' && String(t.url).includes('app.devin.ai') },
  { name: 'webview', fn: t => t.type === 'iframe' && String(t.url).startsWith('vscode-webview://') }
];

const conns = new Map();   // targetId -> client
const inflight = new Set(); // 连接建立中的 targetId：makeClient 有 await，6s 轮询可能在 conns.set 前再次进入 → 双连泄漏

let __failStreak = 0;
async function syncTargets() {
  let list;
  try {
    const resp = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    list = await resp.json();
    if (__failStreak >= 10) LOG('CDP 恢复连接（此前失败 ' + __failStreak + ' 次）');
    __failStreak = 0;
  } catch (e) {
    __failStreak++;
    if (__failStreak === 10 || __failStreak % 100 === 0) {
      LOG('[WARN] 连续 ' + __failStreak + ' 次连不上 CDP（' + PORT + '）：' + e.message);
      LOG('       常见原因：Devin 未以 --remote-debugging-port 启动；端口被占；Devin 未运行');
    }
    return;
  }

  const wanted = [];
  for (const t of list) {
    const m = MATCHERS.find(mm => mm.fn(t));
    if (m) wanted.push({ t, kind: m.name });
  }

  // 新增连接
  for (const { t, kind } of wanted) {
    if (conns.has(t.id) || inflight.has(t.id)) continue;
    inflight.add(t.id);
    try {
      const c = await makeClient(t.webSocketDebuggerUrl, kind);
      await c.send('Runtime.enable');
      try { await c.send('Page.enable'); } catch {}
      const src = buildScript(DICT);
      try { await c.send('Page.addScriptToEvaluateOnNewDocument', { source: src }); } catch {}
      await c.send('Runtime.evaluate', { expression: src });
      conns.set(t.id, c);
      LOG('已注入 [' + kind + '] ' + String(t.url).slice(0, 60));
    } catch (e) {
      LOG('注入失败 [' + kind + '] ' + String(t.url).slice(0, 40) + ' → ' + e.message);
    } finally {
      inflight.delete(t.id);
    }
  }

  // 清理失效
  for (const [id, c] of conns) {
    if (!wanted.find(w => w.t.id === id)) { c.close(); conns.delete(id); LOG('已断开 ' + id.slice(0, 12)); }
  }
}

async function heartbeat() {
  for (const [id, c] of conns) {
    if (c.dead) { LOG('死连接 ' + id.slice(0, 12) + ' → 移除'); conns.delete(id); continue; }
    try {
      await c.send('Runtime.evaluate', { expression: '1+1', returnByValue: true });
    } catch (e) {
      LOG('心跳失败 ' + id.slice(0, 12) + ' → 移除');
      c.close(); conns.delete(id);
    }
  }
}

LOG('注入器 v3 启动 | 端口 ' + PORT + ' | 监控 workbench + app.devin.ai + webview');
await syncTargets();
setInterval(syncTargets, 6000);
setInterval(heartbeat, 20000);
setInterval(() => LOG('存活 | 连接数 ' + conns.size + ' | 词库 ' + Object.keys(DICT).length), 120000);
