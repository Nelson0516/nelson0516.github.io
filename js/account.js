(function () {
  const grid = document.getElementById('profile-grid');
  const welcome = document.getElementById('welcome-line');
  const adminPanel = document.getElementById('admin-panel');

  function setField(label, value) {
    const dt = Array.from(grid.querySelectorAll('dt')).find(
      (node) => node.textContent.trim() === label
    );
    if (dt && dt.nextElementSibling) dt.nextElementSibling.textContent = value;
  }

  async function load() {
    const res = await window.App.api('/api/me');
    if (!res.ok) {
      location.href = 'login.html';
      return;
    }

    const user = res.data.user;
    welcome.textContent = `你好，${user.name}。`;
    setField('姓名', user.name);
    setField('帳戶名', user.username);
    setField('身分', user.role === 'admin' ? '管理員' : '一般會員');
    setField(
      '上次登入',
      user.last_login_at ? window.App.formatTime(user.last_login_at) : '第一次登入'
    );
    if (user.role === 'admin') adminPanel.hidden = false;
  }

  async function logout(event) {
    if (event) event.preventDefault();
    await window.App.api('/api/logout', { method: 'POST' });
    location.href = 'login.html';
  }

  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('logout-link').addEventListener('click', logout);

  load();
})();
