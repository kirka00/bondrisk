// Тема до первой отрисовки (без мигания): ?theme= или сохранённый выбор. Отдельный файл, а не inline-скрипт,
// чтобы Content-Security-Policy в проде обходилась без 'unsafe-inline' для скриптов.
(function () {
  try {
    var q = new URLSearchParams(location.search).get('theme');
    var t = q || localStorage.getItem('bondrisk.theme');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
