(function () {
  const el = window.App.el;
  const api = window.App.api;

  // 系統狀態：同 Excel 嘅 NEW／USED 係兩回事，唔好溝埋一齊
  const STATUS = {
    active: { label: '使用中', cls: 'badge-ok' },
    maintenance: { label: '維修中', cls: 'badge-warn' },
    loaned: { label: '借出中', cls: 'badge-info' },
    retired: { label: '已棄置', cls: 'badge-mute' },
    lost: { label: '遺失', cls: 'badge-bad' },
  };

  // Excel 入面嘅原始狀態
  const EQUIPMENT = {
    NEW: { label: '全新', cls: 'badge-info' },
    USED: { label: '用過', cls: 'badge-mute' },
  };

  const state = {
    assets: [],
    total: 0,
    page: 1,
    pages: 1,
    limit: 50,
    q: '',
    building: '',
    brand: '',
    asset_group: '',
    status: '',
    equipment_status: '',
    sort: 'bar_code',
    dir: 'asc',
    isAdmin: false,
    filters: null,
    detail: null,
  };

  const body = document.getElementById('assets-body');
  const drawer = document.getElementById('asset-drawer');
  const form = document.getElementById('asset-form');
  const formMsg = document.getElementById('asset-form-msg');

  /* ---------- 小工具 ---------- */

  function dash(value) {
    return value === null || value === undefined || value === '' ? '—' : value;
  }

  function badge(label, cls) {
    return el('span', { class: `badge ${cls}`, text: label });
  }

  function statusBadge(status) {
    const info = STATUS[status] || { label: status || '—', cls: 'badge-mute' };
    return badge(info.label, info.cls);
  }

  function equipmentBadge(value) {
    const info = EQUIPMENT[value];
    if (!info) return el('span', { class: 'muted-cell', text: dash(value) });
    return badge(info.label, info.cls);
  }

  function gridItem(label, value) {
    return el('div', {}, [
      el('dt', { text: label }),
      el('dd', { text: dash(value) }),
    ]);
  }

  /* ---------- 登出 ---------- */

  async function logout(event) {
    if (event) event.preventDefault();
    await api('/api/logout', { method: 'POST' });
    location.href = 'login.html';
  }

  document.getElementById('logout-link').addEventListener('click', logout);

  /* ---------- 統計數字 ---------- */

  async function loadStats() {
    const res = await api('/api/assets/stats');
    if (res.status === 401) {
      location.href = 'login.html';
      return false;
    }
    if (!res.ok) return true;

    const s = res.data.stats;
    const count = (key) =>
      s.byStatus.find((row) => row.status === key)?.n ?? 0;

    document.getElementById('stat-total').textContent = s.total;
    document.getElementById('stat-active').textContent = count('active');
    document.getElementById('stat-hold').textContent =
      count('maintenance') + count('loaned');
    const gone = count('retired') + count('lost');
    document.getElementById('stat-gone').textContent = gone;
    // 零嘅時候唔使特別標紅，睇落冇咁似警報
    document
      .getElementById('stat-gone')
      .closest('.stat-tile')
      .classList.toggle('is-bad', gone > 0);
    document.getElementById('stat-buildings').textContent = s.byBuilding.length;
    document.getElementById('stat-imported').textContent = s.importedAt
      ? window.App.formatTime(s.importedAt).slice(0, 10)
      : '未匯入';

    const brand = s.byBrand[0];
    document.getElementById('asset-subtitle').textContent =
      `共 ${s.total} 部電腦，喺 ${s.byBuilding.length} 棟樓。` +
      (brand ? `最多嘅品牌係 ${brand.brand}（${brand.n} 部）。` : '');

    return true;
  }
  /* ---------- 篩選選單 ---------- */

  function fillSelect(select, rows, placeholder) {
    select.textContent = '';
    select.append(el('option', { value: '', text: placeholder }));
    for (const row of rows) {
      const name = row.label ?? row.value;
      const text = row.n ? `${name}（${row.n}）` : name;
      select.append(el('option', { value: row.value, text }));
    }
  }

  async function loadFilters() {
    const res = await api('/api/assets/filters');
    if (!res.ok) return;

    state.filters = res.data;
    fillSelect(
      document.getElementById('filter-building'),
      res.data.buildings,
      '全部樓宇'
    );
    fillSelect(
      document.getElementById('filter-group'),
      res.data.groups,
      '全部類別'
    );
    fillSelect(
      document.getElementById('filter-brand'),
      res.data.brands,
      '全部品牌'
    );
    fillSelect(
      document.getElementById('filter-status'),
      res.data.statuses.map((s) => ({ value: s.value, n: null, label: s.label })),
      '全部狀態'
    );

    const equipment = document.getElementById('filter-equipment');
    equipment.textContent = '';
    equipment.append(el('option', { value: '', text: '全部 Excel 狀態' }));
    equipment.append(el('option', { value: 'NEW', text: '全新' }));
    equipment.append(el('option', { value: 'USED', text: '用過' }));
  }

  function bindFilter(id, key) {
    document.getElementById(id).addEventListener('change', (event) => {
      state[key] = event.target.value;
      state.page = 1;
      loadList();
    });
  }

  /* ---------- 列表 ---------- */

  function buildQuery() {
    const params = new URLSearchParams();
    params.set('limit', String(state.limit));
    params.set('page', String(state.page));
    params.set('sort', state.sort);
    params.set('dir', state.dir);

    if (state.q) params.set('q', state.q);
    if (state.building) params.set('building', state.building);
    if (state.brand) params.set('brand', state.brand);
    if (state.asset_group) params.set('asset_group', state.asset_group);
    if (state.status) params.set('status', state.status);
    if (state.equipment_status) {
      params.set('equipment_status', state.equipment_status);
    }

    return params.toString();
  }

  function renderRows() {
    body.textContent = '';

    if (!state.assets.length) {
      body.append(
        el('tr', {}, [
          el('td', {
            colspan: '9',
            class: 'empty',
            text: '搵唔到符合條件嘅電腦，試下清除篩選。',
          }),
        ])
      );
      return;
    }

    for (const asset of state.assets) {
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
          el('td', { class: 'num', text: dash(asset.arr_date) }),
          el('td', {}, [statusBadge(asset.status)]),
          el('td', { text: dash(asset.custodian) }),
          el('td', {}, [equipmentBadge(asset.equipment_status)]),
          el('td', { class: 'col-narrow' }, [
            el('button', {
              class: 'btn btn-ghost btn-sm',
              text: '詳情',
              onclick: () => openDrawer(asset.id),
            }),
          ]),
        ])
      );
    }
  }
  async function loadList() {
    body.textContent = '';
    body.append(
      el('tr', {}, [
        el('td', { colspan: '9', class: 'loading', text: '載入緊…' }),
      ])
    );

    const res = await api(`/api/assets?${buildQuery()}`);
    if (res.status === 401) {
      location.href = 'login.html';
      return;
    }
    if (!res.ok) {
      body.textContent = '';
      body.append(
        el('tr', {}, [
          el('td', {
            colspan: '9',
            class: 'empty',
            text: res.data.message || '載入唔到資料',
          }),
        ])
      );
      return;
    }

    state.assets = res.data.assets;
    state.total = res.data.total;
    state.page = res.data.page;
    state.pages = res.data.pages;

    renderRows();
    renderPager();
    renderSortHint();
  }

  function renderPager() {
    const from = state.total === 0 ? 0 : (state.page - 1) * state.limit + 1;
    const to = Math.min(state.page * state.limit, state.total);

    document.getElementById('asset-count').textContent =
      `顯示第 ${from} 至 ${to} 部，共 ${state.total} 部`;
    document.getElementById('page-info').textContent =
      `第 ${state.page} / ${state.pages} 頁`;

    document.getElementById('page-prev').disabled = state.page <= 1;
    document.getElementById('page-next').disabled = state.page >= state.pages;
  }

  function renderSortHint() {
    const labels = {
      bar_code: '條碼',
      location: '位置',
      brand: '品牌',
      asset_group: '類別',
      arr_date: '到貨日期',
      status: '狀態',
    };
    const name = labels[state.sort] || state.sort;
    const arrow = state.dir === 'asc' ? '↑' : '↓';

    document.querySelectorAll('th.sortable').forEach((th) => {
      const on = th.dataset.sort === state.sort;
      th.classList.toggle('is-sorted', on);
      if (on) th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });

    document.getElementById('sort-hint').textContent = `按${name}${arrow}排序`;
  }

  document.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sort === key) {
        state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = key;
        state.dir = 'asc';
      }
      state.page = 1;
      loadList();
    });
  });

  document.getElementById('page-prev').addEventListener('click', () => {
    if (state.page <= 1) return;
    state.page -= 1;
    loadList();
  });

  document.getElementById('page-next').addEventListener('click', () => {
    if (state.page >= state.pages) return;
    state.page += 1;
    loadList();
  });

  let searchTimer = null;
  document.getElementById('filter-q').addEventListener('input', (event) => {
    state.q = event.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.page = 1;
      loadList();
    }, 250);
  });

  bindFilter('filter-building', 'building');
  bindFilter('filter-group', 'asset_group');
  bindFilter('filter-brand', 'brand');
  bindFilter('filter-status', 'status');
  bindFilter('filter-equipment', 'equipment_status');

  document.getElementById('clear-filters').addEventListener('click', () => {
    state.q = '';
    state.building = '';
    state.brand = '';
    state.asset_group = '';
    state.status = '';
    state.equipment_status = '';
    state.page = 1;

    document.getElementById('filter-q').value = '';
    document.getElementById('filter-building').value = '';
    document.getElementById('filter-group').value = '';
    document.getElementById('filter-brand').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-equipment').value = '';

    loadList();
  });

  document.getElementById('refresh-btn').addEventListener('click', () => {
    loadStats();
    loadList();
  });
  /* ---------- 右邊詳情面板 ---------- */

  async function openDrawer(id) {
    drawer.hidden = false;
    document.body.classList.add('drawer-open');

    document.getElementById('drawer-title').textContent = '載入緊…';
    document.getElementById('drawer-barcode').textContent = '';
    document.getElementById('drawer-group').textContent = '';
    document.getElementById('excel-grid').textContent = '';
    document.getElementById('managed-grid').textContent = '';
    document.getElementById('asset-logs').textContent = '';
    form.hidden = true;

    const res = await api(`/api/assets/${id}`);
    if (!res.ok) {
      document.getElementById('drawer-title').textContent =
        res.data.message || '載入唔到資料';
      return;
    }

    state.detail = res.data.asset;
    renderDetail(res.data.asset, res.data.logs || []);
  }

  function closeDrawer() {
    drawer.hidden = true;
    document.body.classList.remove('drawer-open');
    state.detail = null;
  }

  function renderDetail(asset, logs) {
    const title = [asset.brand, asset.model_no].filter(Boolean).join(' ');

    document.getElementById('drawer-group').textContent =
      asset.asset_group || '—';
    document.getElementById('drawer-title').textContent = title || '未命名資產';
    document.getElementById('drawer-barcode').textContent =
      `條碼 ${asset.bar_code}` +
      (asset.serial_no ? `　·　序號 ${asset.serial_no}` : '');

    // 管理資料
    const managed = document.getElementById('managed-grid');
    managed.textContent = '';

    if (state.isAdmin) {
      form.hidden = false;
      managed.hidden = true;
      document.getElementById('edit-location').value = asset.location ?? '';
      document.getElementById('edit-status').value = asset.status || 'active';
      document.getElementById('edit-custodian').value = asset.custodian ?? '';
      document.getElementById('edit-department').value = asset.department ?? '';
      document.getElementById('edit-condition').value = asset.condition_note ?? '';
      document.getElementById('edit-note').value = asset.managed_note ?? '';
      document.getElementById('edit-reason').value = '';
      formMsg.textContent = '';
    } else {
      form.hidden = true;
      managed.hidden = false;
      managed.append(
        gridItem('現行位置', asset.location),
        gridItem('樓宇', asset.building),
        gridItem('房間', asset.room),
        gridItem('系統狀態', (STATUS[asset.status] || {}).label),
        gridItem('負責人', asset.custodian),
        gridItem('部門', asset.department),
        gridItem('狀況備註', asset.condition_note),
        gridItem('管理備註', asset.managed_note),
        gridItem('最後修改', asset.updated_at ? window.App.formatTime(asset.updated_at) : '未改過')
      );
    }

    // Excel 原始資料
    const excel = document.getElementById('excel-grid');
    excel.textContent = '';
    excel.append(
      gridItem('Row No', asset.row_no),
      gridItem('EA No', asset.ea_no),
      gridItem('Asset No', asset.asset_no),
      gridItem('AC Code', asset.ac_code),
      gridItem('PO / DN 號', asset.po_no),
      gridItem('PO 日期', asset.po_date),
      gridItem('Excel 原始位置', asset.excel_location),
      gridItem('Excel 狀態', asset.equipment_status),
      gridItem('資產類別', asset.asset_group),
      gridItem('品牌', asset.brand),
      gridItem('型號', asset.model_no),
      gridItem('序號', asset.serial_no),
      gridItem('到貨日期', asset.arr_date),
      gridItem('登記日期', asset.reg_date),
      gridItem('財務年度', asset.fin_year),
      gridItem('Job No', asset.job_no),
      gridItem('Ref', asset.ref_code),
      gridItem('備註', asset.remark)
    );

    // 變更紀錄
    const timeline = document.getElementById('asset-logs');
    timeline.textContent = '';

    if (!logs.length) {
      timeline.append(
        el('li', { class: 'timeline-empty', text: '仲未有人改過呢部機嘅資料。' })
      );
      return;
    }

    for (const log of logs) {
      timeline.append(
        el('li', { class: 'timeline-item' }, [
          el('p', { class: 'timeline-title' }, [
            el('strong', { text: log.field }),
            el('span', {
              class: 'timeline-arrow',
              text: ` ${dash(log.old_value)} → ${dash(log.new_value)}`,
            }),
          ]),
          el('p', { class: 'timeline-meta' }, [
            el('span', { text: log.user_name || '系統' }),
            el('span', { text: '　' + window.App.formatTime(log.created_at) }),
          ]),
          log.note ? el('p', { class: 'timeline-note', text: log.note }) : null,
        ])
      );
    }
  }

  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.querySelectorAll('[data-drawer-close]').forEach((node) => {
    node.addEventListener('click', closeDrawer);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !drawer.hidden) closeDrawer();
  });

  /* ---------- 儲存修改 ---------- */

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.detail) return;

    const save = document.getElementById('asset-save');
    save.disabled = true;
    save.textContent = '儲存緊…';
    formMsg.textContent = '';
    formMsg.className = 'form-msg';

    const payload = {
      location: document.getElementById('edit-location').value.trim(),
      status: document.getElementById('edit-status').value,
      custodian: document.getElementById('edit-custodian').value.trim(),
      department: document.getElementById('edit-department').value.trim(),
      condition_note: document.getElementById('edit-condition').value.trim(),
      managed_note: document.getElementById('edit-note').value.trim(),
      note: document.getElementById('edit-reason').value.trim(),
    };

    try {
      const res = await api(`/api/assets/${state.detail.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        formMsg.textContent = res.data.message || '儲存唔到';
        formMsg.className = 'form-msg form-msg-error';
        return;
      }

      await loadStats();
      await loadList();
      await openDrawer(state.detail.id);

      // 訊息要最後先寫，因為重開詳情會清空表單
      if (res.data.changed) {
        formMsg.textContent = '已經儲存咗';
        formMsg.className = 'form-msg form-msg-ok';
      } else {
        formMsg.textContent = '冇嘢改過';
        formMsg.className = 'form-msg';
      }
    } catch (err) {
      formMsg.textContent = '連唔到伺服器';
      formMsg.className = 'form-msg form-msg-error';
    } finally {
      save.disabled = false;
      save.textContent = '儲存';
    }
  });

  /* ---------- 起手 ---------- */

  (async function start() {
    const me = await api('/api/me');
    if (!me.ok) {
      location.href = 'login.html';
      return;
    }
    state.isAdmin = me.data.user.role === 'admin';

    const ok = await loadStats();
    if (!ok) return;

    await loadFilters();
    await loadList();
  })();
})();
