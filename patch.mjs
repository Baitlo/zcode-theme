#!/usr/bin/env node
/**
 * zcode-codex-typo patcher
 *
 * 给 ZCode 桌面端的模型输出正文注入 Codex 风格排版(见 override.css)。
 * 幂等:已打补丁的 asar 直接跳过;--restore 移除补丁。
 *
 * 用法:
 *   node patch.mjs [--app /Applications/ZCode.app] [--restore] [--force]
 *
 * 依赖:@electron/asar(与本文件同目录 npm install)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

const HERE = path.dirname(new URL(import.meta.url).pathname);
const HOME = os.homedir();
const MARK_BEGIN = '<!-- zcode-codex-typo v1 -->';
const MARK_END = '<!-- /zcode-codex-typo -->';
const FONT_DIR_NAME = 'fonts-codex';
const BACKUP_DIR = path.join(HOME, 'Library', 'Caches', 'zcode-typo-patch');
const LOCK_DIR = path.join(os.tmpdir(), 'zcode-typo-patch.lock');

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(HERE, 'patch.log'), line + '\n');
  } catch {}
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { app: '/Applications/ZCode.app', restore: false, force: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--app') opts.app = args[++i];
    else if (args[i] === '--restore') opts.restore = true;
    else if (args[i] === '--force') opts.force = true;
  }
  return opts;
}

function appVersion(appPath) {
  try {
    return execFileSync('/usr/libexec/PlistBuddy', [
      '-c', 'Print:CFBundleShortVersionString',
      path.join(appPath, 'Contents', 'Info.plist'),
    ]).toString().trim();
  } catch {
    return 'unknown';
  }
}

function acquireLock() {
  try {
    fs.mkdirSync(LOCK_DIR);
    fs.writeFileSync(path.join(LOCK_DIR, 'pid'), String(process.pid));
    return true;
  } catch {
    // 已有实例?检查持锁进程是否还活着;死了(被 kill/崩溃)则抢锁
    try {
      const pid = Number(fs.readFileSync(path.join(LOCK_DIR, 'pid'), 'utf8'));
      if (pid > 0) {
        try {
          process.kill(pid, 0);
          return false; // 活锁,真有人在跑
        } catch (e) {
          if (e.code === 'ESRCH') {
            fs.rmSync(LOCK_DIR, { recursive: true, force: true });
            fs.mkdirSync(LOCK_DIR);
            fs.writeFileSync(path.join(LOCK_DIR, 'pid'), String(process.pid));
            log(`stale lock from dead pid ${pid} reclaimed`);
            return true;
          }
        }
      }
    } catch { /* 读不出 pid 信息,按占用处理 */ }
    return false;
  }
}

function releaseLock() {
  try { fs.rmSync(LOCK_DIR, { recursive: true, force: true }); } catch {}
}

