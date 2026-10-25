# zcode-theme

ZCode 桌面端（macOS）的排版与体验补丁：把模型输出正文换成 Kimi Code 同款字体与紧凑行距、收紧工具调用流间距、远程工作区断线自动重连，并且在 **ZCode 每次自动更新后自动重打补丁**，不再需要手工维护。

> An unofficial patch for the ZCode desktop app (macOS): Kimi-Code-style typography for model output (Schibsted Grotesk + JetBrains Mono, 14px / line-height 1.5 / 0.01em tracking), tighter spacing between tool-call rows, auto-reconnect for dropped remote (SSH) workspaces, and a launchd watcher that re-applies the patch automatically after every ZCode auto-update.

## 效果对照

| 项 | ZCode 原版 | 补丁后 |
|---|---|---|
| 正文拉丁/数字字体 | 系统默认 | Schibsted Grotesk（Kimi Code 同款） |
| 代码字体 | 系统默认 | JetBrains Mono（Kimi Code 同款） |
| 正文字号 / 行距 / 字距 | 14px / 1.75 / 0.025em | 14px / **1.5** / **0.01em** |
| 段落等块间距 | 16px | 8px（标题 上14/下4，分隔线 12px） |
| 工具调用流行距（思考/终端/正文） | gap 16–20px | gap 8–10px |
| 远程工作区 SSH 断线 | 需手动点"重新连接" | 自动点，指数退避 15s→5min |
| ZCode 自动更新 | 补丁失效 | launchd 检测到 asar 变化，数秒内自动重打 |

只作用于模型输出正文容器（通过 `leading-[1.75] tracking-wide` 这一 arbitrary-value 类名组合锚定，全渲染包中仅此一处），按钮、侧栏、输入框等不受影响。

## 安装

要求：macOS、ZCode 桌面端（装在 `/Applications`）、Node.js + npm、Xcode 命令行工具（`cc`，用于编译 30 行的启动器）。

```bash
git clone https://github.com/Baitlo/zcode-theme.git
cd zcode-theme
./install.sh
```

`install.sh` 会依次做四件事：

1. `npm install`（只需要 `@electron/asar` 一个依赖）；
2. 用 `cc` 编译 `ZCodePatcher.app` 启动器并 ad-hoc 签名——launchd 直接跑 node 没有"App 管理"TCC 权限，写 `/Applications` 会被系统断流，所以需要一个带 bundle 身份的助手 App（首次运行会弹一次授权框，允许后永久生效）；
3. 注册 launchd 任务 `local.zcode-typo-patch`：WatchPaths 监听 `app.asar` 变化 + 登录时检查 + 每 30 分钟兜底自查；
4. 立即执行一次补丁。

补丁对**已运行的 ZCode 进程不可见**（Electron 启动时已把 asar 读入内存），`Cmd+Q` 彻底退出重开后生效。之后每次自动更新，补丁会在几秒内自动重打，但仍需一次重启才能加载——这是 Electron 的机制，无法绕过。

## 手动操作

```bash
node patch.mjs              # 打补丁(幂等,已打过则秒退)
node patch.mjs --force      # 强制重打(改了 override.css 之后用)
node patch.mjs --restore    # 还原(同时也移除注入的自动重连脚本与字体)
node patch.mjs --app /path/to/ZCode.app   # 指定别的安装位置
```

日志在同目录 `patch.log`；未打补丁的原版 asar 备份在 `~/Library/Caches/zcode-typo-patch/`（每版本留一份，最多两份）。

## 卸载

```bash
launchctl bootout gui/$(id -u)/local.zcode-typo-patch
rm ~/Library/LaunchAgents/local.zcode-typo-patch.plist
node patch.mjs --restore    # 把 ZCode 还原成官方原版
```

## 工作原理

- `patch.mjs`：解包 `app.asar` → 在 `out/renderer/index.html` 的 `</head>` 前注入标记块（`<style>` override.css + `<script>` auto-reconnect.js）→ 拷入字体 → 重打包并**同卷原子替换**（运行中的进程持有旧 inode，不受影响）。幂等：asar 未压缩，先 `grep` 标记串，已打补丁直接跳过，launchd 半小时一次的巡检成本约等于零。
- `override.css`：上面"效果对照"表的全部排版改动，选择器只锚定模型输出容器，未来版本类名变化时**静默失效**（不会破坏界面），改下选择器重打即可。
- `auto-reconnect.js`：轮询侧边栏的"重新连接 / Reconnect"按钮并模拟点击，连上即重置退避，持续失败指数退避封顶 5 分钟，不会打爆远端。
- `launcher/` + `launchd/`：解决 launchd → node → 写 /Applications 的 TCC 权限问题（见上）。

## 声明

- 非官方补丁，与 ZCode 厂商无关，使用风险自负。
- 补丁修改了应用包内容，会使 ZCode 自带的代码签名失效（不影响运行；每次自动更新也会还原成官方包再重打）。
- 字体为 SIL OFL 1.1 开源字体，见 [fonts/README.md](fonts/README.md)。
- 本仓库代码采用 [MIT](LICENSE) 许可。
