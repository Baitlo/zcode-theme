/* zcode-auto-reconnect: 远程工作区断线自动重连
   原理:ZCode 侧边栏远程项目在断线时会出现
   <button aria-label="重新连接|Reconnect">(代码确认仅此场景渲染),
   重连进行中该按钮被"连接中"spinner 替代,连上后消失。
   本脚本轮询该按钮并模拟点击;按钮消失即重置退避,
   持续失败则指数退避(15s→30s→…→5min 封顶),避免打爆远端。 */
(() => {
  if (window.__zcodeAutoReconnect) return;
  window.__zcodeAutoReconnect = true;
  const LABELS = new Set(['重新连接', 'Reconnect']);
  const BASE_MS = 15000;
  const MAX_MS = 300000;
  let lastClick = 0;
  let interval = BASE_MS;

  function findButton() {
    for (const el of document.querySelectorAll('button[aria-label]')) {
      if (LABELS.has(el.getAttribute('aria-label')) && !el.disabled) return el;
    }
    return null;
  }

  function tick() {
    const btn = findButton();
    const now = Date.now();
    if (!btn) {
      // 已连接(或从未断线):重置退避
      interval = BASE_MS;
      lastClick = 0;
      return;
    }
    if (now - lastClick < interval) return;
    lastClick = now;
    interval = Math.min(interval * 2, MAX_MS);
    try {
      btn.click();
      console.log('[zcode-auto-reconnect] reconnect clicked, next interval', interval);
    } catch (e) {
      console.warn('[zcode-auto-reconnect] click failed', e);
    }
  }

  setInterval(tick, 3000);
})();
