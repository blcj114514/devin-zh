// test-hot-inject.mjs —— 验证「叠加注入」时 observer/timer 自动升级到新脚本的规则
// 场景：同一 window 先注入 v1（打标记的旧 RULES）再注入 v2（正常 RULES），
// 断言 v2 注入后：旧 observer/timer 被就地重建（disconnect/clearInterval，净数量仍各 1）、
// 新渲染/新变更的节点由 v2 规则处理。另验证第三次同版注入仍净 1（幂等不破）。
// 零依赖：node:vm + 最小 DOM stub（MutationObserver/setTimeout/setInterval 均可捕获）。
// 跑法: node _probe\test-hot-inject.mjs   （全绿时打印 ALL PASS）
import vm from 'node:vm';
import { buildScript } from '../dict/dom-script.mjs';

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + '  actual=' + JSON.stringify(actual)); }
}

// ---------- 最小 DOM stub ----------
function text(v) {
  return { nodeType: 3, nodeValue: v, parentElement: null, nextSibling: null, previousSibling: null };
}
function el(tag, kids) {
  const e = {
    nodeType: 1, tagName: tag, childNodes: kids || [],
    isContentEditable: false, isConnected: true,
    closest() { return null; },
    querySelectorAll() { return []; },
    getAttribute() { return null; }, setAttribute() {},
  };
  const cs = e.childNodes;
  for (let i = 0; i < cs.length; i++) {
    cs[i].parentElement = e;
    cs[i].nextSibling = cs[i + 1] || null;
    cs[i].previousSibling = cs[i - 1] || null;
  }
  return e;
}
function collectText(root, out) {
  if (root.nodeType === 3) { out.push(root); return; }
  for (const c of root.childNodes || []) collectText(c, out);
}
// 可捕获的 world：observer 实例 / interval 回调 / timeout 队列全部留存，由测试手动触发
function makeWorld() {
  const captured = { obs: [], timerCbs: [], clearedTimers: [], timeouts: [] };
  const body = el('BODY', []);
  const document = {
    body, documentElement: body,
    createTreeWalker(root) {
      const nodes = []; collectText(root, nodes); let i = 0;
      return { nextNode() { return i < nodes.length ? nodes[i++] : null; } };
    },
    querySelectorAll() { return []; },
  };
  const window = {};
  const sandbox = {
    window, document,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      constructor(cb) { this.cb = cb; this.disconnected = false; captured.obs.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    setInterval(cb) { captured.timerCbs.push(cb); return captured.timerCbs.length; },
    clearInterval(id) { captured.clearedTimers.push(id); },
    setTimeout(cb) { captured.timeouts.push(cb); return captured.timeouts.length; },
    console: { log() {} },
    location: { href: 'http://test.local/' },
  };
  vm.createContext(sandbox);
  return { window, sandbox, captured, body };
}
function drainTimeouts(captured) {
  while (captured.timeouts.length) captured.timeouts.shift()();
}
const activeObs = (captured) => captured.obs.filter(o => !o.disconnected);
const fireObs = (captured, muts) => captured.obs[captured.obs.length - 1].cb(muts);
const fireTimer = (captured) => captured.timerCbs[captured.timerCbs.length - 1]();

// ---------- 构造 v1 / v2 两个版本的注入脚本 ----------
// v1：把分钟译文打上 V1 标记（模拟"旧 RULES"）；v2：原始脚本 + 一条新词库
const dict1 = { 'Hello v1': '你好V1' };
const dict2 = { 'Hello v1': '你好V1', 'Fresh Term': '新术语' };
const v1src = buildScript(dict1).split("'$1 分钟前'").join("'$1 V1分钟前'");
const v2src = buildScript(dict2);
check('v1 脚本已打标记（RULES 可区分）', v1src.includes('V1分钟前'), v1src.includes('V1分钟前'));

const { window, sandbox, captured, body } = makeWorld();

// ---------- ① 首次注入 v1（冷启动语义：全量扫描 + 注册 observer/timer 各一次） ----------
body.childNodes.push(el('DIV', [text('10m ago')]));           // 注入时已存在 → 初始全量扫描命中 v1
body.childNodes.push(el('DIV', [text('Fresh Term')]));        // v1 词库/规则不认 → 保持英文
vm.runInContext(v1src, sandbox);
const v1Run = window.__devinZhRun, v1Scan = window.__devinZhScan;
check('① v1 注入即全量扫描（v1 规则生效）', body.childNodes[0].childNodes[0].nodeValue === '10 V1分钟前', body.childNodes[0].childNodes[0].nodeValue);
check('① v1 不认识的词保持英文', body.childNodes[1].childNodes[0].nodeValue === 'Fresh Term', body.childNodes[1].childNodes[0].nodeValue);
check('① observer 注册恰好 1 次', captured.obs.length === 1, captured.obs.length);
check('① interval 注册恰好 1 次', captured.timerCbs.length === 1, captured.timerCbs.length);
check('① observer/timer 已打版本戳', window.__DEVIN_ZH_OBS_STAMP__ === v1Scan && window.__DEVIN_ZH_TIMER_STAMP__ === v1Scan,
  [window.__DEVIN_ZH_OBS_STAMP__ === v1Scan, window.__DEVIN_ZH_TIMER_STAMP__ === v1Scan]);

// v1 期间新渲染一个节点 → observer 入队 → flush → v1 规则处理
const d1 = el('DIV', [text('5m ago')]);
body.childNodes.push(d1);
fireObs(captured, [{ type: 'childList', addedNodes: [d1] }]);
drainTimeouts(captured);
check('① v1 期间变更走 v1 规则', d1.childNodes[0].nodeValue === '5 V1分钟前', d1.childNodes[0].nodeValue);

// ---------- ② 叠加注入 v2（不 reload）：戳不符 → 旧 observer/timer 就地重建 ----------
const obsBefore = window.__DEVIN_ZH_OBS__, timerBefore = window.__DEVIN_ZH_TIMER__;
vm.runInContext(v2src, sandbox);
check('② 旧 observer 已 disconnect', captured.obs[0].disconnected === true, captured.obs[0].disconnected);
check('② observer 就地重建（活动数仍净 1）', captured.obs.length === 2 && activeObs(captured).length === 1 && window.__DEVIN_ZH_OBS__ !== obsBefore,
  [captured.obs.length, activeObs(captured).length]);
check('② 旧 timer 已 clearInterval 并重建', captured.clearedTimers.includes(timerBefore) && captured.timerCbs.length === 2,
  [captured.clearedTimers, captured.timerCbs.length]);
check('② 全局 run/scan 已重写为新闭包', window.__devinZhRun !== v1Run && window.__devinZhScan !== v1Scan,
  [window.__devinZhRun === v1Run, window.__devinZhScan === v1Scan]);
check('② 词库已升级为 v2', window.__DEVIN_ZH_DICT__['Fresh Term'] === '新术语', window.__DEVIN_ZH_DICT__['Fresh Term']);
check('② v2 注入即全量扫描（存量英文收敛）', body.childNodes[1].childNodes[0].nodeValue === '新术语', body.childNodes[1].childNodes[0].nodeValue);

// ---------- ③ 核心断言：v2 注入后新渲染节点由 v2（新）规则处理 ----------
const d2 = el('DIV', [text('8m ago')]);
body.childNodes.push(d2);
fireObs(captured, [{ type: 'childList', addedNodes: [d2] }]);   // 当前活动 observer 的回调
drainTimeouts(captured);
check('③ observer 派发 v2 规则（新渲染→中文）', d2.childNodes[0].nodeValue === '8 分钟前', d2.childNodes[0].nodeValue);
check('③ 输出不含 v1 标记', d2.childNodes[0].nodeValue !== '8 V1分钟前', d2.childNodes[0].nodeValue);

// characterData 路径：文本节点目标 → tr(parentElement)，同样走 v2
const d3 = el('DIV', [text('7m ago')]);
body.childNodes.push(d3);
fireObs(captured, [{ type: 'characterData', target: d3.childNodes[0] }]);
drainTimeouts(captured);
check('③ characterData 变更也走 v2 规则', d3.childNodes[0].nodeValue === '7 分钟前', d3.childNodes[0].nodeValue);

// 9s 兜底 timer：当前活动回调，同样应派发 v2 全量扫描
const d4 = el('DIV', [text('3m ago'), text('Fresh Term')]);
body.childNodes.push(d4);
fireTimer(captured);
check('③ timer 兜底派发 v2 规则（时间）', d4.childNodes[0].nodeValue === '3 分钟前', d4.childNodes[0].nodeValue);
check('③ timer 兜底派发 v2 词库（词条）', d4.childNodes[1].nodeValue === '新术语', d4.childNodes[1].nodeValue);

// ---------- ④ 队列保护：null/死节点不炸，计数器跨注入累计 ----------
fireObs(captured, [{ type: 'childList', addedNodes: [null, { nodeType: 1, isConnected: false }] }]);
drainTimeouts(captured);
check('④ null/死节点静默跳过（无异常）', true);
check('④ 替换计数跨注入持续累计', typeof window.__DEVIN_ZH_COUNT__ === 'number' && window.__DEVIN_ZH_COUNT__ >= 5, window.__DEVIN_ZH_COUNT__);

// ---------- ⑤ 第三次注入（同版 v2）：仍重建但活动数恒 1，不产生重复注册 ----------
vm.runInContext(v2src, sandbox);
check('⑤ 第三次注入后 observer 活动数仍净 1', activeObs(captured).length === 1 && captured.obs.length === 3,
  [captured.obs.length, activeObs(captured).length]);
check('⑤ 第三次注入后 timer 活动数仍净 1', captured.timerCbs.length === 3 && captured.clearedTimers.length === 2,
  [captured.timerCbs.length, captured.clearedTimers.length]);
const d5 = el('DIV', [text('6m ago')]);
body.childNodes.push(d5);
fireObs(captured, [{ type: 'childList', addedNodes: [d5] }]);
drainTimeouts(captured);
check('⑤ 第三次注入后变更仍走 v2 规则', d5.childNodes[0].nodeValue === '6 分钟前', d5.childNodes[0].nodeValue);

console.log('----------------------------------------');
console.log(fail === 0 ? 'ALL PASS (' + pass + ' checks)' : 'FAILED: ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
