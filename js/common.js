// 共用小工具：時間格式、API 請求
(function () {
  const HONG_KONG = 'Asia/Hong_Kong';

  const partsFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: HONG_KONG,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  /** 資料庫存嘅係 UTC 字串，呢度轉成香港時間 */
  function parseUtc(text) {
    if (!text) return null;
    const ms = Date.parse(String(text).replace(' ', 'T') + 'Z');
    return Number.isFinite(ms) ? ms : null;
  }

  function formatTime(text) {
    const ms = parseUtc(text);
    if (ms === null) return '—';
    const parts = partsFmt.formatToParts(new Date(ms));
    const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  }

  /** 簡化嘅 DOM 組建器，順便避免咗用 innerHTML 造成嘅安全問題 */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    const props = attrs || {};
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value);
    }
    for (const child of children || []) {
      if (child) node.append(child);
    }
    return node;
  }

  async function api(path, options) {
    const opts = Object.assign({ credentials: 'same-origin' }, options || {});
    if (opts.body && !opts.headers) {
      opts.headers = { 'Content-Type': 'application/json' };
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok && data.ok !== false, data };
  }

  window.App = { formatTime, parseUtc, api, el };
})();
