/*
 * 共用嘅詳情抽屜
 *
 * 資產列表同查找頁面都需要睇一部電腦嘅完整資料，
 * 所以做成一個模組，兩個頁面共用同一份。
 */
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

  const state = { isAdmin: false, detail: null };

  let drawer = null;
  let refs = null;

  /* ---------- 組出抽屜 ---------- */

  function field(label, id, control, hint) {
    return el('div', { class: 'field' }, [
      el('label', { for: id, text: label }),
      control,
      hint ? el('p', { class: 'field-hint', text: hint }) : null,
    ]);
  }

  function textInput(id, placeholder) {
    return el('input', { id, type: 'text', placeholder: placeholder || null });
  }

  function buildDrawer() {
    if (drawer) return drawer;

    const form = el('form', {
      id: 'asset-form',
      class: 'drawer-form',
      hidden: 'hidden',
      novalidate: 'novalidate',
    }, [
      field(
        '位置',
        'edit-location',
        textInput('edit-location', '例如 YIA 606'),
        '人手改咗嘅位置，之後再匯入 Excel 都唔會被洗走。'
      ),
      field(
        '系統狀態',
        'edit-status',
        el('select', { id: 'edit-status' }, Object.entries(STATUS).map(([value, info]) =>
          el('option', { value, text: info.label })
        ))
      ),
      field('負責人', 'edit-custodian', textInput('edit-custodian', '邊個用緊部機')),
      field('部門', 'edit-department', textInput('edit-department')),
      field('狀況備註', 'edit-condition', textInput('edit-condition', '例如：電池老化、要換風扇')),
      field(
        '管理備註',
        'edit-note',
        el('textarea', { id: 'edit-note', rows: '3', placeholder: '其他備註' })
      ),
      field('今次改動嘅原因', 'edit-reason', textInput('edit-reason', '會記低喺變更紀錄度')),
      el('p', { class: 'form-msg', id: 'asset-form-msg', role: 'alert' }),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn btn-ghost', type: 'button', 'data-drawer-close': '', text: '取消' }),
        el('button', { class: 'btn btn-primary', type: 'submit', id: 'asset-save', text: '儲存' }),
      ]),
    ]);

    drawer = el('div', { class: 'drawer', id: 'asset-drawer', hidden: 'hidden' }, [
      el('div', { class: 'drawer-scrim', 'data-drawer-close': '' }),
      el('div', {
        class: 'drawer-panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'drawer-title',
      }, [
        el('header', { class: 'drawer-head' }, [
          el('div', {}, [
            el('p', { class: 'drawer-eyebrow', id: 'drawer-group', text: '—' }),
            el('h2', { id: 'drawer-title', text: '—' }),
            el('p', { class: 'drawer-sub', id: 'drawer-barcode', text: '' }),
          ]),
          el('button', {
            class: 'icon-btn',
            type: 'button',
            id: 'drawer-close',
            'aria-label': '關閉詳情',
            text: '×',
          }),
        ]),
        el('div', { class: 'drawer-body' }, [
          el('section', { class: 'drawer-section' }, [
            el('h3', { text: '管理資料' }),
            form,
            el('dl', { class: 'profile-grid', id: 'managed-grid' }),
          ]),
          el('section', { class: 'drawer-section' }, [
            el('h3', { text: 'Excel 原始資料' }),
            el('dl', { class: 'profile-grid', id: 'excel-grid' }),
          ]),
          el('section', { class: 'drawer-section' }, [
            el('h3', { text: '變更紀錄' }),
            el('ol', { class: 'timeline', id: 'asset-logs' }),
          ]),
        ]),
      ]),
    ]);

    document.body.append(drawer);

    refs = {
      form,
      title: drawer.querySelector('#drawer-title'),
      group: drawer.querySelector('#drawer-group'),
      barcode: drawer.querySelector('#drawer-barcode'),
      excel: drawer.querySelector('#excel-grid'),
      managed: drawer.querySelector('#managed-grid'),
      logs: drawer.querySelector('#asset-logs'),
      msg: drawer.querySelector('#asset-form-msg'),
      location: drawer.querySelector('#edit-location'),
      status: drawer.querySelector('#edit-status'),
      custodian: drawer.querySelector('#edit-custodian'),
      department: drawer.querySelector('#edit-department'),
      condition: drawer.querySelector('#edit-condition'),
      note: drawer.querySelector('#edit-note'),
      reason: drawer.querySelector('#edit-reason'),
      save: drawer.querySelector('#asset-save'),
    };

    drawer.querySelector('#drawer-close').addEventListener('click', close);
    drawer.querySelectorAll('[data-drawer-close]').forEach((node) => {
      node.addEventListener('click', close);
    });
    form.addEventListener('submit', onSubmit);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !drawer.hidden) close();
    });

    return drawer;
  }

  /* ---------- 顯示 ---------- */

  function dash(value) {
    return value === null || value === undefined || value === '' ? '—' : value;
  }

  function gridItem(label, value) {
    return el('div', {}, [
      el('dt', { text: label }),
      el('dd', { text: dash(value) }),
    ]);
  }

  async function open(id) {
    buildDrawer();

    drawer.hidden = false;
    document.body.classList.add('drawer-open');

    refs.title.textContent = '載入緊…';
    refs.barcode.textContent = '';
    refs.group.textContent = '';
    refs.excel.textContent = '';
    refs.managed.textContent = '';
    refs.logs.textContent = '';
    refs.form.hidden = true;

    const res = await api(`/api/assets/${id}`);
    if (!res.ok) {
      refs.title.textContent = res.data.message || '載入唔到資料';
      return;
    }

    state.detail = res.data.asset;
    render(res.data.asset, res.data.logs || []);
  }

  function close() {
    if (!drawer) return;
    drawer.hidden = true;
    document.body.classList.remove('drawer-open');
    state.detail = null;
  }

  function render(asset, logs) {
    const title = [asset.brand, asset.model_no].filter(Boolean).join(' ');

    refs.group.textContent = asset.asset_group || '—';
    refs.title.textContent = title || '未命名資產';
    refs.barcode.textContent =
      `條碼 ${asset.bar_code}` +
      (asset.serial_no ? `　·　序號 ${asset.serial_no}` : '');

    // 管理資料
    refs.managed.textContent = '';

    if (state.isAdmin) {
      refs.form.hidden = false;
      refs.managed.hidden = true;
      refs.location.value = asset.location ?? '';
      refs.status.value = asset.status || 'active';
      refs.custodian.value = asset.custodian ?? '';
      refs.department.value = asset.department ?? '';
      refs.condition.value = asset.condition_note ?? '';
      refs.note.value = asset.managed_note ?? '';
      refs.reason.value = '';
      refs.msg.textContent = '';
    } else {
      refs.form.hidden = true;
      refs.managed.hidden = false;
      refs.managed.append(
        gridItem('現行位置', asset.location),
        gridItem('樓宇', asset.building),
        gridItem('房間', asset.room),
        gridItem('系統狀態', (STATUS[asset.status] || {}).label),
        gridItem('負責人', asset.custodian),
        gridItem('部門', asset.department),
        gridItem('狀況備註', asset.condition_note),
        gridItem('管理備註', asset.managed_note),
        gridItem(
          '最後修改',
          asset.updated_at ? window.App.formatTime(asset.updated_at) : '未改過'
        )
      );
    }

    // Excel 原始資料
    refs.excel.textContent = '';
    refs.excel.append(
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
    refs.logs.textContent = '';

    if (!logs.length) {
      refs.logs.append(
        el('li', { class: 'timeline-empty', text: '仲未有人改過呢部機嘅資料。' })
      );
      return;
    }

    for (const log of logs) {
      refs.logs.append(
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

  /* ---------- 儲存 ---------- */

  async function onSubmit(event) {
    event.preventDefault();
    if (!state.detail) return;

    refs.save.disabled = true;
    refs.save.textContent = '儲存緊…';
    refs.msg.textContent = '';
    refs.msg.className = 'form-msg';

    const payload = {
      location: refs.location.value.trim(),
      status: refs.status.value,
      custodian: refs.custodian.value.trim(),
      department: refs.department.value.trim(),
      condition_note: refs.condition.value.trim(),
      managed_note: refs.note.value.trim(),
      note: refs.reason.value.trim(),
    };

    try {
      const res = await api(`/api/assets/${state.detail.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        refs.msg.textContent = res.data.message || '儲存唔到';
        refs.msg.className = 'form-msg form-msg-error';
        return;
      }

      await open(state.detail.id);

      // 訊息要最後先寫，因為重開詳情會清空表單
      if (res.data.changed) {
        refs.msg.textContent = '已經儲存咗';
        refs.msg.className = 'form-msg form-msg-ok';
      } else {
        refs.msg.textContent = '冇嘢改過';
        refs.msg.className = 'form-msg';
      }
    } catch (err) {
      refs.msg.textContent = '連唔到伺服器';
      refs.msg.className = 'form-msg form-msg-error';
    } finally {
      refs.save.disabled = false;
      refs.save.textContent = '儲存';
    }
  }

  window.App.assetDrawer = { open, close, state, STATUS };
})();
