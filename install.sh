#!/bin/bash
# zcode-theme 一键安装:编译补丁助手 App + 注册 launchd 看守 + 立即打一次补丁
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$DIR/ZCodePatcher.app"
PLIST_DST="$HOME/Library/LaunchAgents/local.zcode-typo-patch.plist"

[ -d /Applications/ZCode.app ] || { echo "ERROR: /Applications/ZCode.app 不存在"; exit 1; }
command -v node >/dev/null || { echo "ERROR: 找不到 node(请先安装 Node.js)"; exit 1; }
command -v npm  >/dev/null || { echo "ERROR: 找不到 npm";  exit 1; }
NODE_BIN="$(command -v node)"

echo "==> 安装依赖 (@electron/asar)"
(cd "$DIR" && npm install --omit=dev --no-fund --no-audit)

echo "==> 编译 ZCodePatcher.app (node: $NODE_BIN)"
mkdir -p "$APP_DIR/Contents/MacOS"
cp "$DIR/launcher/Info.plist" "$APP_DIR/Contents/Info.plist"
cc -Os -DNODE_PATH="\"$NODE_BIN\"" -DPATCH_SCRIPT="\"$DIR/patch.mjs\"" \
   "$DIR/launcher/zcode-patcher.c" -o "$APP_DIR/Contents/MacOS/zcode-patcher"
codesign --force --sign - "$APP_DIR" >/dev/null 2>&1 || true

echo "==> 注册 launchd 看守任务"
sed "s|__PATCH_DIR__|$DIR|g" "$DIR/launchd/local.zcode-typo-patch.plist" > "$PLIST_DST"
launchctl bootout "gui/$(id -u)/local.zcode-typo-patch" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"

echo "==> 立即执行一次补丁"
/usr/bin/open -g -W "$APP_DIR" || true

echo
echo "完成。日志: $DIR/patch.log"
echo "首次运行若弹出授权框请允许;补丁在 ZCode 下次重启后生效(Cmd+Q 重开)。"
echo "卸载: launchctl bootout gui/$(id -u)/local.zcode-typo-patch && rm \"$PLIST_DST\" && node $DIR/patch.mjs --restore"
