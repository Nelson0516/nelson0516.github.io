(function () {
  const el = window.App.el;
  const api = window.App.api;
  const drawer = window.App.assetDrawer;

  const FIELDS = [
    { id: 'lookup-barcodes', key: 'bar_code' },
    { id: 'lookup-location', key: 'location' },
    { id: 'lookup-model', key: 'model_no' },
    { id: 'lookup-group', key: 'asset_group' },
    { id: 'lookup-brand', key: 'brand' },
    { id: 'lookup-serial', key: 'serial_no' },
    { id: 'lookup-status', key: 'status' },
  ];

  const form = document.getElementById('lookup-form');
  const body = document.getElementById('lookup-body');
  const msg = document.getElementById('lookup-msg');
  const count = document.getElementById('lookup-count');

  function dash(value) {
    return value === null || value === undefined || value === '' ? '—' : value;
  }

  function badge(label, cls) {
    return el('span', { class: `badge ${cls}`, text: label });
  }

  function statusBadge(status) {
    const info = drawer.STATUS[status] || { label: status || '—', cls: 'badge-mute' };
    return badge(info.label, info.cls);
  }

  /* ---------- 登出 ---------- */

  async function logout(event) {
    event.preventDefault();
    await api('/api/logout', { method: 'POST' });
    location.href = 'login.html';
  }

  document.getElementById('logout-link').addEventListener('click', logout);

  /* ---------- 下拉選單 ---------- */

  function fillSelect(select, rows, placeholder) {
    select.textContent = '';
    select.append(el('option', { value: '', text: placeholder }));
    for (const row of rows) {
      select.append(
        el('option', { value: row.value, text: row.label ?? row.value })
      );
    }
  }

  async function loadOptions() {
    const res = await api('/api/assets/filters');
    if (res.status === 401) {
      location.href = 'login.html';
      return;
    }
    if (!res.ok) return;

    fillSelect(document.getElementById('lookup-group'), res.data.groups, '全部類別');
    fillSelect(document.getElementById('lookup-brand'), res.data.brands, '全部品牌');
    fillSelect(
      document.getElementById('lookup-status'),
      res.data.statuses.map((s) => ({ value: s.value, label: s.label })),
      '全部狀態'
    );
  }

  /* ---------- 查找 ---------- */

  function collect() {
    const params = new URLSearchParams();
    for (const field of FIELDS) {
      const value = document.getElementById(field.id).value.trim();
      if (value) params.set(field.key, value);
    }
    return params;
  }

  function setMsg(text, kind) {
    msg.textContent = text;
    msg.className = kind ? `form-msg form-msg-${kind}` : 'form-msg';
  }

  function showRows(rows, total, truncated) {
    body.textContent = '';

    if (!rows.length) {
      body.append(
        el('tr', {}, [
          el('td', {
            colspan: '9',
            class: 'empty',
            text: '搵唔到相符嘅電腦，試下放寬啲條件。',
          }),
        ])
      );
      return;
    }

    for (const asset of rows) {
      const model = [asset.brand, asset.model_no].filter(Boolean).join(' ') || '—';

      body.append(
        el('tr', {}, [
          el('td', { class: 'cell-code', text: dash(asset.bar_code) }),
          el('td', {}, [
            el('span', { text: dash(asset.building || asset.location) }),
            asset.building && asset.room
              ? el('span', { class: 'cell-sub', text: asset.room })
              : null,
          ]),
          el('td', { text: model }),
          el('td', { class: 'cell-sub-strong', text: dash(asset.asset_group) }),
          el('td', { text: dash(asset.serial_no) }),
          el('td', { class: 'num', text: dash(asset.arr_date) }),
          el('td', {}, [statusBadge(asset.status)]),
          el('td', { text: dash(asset.custodian) }),
          el('td', { class: 'col-narrow' }, [
            el('button', {
              class: 'btn btn-ghost btn-sm',
              text: '詳情',
              onclick: () => drawer.open(asset.id),
            }),
          ]),
        ])
      );
    }
  }

  async function runLookup(event) {
    if (event) event.preventDefault();

    const params = collect();
    if (!params.toString()) {
      setMsg('請最少填一個欄位先搵得到', 'error');
      count.textContent = '填啲資料落去就可以開始查找。';
      showRows([], 0, false);
      return;
    }

    setMsg('');
    body.textContent = '';
    body.append(
      el('tr', {}, [
        el('td', { colspan: '9', class: 'loading', text: '搵緊…' }),
      ])
    );

    const res = await api(`/api/assets/lookup?${params.toString()}`);
    if (res.status === 401) {
      location.href = 'login.html';
      return;
    }
    if (!res.ok) {
      setMsg(res.data.message || '搵唔到資料', 'error');
      body.textContent = '';
      body.append(
        el('tr', {}, [
          el('td', {
            colspan: '9',
            class: 'empty',
            text: res.data.message || '搵唔到資料',
          }),
        ])
      );
      return;
    }

    const { assets, total, truncated } = res.data;
    showRows(assets, total, truncated);

    count.textContent = truncated
      ? `搵到 ${total} 部，先顯示頭 ${assets.length} 部，請加多啲條件收窄範圍。`
      : `搵到 ${total} 部電腦。`;
  }

  form.addEventListener('submit', runLookup);

  document.getElementById('lookup-clear').addEventListener('click', () => {
    form.reset();
    setMsg('');
    count.textContent = '填啲資料落去就可以開始查找。';
    showRows([], 0, false);
  });

  /* ---------- 起手 ---------- */

  (async function start() {
    const me = await api('/api/me');
    if (!me.ok) {
      location.href = 'login.html';
      return;
    }
    drawer.state.isAdmin = me.data.user.role === 'admin';

    await loadOptions();
  })();
})();
