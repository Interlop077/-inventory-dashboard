/* Poster: дополнительный источник данных для Dashboard.
   Код Dashboard не изменяется. Нужны: элемент #poster-source и глобальная функция
   renderCard(card, filename, rows) из index.html. Ручная загрузка Excel работает как раньше. */
(function () {
  'use strict';

  // === НАСТРОЙКА: адрес backend. Для смены backend меняется только эта строка. ===
  const BACKEND_URL = 'https://poster-backend-2ztd.onrender.com/';
  // =============================================================================
  const API = '/api/v1';
  const PW_KEY = 'poster_admin_pw';
  const TIMEOUT_MS = 90000; // бесплатный сервер может просыпаться около минуты

  const mount = document.getElementById('poster-source');
  if (!mount) return;
  const base = BACKEND_URL.replace(/\/+$/, '');

  const esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  };

  const state = { step: 'login', busy: false, msg: '', err: '', venueId: '', invId: '' };
  let password = '';
  let venues = [];
  let inventories = [];
  try { password = localStorage.getItem(PW_KEY) || ''; } catch (e) { /* хранилище недоступно */ }
  function storePw(v) {
    try { if (v) localStorage.setItem(PW_KEY, v); else localStorage.removeItem(PW_KEY); } catch (e) { /* ignore */ }
  }

  async function api(path) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    let res;
    try {
      res = await fetch(base + API + path, { headers: { 'X-Admin-Password': password }, signal: ctrl.signal });
    } catch (e) {
      throw {
        code: 'NETWORK',
        message: e && e.name === 'AbortError'
          ? 'Сервер не ответил за 90 секунд. Повторите попытку.'
          : 'Нет связи с сервером. Проверьте интернет (бесплатный сервер просыпается до минуты) ' +
            'и что адрес сайта указан в ALLOWED_ORIGINS на сервере.'
      };
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* не JSON */ }
    if (!res.ok) {
      const err = (data && data.error) || { code: 'HTTP_' + res.status, message: 'Ошибка сервера (' + res.status + ')' };
      if (err.code === 'UNAUTHORIZED') { password = ''; storePw(''); }
      throw err;
    }
    return data;
  }

  function fail(e) {
    const code = e && e.code ? e.code : '';
    state.err = (e && e.message ? e.message : 'Неизвестная ошибка') +
      (code && code !== 'NETWORK' ? ' [' + code + ']' : '');
    if (code === 'UNAUTHORIZED') state.step = 'login';
  }

  function dis(cond) { return cond ? ' disabled' : ''; }
  function tail() {
    return (state.msg ? '<div class="poster-msg">' + esc(state.msg) + '</div>' : '') +
           (state.err ? '<div class="poster-err">' + esc(state.err) + '</div>' : '');
  }

  function render() {
    let html;
    if (state.step === 'login') {
      html =
        '<div class="card-head"><div class="card-info"><div class="file-name">Poster</div>' +
        '<div class="meta">Инвентаризации напрямую из Poster. Введите пароль администратора.</div></div></div>' +
        '<div class="poster-body">' +
        '<input type="password" id="pPw" placeholder="Пароль администратора" autocomplete="current-password" ' +
        'autocapitalize="off" value="' + esc(password) + '"' + dis(state.busy) + '>' +
        '<div class="poster-actions"><button class="btn" id="pLogin" type="button"' + dis(state.busy) + '>Войти</button></div>' +
        tail() + '</div>';
    } else {
      const venueOpts = venues.map(function (v) {
        return '<option value="' + esc(v.id) + '"' + (String(v.id) === state.venueId ? ' selected' : '') + '>' + esc(v.name) + '</option>';
      }).join('');
      const invOpts = inventories.map(function (i) {
        return '<option value="' + esc(i.inventory_id) + '"' + (i.inventory_id === state.invId ? ' selected' : '') + '>' +
          esc((i.date || 'без даты') + ' (№' + i.inventory_id + ')') + '</option>';
      }).join('');
      html =
        '<div class="card-head"><div class="card-info"><div class="file-name">Poster</div>' +
        '<div class="meta">Выберите заведение и дату инвентаризации</div></div>' +
        '<button class="poster-link" id="pLogout" type="button">Выйти</button></div>' +
        '<div class="poster-body">' +
        '<label for="pVenue">Заведение</label>' +
        '<select id="pVenue"' + dis(state.busy || !venues.length) + '><option value="">Выберите…</option>' + venueOpts + '</select>' +
        '<label for="pInv">Инвентаризация (дата)</label>' +
        '<select id="pInv"' + dis(state.busy || !inventories.length) + '><option value="">Выберите дату…</option>' + invOpts + '</select>' +
        '<div class="poster-actions"><button class="btn" id="pLoad" type="button"' + dis(state.busy || !state.invId) + '>Загрузить</button></div>' +
        tail() + '</div>';
    }
    mount.innerHTML = '<section class="card poster-card">' + html + '</section>';
    bind();
  }

  function bind() {
    const q = function (id) { return mount.querySelector('#' + id); };
    if (state.step === 'login') {
      q('pLogin').addEventListener('click', onLogin);
      q('pPw').addEventListener('keydown', function (e) { if (e.key === 'Enter') onLogin(); });
    } else {
      q('pLogout').addEventListener('click', onLogout);
      q('pVenue').addEventListener('change', onVenue);
      q('pInv').addEventListener('change', function (e) { state.invId = e.target.value; render(); });
      q('pLoad').addEventListener('click', onLoad);
    }
  }

  async function enter() {
    state.busy = true; state.msg = 'Подключаюсь к серверу…'; state.err = ''; render();
    try {
      venues = await api('/venues');
      storePw(password);
      state.step = 'ready';
      state.msg = venues.length ? '' : 'Заведения не добавлены. Добавьте их на странице /docs сервера.';
    } catch (e) { fail(e); state.msg = ''; }
    state.busy = false; render();
  }

  function onLogin() {
    const el = mount.querySelector('#pPw');
    password = (el ? el.value : '').trim();
    if (!password) return;
    enter();
  }

  function onLogout() {
    password = ''; storePw(''); venues = []; inventories = [];
    state.step = 'login'; state.venueId = ''; state.invId = ''; state.msg = ''; state.err = '';
    render();
  }

  async function onVenue(e) {
    state.venueId = e.target.value; state.invId = ''; inventories = []; state.err = ''; state.msg = '';
    if (!state.venueId) { render(); return; }
    state.busy = true; state.msg = 'Загружаю список инвентаризаций…'; render();
    try {
      inventories = await api('/venues/' + encodeURIComponent(state.venueId) + '/inventories');
      state.msg = inventories.length ? '' : 'Проведённых инвентаризаций нет.';
    } catch (err) { fail(err); state.msg = ''; }
    state.busy = false; render();
  }

  function addCard(data) {
    const results = document.getElementById('results');
    if (typeof renderCard !== 'function' || !results) {
      throw { code: 'DASHBOARD', message: 'Не найдены элементы Dashboard (renderCard, #results).' };
    }
    if (!data || !Array.isArray(data.rows)) {
      throw { code: 'BAD_DATA', message: 'Сервер вернул данные в неожиданном формате.' };
    }
    const card = document.createElement('section');
    card.className = 'card';
    results.prepend(card);
    renderCard(card, data.filename, data.rows); // тот же путь, что у Excel: таблица, подсветка, скачивание
    if (data.warnings && data.warnings.length) {
      const w = document.createElement('div');
      w.className = 'poster-warn';
      w.textContent = data.warnings.join(' ');
      card.appendChild(w);
    }
  }

  async function onLoad() {
    if (!state.venueId || !state.invId) return;
    state.busy = true; state.msg = 'Загружаю результаты инвентаризации…'; state.err = ''; render();
    try {
      const data = await api('/inventories/' + encodeURIComponent(state.invId) + '?venue=' + encodeURIComponent(state.venueId));
      addCard(data);
      state.msg = 'Загружено: ' + data.filename;
    } catch (err) { fail(err); state.msg = ''; }
    state.busy = false; render();
  }

  render();
  if (BACKEND_URL.indexOf('ВАШ-СЕРВИС') !== -1) {
    state.err = 'Не задан адрес сервера: откройте poster.js и впишите BACKEND_URL.';
    render();
    return;
  }
  try { fetch(base + '/health', { mode: 'no-cors' }).catch(function () {}); } catch (e) { /* прогрев сервера */ }
  if (password) enter();
})();