function pruneBackups(keep = 2) {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.asar.orig'))
      .map(f => ({ f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of files.slice(keep)) {
      fs.rmSync(path.join(BACKUP_DIR, old.f), { force: true });
    }
  } catch {}
}

async function runOnce() {
  const opts = parseArgs();
  const asarPath = path.join(opts.app, 'Contents', 'Resources', 'app.asar');
  // 上次失败可能留下半成品,先清掉
  fs.rmSync(asarPath + '.typo-new', { force: true });
  if (!fs.existsSync(asarPath)) {
    log(`ERROR asar not found: ${asarPath}`);
    process.exit(1);
  }

  if (!acquireLock()) {
    log('SKIP another patch run holds the lock');
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-typo-'));
  const workDir = path.join(tmp, 'asar-src');
  // 与目标同目录,保证 rename 同卷原子替换
  const newAsar = asarPath + '.typo-new';

  try {
    // 0. 快速路径:asar 不压缩,标记串在裸二进制里直接可见;
    //    已有标记则跳过一次 300+MB 的全量解包(launchd 监听会被自己的写入再触发一次)
    if (!opts.restore && !opts.force) {
      try {
        execFileSync('/usr/bin/grep', ['-aq', MARK_BEGIN, asarPath]);
        log(`OK already patched (${opts.app} v${appVersion(opts.app)}), skip`);
        return;
      } catch { /* 未打补丁,继续 */ }
    }

    // 1. 解包
    asar.extractAll(asarPath, workDir);

    const indexHtml = path.join(workDir, 'out', 'renderer', 'index.html');
    if (!fs.existsSync(indexHtml)) {
      log(`ERROR renderer index.html missing in ${opts.app}; layout changed?`);
      process.exit(1);
    }
    let html = fs.readFileSync(indexHtml, 'utf8');
    const alreadyPatched = html.includes(MARK_BEGIN);

    if (opts.restore) {
      if (!alreadyPatched) { log('OK not patched, nothing to restore'); return; }
      const re = new RegExp(
        MARK_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' +
        MARK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      html = html.replace(re, '');
      fs.writeFileSync(indexHtml, html);
      fs.rmSync(path.join(workDir, 'out', 'renderer', 'assets', FONT_DIR_NAME),
        { recursive: true, force: true });
      await asar.createPackageWithOptions(workDir, newAsar, {});
      fs.renameSync(newAsar, asarPath);
      log('OK patch removed');
      return;
    }

    if (alreadyPatched && !opts.force) {
      log(`OK already patched (${opts.app} v${appVersion(opts.app)}), skip`);
      return;
    }

    // 2. 备份未打补丁的原版 asar(每个版本只留一份)
    const version = appVersion(opts.app);
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backup = path.join(BACKUP_DIR, `app-${version}.asar.orig`);
    if (!fs.existsSync(backup)) {
      fs.copyFileSync(asarPath, backup);
      pruneBackups(2);
    }

    // 3. 移除旧补丁块(--force 重打时),再注入最新样式
    if (alreadyPatched) {
      const re = new RegExp(
        MARK_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' +
        MARK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      html = html.replace(re, '');
    }
    const css = fs.readFileSync(path.join(HERE, 'override.css'), 'utf8');
    // 自动重连脚本(可选,存在即注入;无 CSP,内联 script 可执行)
    let autoReconnect = '';
    const arPath = path.join(HERE, 'auto-reconnect.js');
    if (fs.existsSync(arPath)) {
      autoReconnect = `\n<script id="zcode-auto-reconnect">\n${fs.readFileSync(arPath, 'utf8')}\n</script>`;
    }
    const block = `${MARK_BEGIN}\n<style id="zcode-codex-typo">\n${css}\n</style>${autoReconnect}\n${MARK_END}\n</head>`;
    if (!html.includes('</head>')) {
      log('ERROR </head> not found in index.html');
      process.exit(1);
    }
    html = html.replace('</head>', block);
    fs.writeFileSync(indexHtml, html);

    // 4. 拷入字体(稳定文件名,独立于源 asar 的 hash 命名);先清空目标目录,
    //    避免旧字体在反复补丁后残留
    const fontDest = path.join(workDir, 'out', 'renderer', 'assets', FONT_DIR_NAME);
    fs.rmSync(fontDest, { recursive: true, force: true });
    fs.mkdirSync(fontDest, { recursive: true });
    for (const f of fs.readdirSync(path.join(HERE, 'fonts'))) {
      if (f.endsWith('.woff2')) {
        fs.copyFileSync(path.join(HERE, 'fonts', f), path.join(fontDest, f));
      }
    }

    // 5. 重打包并原子替换(运行中的进程持有旧 inode,不受影响;重启后生效)
    await asar.createPackageWithOptions(workDir, newAsar, {});
    fs.renameSync(newAsar, asarPath);
    log(`OK patched ${opts.app} v${version}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    releaseLock();
  }
}

// launchd 触发时可能撞上 Squirrel 更新器正在替换 app(读写竞争),
// 失败按递增间隔重试,等更新器写完再补
async function main() {
  const delays = [0, 15000, 45000, 90000, 180000, 300000, 600000];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) {
      log(`retry ${i}/${delays.length - 1} in ${delays[i] / 1000}s (waiting for updater to settle)`);
      await new Promise(r => setTimeout(r, delays[i]));
    }
    try {
      await runOnce();
      return;
    } catch (err) {
      log(`attempt ${i + 1} failed: ${err?.message || err}`);
      if (i === delays.length - 1) throw err;
    }
  }
}

main().catch(err => { log(`FATAL ${err?.stack || err}`); releaseLock(); process.exit(1); });
