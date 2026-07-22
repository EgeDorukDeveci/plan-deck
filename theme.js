/* ════════════════════════════════════════════════════════════
   Shared Day / Night theme logic — used by index.html and landing.html
   ════════════════════════════════════════════════════════════ */

function loadTheme() {
  let theme = localStorage.getItem('deck_theme');
  if (!theme) {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
  }
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('deck_theme', theme);
  document.querySelectorAll('#theme-toggle').forEach(btn => {
    btn.textContent = theme === 'day' ? '☾' : '☀';
  });
}

function toggleTheme() {
  const cur = document.documentElement.dataset.theme;
  applyTheme(cur === 'day' ? 'night' : 'day');
}

document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  document.querySelectorAll('#theme-toggle').forEach(btn => {
    btn.addEventListener('click', toggleTheme);
  });
});
