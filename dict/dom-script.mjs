// Devin 中文注入器 —— 浏览器侧脚本生成器（从 injector.mjs 抽出，便于 Node 侧真实执行测试）
// buildScript(dict) 返回的字符串通过 CDP Runtime.evaluate 在目标页面内执行。
export function buildScript(dict) {
  return `
(function(){
  window.__DEVIN_ZH_DICT__ = ${JSON.stringify(dict)};
  window.__DEVIN_ZH_DICT_VER__ = ${Object.keys(dict).length};
  window.__DEVIN_ZH_COUNT__ = window.__DEVIN_ZH_COUNT__ || 0;
  var RULES = [
    [/^(\\d+) MCP servers?$/, '$1 个 MCP 服务器'],
    [/^(\\d+)mo$/, '$1 个月前'],
    [/^(\\d+)y$/, '$1 年前'],
    [/^(\\d+)d$/, '$1 天前'],
    [/^(\\d+)h$/, '$1 小时前'],
    [/^(\\d+)m$/, '$1 分钟前'],
    [/^(\\d+)\\s*mo\\s+ago$/, '$1 个月前'],
    [/^(\\d+)\\s*y\\s+ago$/, '$1 年前'],
    [/^(\\d+)\\s*w\\s+ago$/, '$1 周前'],
    [/^(\\d+)\\s*d\\s+ago$/, '$1 天前'],
    [/^(\\d+)\\s*h\\s+ago$/, '$1 小时前'],
    [/^(\\d+)\\s*m\\s+ago$/, '$1 分钟前'],
    [/^(\\d+) sessions?$/, '$1 个会话'],
    [/^(\\d+) files?$/, '$1 个文件'],
    [/^(\\d+) changes?$/, '$1 处变更'],
    [/^(\\d+) repositories?$/, '$1 个仓库'],
    [/^Promo until (.+)$/, '促销至 $1'],
    [/^Promo pricing is active until (.+)$/, '促销价格有效期至 $1'],
    [/^Free · (.+) context$/, '免费 · $1 上下文'],
    [/^(\\d+) of (\\d+)$/, '$1 / $2'],
    [/^([^,]+), Daily: (\\d+)% quota used · Weekly: (\\d+)% quota used$/, '$1，每日：已用 $2% 配额 · 每周：已用 $3% 配额']
  ];
  var SKIP = /^(SCRIPT|STYLE|CODE|PRE|TEXTAREA|INPUT|KBD|SAMP|NOSCRIPT|CANVAS|SVG|IFRAME|SELECT|OPTION)$/;
  var ATTRS = ['title', 'aria-label', 'placeholder', 'data-tooltip-content'];
  function convert(t) {
    var dict = window.__DEVIN_ZH_DICT__ || {};
    // 原型链防护：只认自有属性（否则 constructor/__proto__ 等会被命中）
    var hit = Object.prototype.hasOwnProperty.call(dict, t) ? dict[t] : undefined;
    if (hit !== undefined) return hit;
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i][0].test(t)) return t.replace(RULES[i][0], RULES[i][1]);
    }
    return null;
  }
  // 合并上限：相邻文本节点组最多 8 个节点 / 300 字符。
  // 超限直接放弃合并，防止把大段正文拼起来误伤，也避免长链兄弟节点拖慢扫描。
  var MERGE_MAX_NODES = 8, MERGE_MAX_CHARS = 300;
  // 慢路径：React 会把一句话拆成多个相邻文本节点（如 "0" + " MCP server" + "s"），
  // 逐节点匹配永远命不中。这里从失败节点起向前收集紧邻的兄弟文本节点，
  // 原样拼接（保留各节点自身空格）后整体过 convert()。
  // 命中：结果写入组内第一个节点（当前节点必非空，否则走不到这里），其余置 ''；
  // 未命中：一个字符都不动。同组节点共享 parentElement，跳过区检查在调用方已做。
  function mergeMatch(n) {
    var group = [n], len = n.nodeValue.length, s = n.nextSibling;
    while (s && s.nodeType === 3) {
      if (group.length >= MERGE_MAX_NODES || len + s.nodeValue.length > MERGE_MAX_CHARS) return;
      group.push(s);
      len += s.nodeValue.length;
      s = s.nextSibling;
    }
    if (group.length < 2) return;
    var merged = '';
    for (var i = 0; i < group.length; i++) merged += group[i].nodeValue;
    var t = merged.trim();
    if (!t) return;
    var hit = convert(t);
    if (hit === null) return;
    group[0].nodeValue = merged.replace(t, () => hit);
    for (var j = 1; j < group.length; j++) group[j].nodeValue = '';
    window.__DEVIN_ZH_COUNT__++;
  }
  function tr(root) {
    if (!root || !root.nodeType) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      var p = n.parentElement;
      if (!p || SKIP.test(p.tagName) || p.isContentEditable) continue;
      // 跳过"数据区"：会话流 / Markdown 渲染 / 列表行 / 扩展市场 —— 既是远程数据不该翻，
      // 也是 DOM 变更最频繁的区域（流式输出时高频触发扫描会阻塞渲染线程）
      if (p.closest && p.closest('[data-devin-zh-skip], .monaco-editor, .xterm, [data-transcript-row-key], [class*="prose"], [data-streamdown], [data-markdown], .monaco-list-row, .monaco-tl-row, .extensions-viewlet, .extension-editor')) continue;
      var raw = n.nodeValue;
      if (!raw) continue;
      var t = raw.trim();
      if (!t) continue;
      var hit = convert(t);
      if (hit !== null) { n.nodeValue = raw.replace(t, () => hit); window.__DEVIN_ZH_COUNT__++; continue; }
      // 单节点未命中才尝试相邻节点合并（快路径不变，合并是慢路径）
      mergeMatch(n);
    }
  }
  function trAttrs(root) {
    if (!root || !root.querySelectorAll) return;
    var els = root.querySelectorAll('[title],[aria-label],[placeholder],[data-tooltip-content]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      // 与文本节点保持对称：skip zone 内的属性同样不翻
      if (el.closest && el.closest('[data-devin-zh-skip], .monaco-editor, .xterm, [data-transcript-row-key], [class*="prose"], [data-streamdown], [data-markdown], .monaco-list-row, .monaco-tl-row, .extensions-viewlet, .extension-editor')) continue;
      for (var a = 0; a < ATTRS.length; a++) {
        var attr = ATTRS[a];
        var v = el.getAttribute && el.getAttribute(attr);
        if (!v) continue;
        var hit = convert(v);
        if (hit !== null) {
          if (attr === 'placeholder' && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') continue;
          el.setAttribute(attr, hit);
          window.__DEVIN_ZH_COUNT__++;
        }
      }
    }
  }
  window.__devinZhRun = function(){ tr(document.body); trAttrs(document.body); return window.__DEVIN_ZH_COUNT__; };
  // 叠加注入升级点：observer/timer 只注册一次、闭包固定，故单节点处理同样走全局
  // 函数派发 —— 每次注入重写 __devinZhScan，旧 observer/timer 自动改用当次规则
  window.__devinZhScan = function(nd){
    if (!nd) return;
    if (nd.nodeType === 1) {
      if (nd.isConnected) { tr(nd); trAttrs(nd); }
    } else if (nd.nodeType === 3 && nd.parentElement) {
      tr(nd.parentElement);
    }
  };
  window.__devinZhRun();
  // 叠加注入升级：常驻 observer/timer 的闭包无法换芯，以本次 scan 函数对象当版本戳 ——
  // 戳不符（含旧版脚本根本无戳）说明常驻者仍是旧规则，就地重建，净数量仍各为 1。
  // 重建与上面的全量扫描在同一同步任务内，disconnect→observe 之间无 DOM 变更可插入；
  // 已入队节点随 __DEVIN_ZH_QUEUE__ 保留，未派送的变更已被刚跑完的全量扫描覆盖。
  if (window.__DEVIN_ZH_OBS__ && window.__DEVIN_ZH_OBS_STAMP__ !== window.__devinZhScan) {
    try { window.__DEVIN_ZH_OBS__.disconnect(); } catch (e) {}
    window.__DEVIN_ZH_OBS__ = null;
  }
  if (window.__DEVIN_ZH_TIMER__ && window.__DEVIN_ZH_TIMER_STAMP__ !== window.__devinZhScan) {
    clearInterval(window.__DEVIN_ZH_TIMER__);
    window.__DEVIN_ZH_TIMER__ = null;
  }
  if (!window.__DEVIN_ZH_OBS__) {
    // 变更入队 + 250ms 批量处理。分片是**留存式**（splice 走一批、剩余留队列继续跑），
    // 不会像 slice 截断那样丢节点；每批跳掉已卸载的死节点（快速切页后队列里常见）
    var __q = window.__DEVIN_ZH_QUEUE__ = window.__DEVIN_ZH_QUEUE__ || [];
    function __flush() {
      window.__DEVIN_ZH_PENDING__ = null;
      var batch = __q.splice(0, 400);
      for (var k = 0; k < batch.length; k++) window.__devinZhScan(batch[k]);
      if (__q.length) window.__DEVIN_ZH_PENDING__ = setTimeout(__flush, 50);
    }
    window.__DEVIN_ZH_OBS__ = new MutationObserver(function(muts){
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'attributes') { __q.push(m.target); continue; }
        var list = m.addedNodes || [];
        for (var j = 0; j < list.length; j++) __q.push(list[j]);
        if (m.type === 'characterData' && m.target) __q.push(m.target);
      }
      if (window.__DEVIN_ZH_PENDING__) return;
      window.__DEVIN_ZH_PENDING__ = setTimeout(__flush, 250);
    });
    // document-start 时 body 可能还不存在 → 用 documentElement 兜底，避免整脚本抛错
    var __root = document.body || document.documentElement;
    window.__DEVIN_ZH_OBS__.observe(__root, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder', 'data-tooltip-content']
    });
    window.__DEVIN_ZH_OBS_STAMP__ = window.__devinZhScan;
  }
  if (!window.__DEVIN_ZH_TIMER__) {
    window.__DEVIN_ZH_TIMER__ = setInterval(function(){ window.__devinZhRun(); }, 9000);
    window.__DEVIN_ZH_TIMER_STAMP__ = window.__devinZhScan;
  }
  console.log('[devin-zh] active on', location.href.slice(0,50), '| dict=' + Object.keys(window.__DEVIN_ZH_DICT__).length + ' | replaced=' + window.__DEVIN_ZH_COUNT__);
})();
`;
}
