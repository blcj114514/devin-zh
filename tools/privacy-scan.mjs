#!/usr/bin/env node
// 隐私扫描：发布前检查包内是否含本机路径 / 账号 / 凭据 / 私有标识
// 用法: node tools/privacy-scan.mjs [目录，默认包根]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] || path.join(__dirname, '..');
const SELF = path.basename(fileURLToPath(import.meta.url));

const RULES = [
  ['本机盘符路径', /[A-Za-z]:[\\/]{1,2}(Users|ZCcode|coding|Devin)/i],
  ['项目代号', /ZCcode/i],
  ['用户目录名', /[\\/]Users[\\/][A-Za-z0-9_.-]+/],
  ['GitHub 账号名', /blcj114514/i],
  ['邮箱地址', /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/],
  ['API Key 形态', /(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,})/],
  ['机器/设备 ID', /(machineId["'\s:]+[A-Za-z0-9]|cl-[A-Za-z0-9]{12,})/],
  ['会话凭据', /(SESSDATA|bili_jct|Bearer\s+[A-Za-z0-9._-]{20,})/],
  ['主机名形态', /DESKTOP-[A-Z0-9]{7}/],
  ['疑似私有仓库', /(astrbot_plugin|dantide|qingzhou|Cursor_Cloud_Agent)/i]
];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

console.log('扫描目录: ' + ROOT);
let hits = 0, checked = 0;
for (const f of walk(ROOT)) {
  const name = path.basename(f);
  if (name === SELF) { console.log('  (跳过扫描器自身)'); continue; }
  const c = fs.readFileSync(f, 'utf8');
  checked++;
  for (const [label, re] of RULES) {
    const m = c.match(new RegExp(re.source, 'gi'));
    if (m) {
      hits++;
      console.log('  🔴 ' + path.relative(ROOT, f) + '  [' + label + '] ×' + m.length + '  ' +
        JSON.stringify([...new Set(m)].slice(0, 2).map(s => String(s).slice(0, 50))));
    }
  }
}
console.log('\n已检查 ' + checked + ' 个文件');
console.log(hits === 0 ? '✅ 通过：未发现隐私命中' : '⚠️ 共 ' + hits + ' 处命中，请逐条人工确认');
process.exit(hits === 0 ? 0 : 1);
