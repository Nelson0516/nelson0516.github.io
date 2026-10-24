// 頁尾年份自動更新
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

// 複製電郵地址
document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const email = btn.dataset.email;
    const hint = btn.parentElement.querySelector('.copy-hint');
    try {
      await navigator.clipboard.writeText(email);
      hint.textContent = '已複製：' + email;
    } catch {
      hint.textContent = '複製唔到，請手動抄：' + email;
    }
    setTimeout(() => { hint.textContent = ''; }, 4000);
  });
});

// 選單：跟住捲動高亮目前段落
const navLinks = [...document.querySelectorAll('.site-nav a')];
const sections = navLinks
  .map((link) => document.querySelector(link.getAttribute('href')))
  .filter(Boolean);

if (sections.length && 'IntersectionObserver' in window) {
  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => {
          const active = link.getAttribute('href') === '#' + entry.target.id;
          if (active) link.setAttribute('aria-current', 'true');
          else link.removeAttribute('aria-current');
        });
      });
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );
  sections.forEach((section) => spy.observe(section));
}
