(function () {
  'use strict';

  var API = '/recorder-api';
  var MENU_ANCHOR_RE = /(встроить встречу|embed meeting|комбинации клавиш|keyboard shortcuts)/i;
  var state = { status: 'idle', error: null };

  function roomName() {
    var parts = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    return parts.length ? decodeURIComponent(parts[parts.length - 1]) : '';
  }

  // Находим СТРОКУ меню с текстом-якорем: поднимаемся от текстовой ноды,
  // пока родитель не станет списком (>=3 детей) - значит текущий элемент и есть строка
  function findAnchorRow() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      if (MENU_ANCHOR_RE.test(node.nodeValue || '')) {
        var cur = node.parentElement;
        while (cur && cur.parentElement && cur.parentElement !== document.body && cur.parentElement.childElementCount <= 2) {
          cur = cur.parentElement;
        }
        if (cur && cur.parentElement && cur.parentElement.childElementCount >= 3) return cur;
      }
    }
    return null;
  }

  function label() {
    switch (state.status) {
      case 'loading': return '⏳ Призываю бота…';
      case 'active':  return '✅ Бот уже пишет встречу';
      case 'error':   return '❌ Ошибка: ' + (state.error || 'повторите');
      default:        return '🎙 Призвать бота записи';
    }
  }

  function isDisabled() {
    return state.status === 'loading' || state.status === 'active';
  }

  function refreshActive(cb) {
    fetch(API + '/recordings')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var room = roomName().toLowerCase();
        var active = (d && d.active || []).some(function (r) { return r.toLowerCase() === room; });
        if (active) state.status = 'active';
        else if (state.status === 'active') state.status = 'idle';
        if (cb) cb();
      })
      .catch(function () { if (cb) cb(); });
  }

  function summon(item) {
    if (isDisabled()) return;
    state.status = 'loading';
    render(item);
    fetch(API + '/recordings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: roomName(), displayName: 'Recorder Bot' })
    })
      .then(function (r) {
        if (r.status === 200 || r.status === 409) { state.status = 'active'; }
        else { state.status = 'error'; state.error = 'HTTP ' + r.status; }
        render(item);
        if (state.status === 'error') setTimeout(function () { state.status = 'idle'; render(item); }, 4000);
      })
      .catch(function (e) {
        state.status = 'error'; state.error = 'сеть'; render(item);
        setTimeout(function () { state.status = 'idle'; render(item); }, 4000);
      });
  }

  function render(item) {
    if (!item || !document.body.contains(item)) return;
    var textEl = item.querySelector('[data-summon-text]');
    if (textEl) textEl.textContent = label();
    item.style.opacity = isDisabled() ? '0.55' : '1';
    item.style.pointerEvents = isDisabled() ? 'none' : 'auto';
  }

  function inject() {
    var row = findAnchorRow();
    if (!row) return;
    var list = row.parentElement;
    if (list.querySelector('#summon-bot-item')) { render(list.querySelector('#summon-bot-item')); return; }

    // Полная копия строки меню (сохраняет стили), но чистим содержимое
    var item = row.cloneNode(true);
    item.querySelectorAll('svg, img').forEach(function (n) { n.remove(); });
    var leaves = [];
    item.querySelectorAll('*').forEach(function (n) {
      if (n.childElementCount === 0 && n.textContent.trim()) leaves.push(n);
    });
    leaves.forEach(function (n, i) { n.textContent = (i === 0) ? label() : ''; });
    if (leaves.length === 0) { item.textContent = label(); }
    else { leaves[0].setAttribute('data-summon-text', '1'); }

    item.id = 'summon-bot-item';
    item.style.cursor = 'pointer';
    item.addEventListener('click', function (e) { e.stopPropagation(); summon(item); });
    row.insertAdjacentElement('afterend', item);

    refreshActive(function () { render(item); });
  }

  var scheduled = false;
  function scheduleInject() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () { scheduled = false; inject(); });
  }

  new MutationObserver(scheduleInject).observe(document.body, { childList: true, subtree: true });
  scheduleInject();
})();
