(function () {
  const form = document.getElementById('login-form');
  const msg = document.getElementById('form-msg');
  const btn = document.getElementById('submit-btn');
  const pw = document.getElementById('password');
  const toggle = document.getElementById('toggle-pw');

  toggle.addEventListener('click', () => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    toggle.textContent = show ? '隱藏' : '顯示';
    toggle.setAttribute('aria-label', show ? '隱藏密碼' : '顯示密碼');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    msg.textContent = '';
    msg.className = 'form-msg';
    btn.disabled = true;
    btn.textContent = '登入中…';

    const username = document.getElementById('username').value.trim();
    const password = pw.value;

    try {
      const res = await window.App.api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        msg.textContent = res.data.message || '登入唔到，請再試';
        msg.className = 'form-msg form-msg-error';
        pw.focus();
        pw.select();
        return;
      }

      location.href = res.data.redirect || 'account.html';
    } catch (err) {
      msg.textContent = '連唔到伺服器，請確認個網站仲開住';
      msg.className = 'form-msg form-msg-error';
    } finally {
      btn.disabled = false;
      btn.textContent = '登入';
    }
  });
})();
