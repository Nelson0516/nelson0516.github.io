(function () {
  const el = window.App.el;

  const state = {
    users: [],
    logs: [],
    logOffset: 0,
    logTotal: 0,
    logLimit: 100,
    userQuery: '',
    logQuery: '',
    failedOnly: false,
  };

  const REASON = {
    ok: { label: '成功', cls: 'badge-ok' },
    wrong_password: { label: '密碼錯誤', cls: 'badge-bad' },
    unknown_user: { label: '帳戶唔存在', cls: 'badge-warn' },
    locked: { label: '帳戶鎖定', cls: 'badge-warn' },
    inactive: { label: '帳戶停用', cls: 'badge-mute' },
    rate_limited: { label: '嘗試太密', cls: 'badge-warn' },
  };

  /* ---------- 登出 ---------- */

  async function logout(event) {
    if (event) event.preventDefault();
    await window.App.api('/api/logout', { method: 'POST' });
    location.href = 'login.html';
  }

  document.getElementById('logout-link').addEventListener('click', logout);

  /* ---------- 分頁切換 ---------- */

  const tabs = [
    { btn: document.getElementById('tab-users'), view: document.getElementById('view-users') },
    { btn: document.getElementById('tab-logs'), view: document.getElementById('view-logs') },
  ];

  tabs.forEach((tab) => {
    tab.btn.addEventListener('click', () => {
      tabs.forEach((other) => {
        const on = other === tab;
        other.btn.setAttribute('aria-selected', on ? 'true' : 'false');
        other.view.hidden = !on;
      });
    });
  });

  /* ---------- 統計數字 ---------- */

  async function loadStats() {
    const res = await window.App.api('/api/admin/stats');
    if (res.status === 401) {
      location.href = 'login.html';
      return false;
    }
    if (!res.ok) return true;

    const s = res.data.stats;
    document.getElementById('stat-total').textContent = s.total;
    document.getElementById('stat-active').textContent = s.active;
    document.getElementById('stat-inactive').textContent = s.inactive;
    document.getElementById('stat-locked').textContent = s.locked;
    document.getElementById('stat-login').textContent = s.loginToday;
    document.getElementById('stat-fail').textContent = s.failToday;
    return true;
  }

  /* ---------- 會員名單 ---------- */

  function statusBadge(user) {
    if (!user.is_active) return el('span', { class: 'badge badge-mute', text: '已停用' });
    if (user.locked) return el('span', { class: 'badge badge-warn', text: '鎖定中' });
    return el('span', { class: 'badge badge-ok', text: '正常' });
  }

  function renderUsers() {
    const body = document.getElementById('users-body');
    body.textContent = '';

    const query = state.userQuery.toLowerCase();
    const rows = state.users.filter(
      (u) =>
        !query ||
        u.name.toLowerCase().includes(query) ||
        u.username.toLowerCase().includes(query)
    );

    document.getElementById('user-count').textContent = `${rows.length} / ${state.users.length} 個會員`;

    if (!rows.length) {
      body.append(
        el('tr', {}, [
          el('td', { colspan: '8', class: 'empty', text: '搵唔到符合嘅會員' }),
        ])
      );
      return;
    }

    for (const user of rows) {
      const actions = el('div', { class: 'cell-actions' }, [
        el('button', {
          class: 'btn btn-ghost btn-sm',
          text: '重設密碼',
          onclick: () => resetPassword(user),
        }),
      ]);

      if (user.locked || user.failed_count > 0) {
        actions.append(
          el('button', {
            class: 'btn btn-ghost btn-sm',
            text: '解鎖',
            onclick: () => unlockUser(user),
          })
        );
      }

      actions.append(
        el('button', {
          class: user.is_active ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm',
          text: user.is_active ? '停用' : '啟用',
          onclick: () => toggleActive(user),
        })
      );

      body.append(
        el('tr', {}, [
          el('td', { text: user.name }),
          el('td', { text: user.username }),
          el('td', {}, [
            user.role === 'admin'
              ? el('span', { class: 'badge badge-info', text: '管理員' })
              : el('span', { class: 'badge badge-mute', text: '會員' }),
          ]),
          el('td', {}, [statusBadge(user)]),
          el('td', { class: 'num', text: String(user.login_count) }),
          el('td', { class: 'num', text: String(user.fail_count) }),
          el('td', {
            text: user.last_login_at ? window.App.formatTime(user.last_login_at) : '未登入過',
          }),
          el('td', {}, [actions]),
        ])
      );
    }
  }

  async function loadUsers() {
    const res = await window.App.api('/api/admin/users');
    if (res.status === 401) {
      location.href = 'login.html';
      return;
    }
    if (!res.ok) return;
    state.users = res.data.users;
    renderUsers();
  }

  document.getElementById('user-search').addEventListener('input', (event) => {
    state.userQuery = event.target.value.trim();
    renderUsers();
  });

  /* ---------- 登入紀錄 ---------- */

  function renderLogs() {
    const body = document.getElementById('logs-body');
    body.textContent = '';

    if (!state.logs.length) {
      body.append(
        el('tr', {}, [
          el('td', { colspan: '6', class: 'empty', text: '未有登入紀錄' }),
        ])
      );
      return;
    }

    for (const log of state.logs) {
      const reason = REASON[log.reason] || { label: log.reason, cls: 'badge-mute' };
      const agent = (log.user_agent || '').split(') ').pop();

      body.append(
        el('tr', {}, [
          el('td', { text: window.App.formatTime(log.created_at) }),
          el('td', { text: log.username_attempted }),
          el('td', { text: log.name || '—' }),
          el('td', {}, [
            el('span', { class: `badge ${reason.cls}`, text: reason.label }),
          ]),
          el('td', { text: log.ip || '—' }),
          el('td', { text: agent || '—' }),
        ])
      );
    }

    document.getElementById('log-more').hidden =
      state.logs.length >= state.logTotal;
  }

  async function loadLogs(reset) {
    if (reset) {
      state.logOffset = 0;
      state.logs = [];
    }

    const params = new URLSearchParams({
      limit: String(state.logLimit),
      offset: String(state.logOffset),
    });
    if (state.logQuery) params.set('name', state.logQuery);
    if (state.failedOnly) params.set('failed', '1');

    const res = await window.App.api(`/api/admin/logs?${params.toString()}`);
    if (res.status === 401) {
      location.href = 'login.html';
      return;
    }
    if (!res.ok) return;

    state.logs = state.logs.concat(res.data.logs);
    state.logTotal = res.data.total;
    state.logOffset = state.logs.length;
    renderLogs();
  }

  let logTimer = null;
  document.getElementById('log-search').addEventListener('input', (event) => {
    state.logQuery = event.target.value.trim();
    clearTimeout(logTimer);
    logTimer = setTimeout(() => loadLogs(true), 250);
  });

  document.getElementById('log-failed-only').addEventListener('change', (event) => {
    state.failedOnly = event.target.checked;
    loadLogs(true);
  });

  document.getElementById('log-more').addEventListener('click', () => loadLogs(false));

  /* ---------- 會員操作 ---------- */

  function showSecret(username, password) {
    document.getElementById('secret-username').textContent = username;
    document.getElementById('secret-value').textContent = password;
    document.getElementById('secret-modal').hidden = false;
  }

  async function resetPassword(user) {
    if (!confirm(`確定要重設 ${user.name} 嘅密碼？\n舊密碼會即刻失效。`)) return;
    const res = await window.App.api(`/api/admin/users/${user.id}/reset-password`, {
      method: 'POST',
    });
    if (!res.ok) {
      alert(res.data.message || '重設唔到');
      return;
    }
    showSecret(user.username, res.data.password);
    loadUsers();
  }

  async function unlockUser(user) {
    const res = await window.App.api(`/api/admin/users/${user.id}/unlock`, {
      method: 'POST',
    });
    if (!res.ok) {
      alert(res.data.message || '解鎖唔到');
      return;
    }
    loadUsers();
    loadStats();
  }

  async function toggleActive(user) {
    const action = user.is_active ? '停用' : '啟用';
    if (!confirm(`確定要${action} ${user.name} 嘅帳戶？`)) return;
    const res = await window.App.api(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: !user.is_active }),
    });
    if (!res.ok) {
      alert(res.data.message || '做唔到');
      return;
    }
    loadUsers();
    loadStats();
  }

  /* ---------- 新增會員 ---------- */

  const newUserModal = document.getElementById('new-user-modal');
  const newUserForm = document.getElementById('new-user-form');
  const newUserMsg = document.getElementById('new-user-msg');

  document.getElementById('new-user-btn').addEventListener('click', () => {
    newUserForm.reset();
    newUserMsg.textContent = '';
    newUserModal.hidden = false;
    document.getElementById('new-username').focus();
  });

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-backdrop').hidden = true;
    });
  });

  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) backdrop.hidden = true;
    });
  });

  newUserForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    newUserMsg.textContent = '';
    newUserMsg.className = 'form-msg';

    const submit = document.getElementById('new-user-submit');
    submit.disabled = true;
    submit.textContent = '建立緊…';

    const payload = {
      username: document.getElementById('new-username').value.trim(),
      name: document.getElementById('new-name').value.trim(),
      role: document.getElementById('new-role').value,
    };

    try {
      const res = await window.App.api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        newUserMsg.textContent = res.data.message || '開唔到個帳戶';
        newUserMsg.className = 'form-msg form-msg-error';
        return;
      }
      newUserModal.hidden = true;
      showSecret(res.data.username, res.data.password);
      loadUsers();
      loadStats();
    } catch (err) {
      newUserMsg.textContent = '連唔到伺服器';
      newUserMsg.className = 'form-msg form-msg-error';
    } finally {
      submit.disabled = false;
      submit.textContent = '建立帳戶';
    }
  });

  document.getElementById('copy-secret').addEventListener('click', async () => {
    const value = document.getElementById('secret-value').textContent;
    try {
      await navigator.clipboard.writeText(value);
      document.getElementById('copy-secret').textContent = '已複製';
      setTimeout(() => {
        document.getElementById('copy-secret').textContent = '複製密碼';
      }, 2000);
    } catch (err) {
      window.prompt('手動複製密碼：', value);
    }
  });

  /* ---------- 起手 ---------- */

  (async function start() {
    const ok = await loadStats();
    if (!ok) return;
    await loadUsers();
    await loadLogs(true);
  })();
})();
