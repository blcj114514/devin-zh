// test-merge.mjs —— 验证 dict/dom-script.mjs 的「相邻文本节点合并匹配」
// 零依赖：node:vm + 最小 DOM stub，真实执行 buildScript(dict) 生成的浏览器侧脚本。
// 跑法: node _probe\test-merge.mjs   （全绿时打印 ALL PASS）
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
function el(tag, kids, opts) {
  const e = {
    nodeType: 1, tagName: tag, childNodes: kids || [],
    isContentEditable: false, isConnected: true,
    _skipZone: !!(opts && opts.skipZone),
    closest(sel) { return this._skipZone ? this : null; },
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
function makeWorld(dict, body) {
  const document = {
    body,
    documentElement: body,
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
    MutationObserver: class { constructor(cb) {} observe() {} },
    setInterval() { return 1; },
    setTimeout() { return 1; },
    console: { log() {} },
    location: { href: 'http://test.local/' },
  };
  vm.createContext(sandbox);
  vm.runInContext(buildScript(dict), sandbox);   // 脚本末尾会自动跑一次 __devinZhRun()
  return window;
}

// 测试词库：真实 zh-dict.json 里只有小写 "Open settings"，此处按任务断言用 "Open Settings"
const dict = { 'Open Settings': '打开设置' };

// ---------- ① 三相邻文本节点 "0" / " MCP server" / "s" 合并命中 ----------
{
  const t1 = text('0'), t2 = text(' MCP server'), t3 = text('s');
  const body = el('BODY', [el('DIV', [t1, t2, t3])]);
  const w = makeWorld(dict, body);
  console.log('① 合并后节点值:', JSON.stringify([t1.nodeValue, t2.nodeValue, t3.nodeValue]));
  check('①a 合并命中→首节点为译文', t1.nodeValue === '0 个 MCP 服务器', t1.nodeValue);
  check('①b 合并命中→其余置空', t2.nodeValue === '' && t3.nodeValue === '', [t2.nodeValue, t3.nodeValue]);

  // ---------- ④ 幂等：连续再跑两次 __devinZhRun()，结果一致 ----------
  const snap1 = [t1.nodeValue, t2.nodeValue, t3.nodeValue];
  w.__devinZhRun();
  const snap2 = [t1.nodeValue, t2.nodeValue, t3.nodeValue];
  w.__devinZhRun();
  const snap3 = [t1.nodeValue, t2.nodeValue, t3.nodeValue];
  console.log('④ 三次快照:', JSON.stringify(snap1), JSON.stringify(snap2), JSON.stringify(snap3));
  check('④ 幂等（第二次与第一次一致）', JSON.stringify(snap2) === JSON.stringify(snap1), snap2);
  check('④ 幂等（第三次与前两次一致）', JSON.stringify(snap3) === JSON.stringify(snap1), snap3);
}

// ---------- ② 单节点词库命中（快路径，行为与改前一致） ----------
{
  const t = text('Open Settings');
  const body = el('BODY', [el('DIV', [t])]);
  makeWorld(dict, body);
  console.log('② 单节点词库命中:', JSON.stringify(t.nodeValue));
  check('② 单节点命中词库', t.nodeValue === '打开设置', t.nodeValue);
}

// ---------- ③ 非命中文本原样保留 ----------
{
  const t = text('Hello world');
  const body = el('BODY', [el('DIV', [t])]);
  makeWorld(dict, body);
  console.log('③ 未命中节点值:', JSON.stringify(t.nodeValue));
  check('③ 未命中→原样保留', t.nodeValue === 'Hello world', t.nodeValue);
}

// ---------- 附加：中间隔元素节点 → 不合并、不误伤 ----------
{
  const t1 = text('0'), mid = el('B', [text('x')]), t2 = text(' MCP server'), t3 = text('s');
  const body = el('BODY', [el('DIV', [t1, mid, t2, t3])]);
  makeWorld(dict, body);
  console.log('附加1 被元素隔断:', JSON.stringify([t1.nodeValue, t2.nodeValue, t3.nodeValue]));
  check('附加1 跨元素不合并（全部原样）',
    t1.nodeValue === '0' && t2.nodeValue === ' MCP server' && t3.nodeValue === 's',
    [t1.nodeValue, t2.nodeValue, t3.nodeValue]);
}

// ---------- 附加：skip zone（父元素命中跳过列表）→ 整组不动 ----------
{
  const t1 = text('0'), t2 = text(' MCP server'), t3 = text('s');
  const body = el('BODY', [el('DIV', [t1, t2, t3], { skipZone: true })]);
  makeWorld(dict, body);
  check('附加2 跳过区内不合并',
    t1.nodeValue === '0' && t2.nodeValue === ' MCP server' && t3.nodeValue === 's',
    [t1.nodeValue, t2.nodeValue, t3.nodeValue]);
}

// ---------- 附加：超长相邻组（>8 节点）→ 放弃合并 ----------
{
  // 9 个相邻文本节点，合并组超 MERGE_MAX_NODES=8 → 整组跳过
  const kids = [];
  for (let i = 0; i < 9; i++) kids.push(text('x' + i + ' '));
  const vals = kids.map(k => k.nodeValue);
  const body = el('BODY', [el('DIV', kids)]);
  makeWorld(dict, body);
  check('附加3 超 8 节点上限→放弃合并',
    kids.every((k, i) => k.nodeValue === vals[i]),
    kids.map(k => k.nodeValue));
}

console.log('----------------------------------------');
console.log(fail === 0 ? 'ALL PASS (' + pass + ' checks)' : 'FAILED: ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
