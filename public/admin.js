(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  let settings = null;
  let editingId = null;

  // ---------- API ----------
  async function api(method, url, body) {
    const opts = { method, headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      /* empty */
    }
    if (res.status === 401 && !url.endsWith('/login')) {
      showLogin();
      throw new Error('Sessione scaduta');
    }
    if (!res.ok) throw new Error((data && data.error) || `Errore ${res.status}`);
    return data;
  }

  // ---------- views ----------
  function showLogin() {
    $('#admin-view').hidden = true;
    $('#login-view').hidden = false;
    $('#login-form [name=username]').focus();
  }

  async function showAdmin(user) {
    $('#login-view').hidden = true;
    $('#admin-view').hidden = false;
    $('#whoami').textContent = user.displayName || user.username;
    settings = await api('GET', '/api/admin/settings');
    fillAppearance();
    renderLinks();
    renderPreview();
  }

  // ---------- login ----------
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('#login-error');
    err.hidden = true;
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    try {
      const { user } = await api('POST', '/api/login', {
        username: f.username.value,
        password: f.password.value,
      });
      f.password.value = '';
      await showAdmin(user);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $('#logout').addEventListener('click', async () => {
    await api('POST', '/api/logout').catch(() => {});
    settings = null;
    showLogin();
  });

  // ---------- appearance ----------
  const af = $('#appearance-form');

  function fillAppearance() {
    const bg = settings.background;
    af.title.value = settings.title || '';
    af.subtitle.value = settings.subtitle || '';
    af.textColor.value = settings.textColor || 'light';
    $$('input[name=bgType]', af).forEach((r) => (r.checked = r.value === bg.type));
    af.color.value = bg.color;
    af.gradientFrom.value = bg.gradientFrom;
    af.gradientTo.value = bg.gradientTo;
    af.gradientAngle.value = bg.gradientAngle;
    af.overlay.value = bg.overlay;
    af.blur.value = bg.blur;
    syncAppearanceUi();
  }

  function readAppearance() {
    return {
      title: af.title.value,
      subtitle: af.subtitle.value,
      textColor: af.textColor.value,
      background: {
        type: ($('input[name=bgType]:checked', af) || {}).value || 'gradient',
        color: af.color.value,
        gradientFrom: af.gradientFrom.value,
        gradientTo: af.gradientTo.value,
        gradientAngle: Number(af.gradientAngle.value),
        overlay: Number(af.overlay.value),
        blur: Number(af.blur.value),
      },
    };
  }

  function syncAppearanceUi() {
    const type = ($('input[name=bgType]:checked', af) || {}).value;
    $$('[data-bg]', af).forEach((el) => (el.hidden = el.dataset.bg !== type));
    $('[data-for=gradientAngle]').textContent = af.gradientAngle.value + '°';
    $('[data-for=overlay]').textContent = Math.round(af.overlay.value * 100) + '%';
    $('[data-for=blur]').textContent = af.blur.value + 'px';
    $('#bg-remove').hidden = !settings.background.image;
  }

  af.addEventListener('input', () => {
    syncAppearanceUi();
    renderPreview();
  });

  af.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('#appearance-status');
    try {
      const data = readAppearance();
      if (data.background.type === 'image' && !settings.background.image) {
        throw new Error('Carica prima un’immagine');
      }
      settings = await api('PUT', '/api/admin/settings', data);
      flash(status, 'Salvato ✓');
    } catch (ex) {
      flash(status, ex.message, true);
    }
  });

  $('#bg-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = $('#appearance-status');
    const fd = new FormData();
    fd.append('image', file);
    try {
      // save the other pending appearance changes first
      settings = await api('PUT', '/api/admin/settings', readAppearance());
      settings = await api('POST', '/api/admin/background/image', fd);
      fillAppearance();
      renderPreview();
      flash(status, 'Immagine caricata ✓');
    } catch (ex) {
      flash(status, ex.message, true);
    }
    e.target.value = '';
  });

  $('#bg-remove').addEventListener('click', async () => {
    if (!confirm('Rimuovere l’immagine di sfondo?')) return;
    settings = await api('DELETE', '/api/admin/background/image');
    fillAppearance();
    renderPreview();
  });

  function flash(el, text, isError) {
    el.textContent = text;
    el.classList.toggle('error', Boolean(isError));
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.textContent = ''), 4000);
  }

  // ---------- preview ----------
  function renderPreview() {
    if (!settings) return;
    const draft = readAppearance();
    const bg = { ...draft.background, image: settings.background.image };
    const preview = $('#preview');
    UD.applyBackground(preview, bg);
    preview.classList.toggle('text-dark', draft.textColor === 'dark');
    $('#preview-title').textContent = draft.title;
    $('#preview-sub').textContent = draft.subtitle;
    $('#preview-grid').replaceChildren(...settings.links.map((l) => UD.renderTile(l, { asDiv: true })));
  }

  // ---------- links ----------
  function renderLinks() {
    const list = $('#link-list');
    list.replaceChildren(
      ...settings.links.map((link, idx) => {
        const li = document.createElement('li');
        li.className = 'link-item';
        li.draggable = true;
        li.dataset.id = link.id;

        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.textContent = '⋮⋮';
        handle.title = 'Trascina per riordinare';

        const tile = UD.renderTile(link, { asDiv: true });
        tile.classList.add('tile--mini');

        const info = document.createElement('div');
        info.className = 'link-info';
        const n = document.createElement('strong');
        n.textContent = link.name;
        const u = document.createElement('span');
        u.className = 'muted small';
        u.textContent = link.url;
        info.append(n, u);

        const actions = document.createElement('div');
        actions.className = 'link-actions';
        actions.append(
          iconBtn('↑', 'Sposta su', idx === 0, () => move(idx, -1)),
          iconBtn('↓', 'Sposta giù', idx === settings.links.length - 1, () => move(idx, 1)),
          iconBtn('✎', 'Modifica', false, () => openEditor(link)),
          iconBtn('🗑', 'Elimina', false, () => removeLink(link), 'btn-danger')
        );

        li.append(handle, tile, info, actions);
        return li;
      })
    );
    $('#link-empty').hidden = settings.links.length > 0;
    renderPreview();
  }

  function iconBtn(text, title, disabled, onClick, extra) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-icon ' + (extra || '');
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  async function saveOrder(ids) {
    settings.links = await api('PUT', '/api/admin/links/order', { ids });
    renderLinks();
  }

  function move(idx, delta) {
    const ids = settings.links.map((l) => l.id);
    const [id] = ids.splice(idx, 1);
    ids.splice(idx + delta, 0, id);
    saveOrder(ids);
  }

  async function removeLink(link) {
    if (!confirm(`Eliminare “${link.name}”?`)) return;
    await api('DELETE', '/api/admin/links/' + link.id);
    settings.links = settings.links.filter((l) => l.id !== link.id);
    renderLinks();
  }

  // drag & drop reordering
  let dragId = null;
  const list = $('#link-list');
  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.link-item');
    if (!li) return;
    dragId = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const dragging = $('.dragging', list);
    const after = $$('.link-item:not(.dragging)', list).find((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (after) list.insertBefore(dragging, after);
    else list.appendChild(dragging);
  });
  list.addEventListener('dragend', () => {
    const dragging = $('.dragging', list);
    if (dragging) dragging.classList.remove('dragging');
    if (!dragId) return;
    dragId = null;
    const ids = $$('.link-item', list).map((el) => el.dataset.id);
    if (ids.join() !== settings.links.map((l) => l.id).join()) saveOrder(ids);
  });

  // ---------- link editor ----------
  const dialog = $('#link-dialog');
  const lf = $('#link-form');

  function iconModeOf(link) {
    if (!link || !link.icon) return link && link.emoji ? 'emoji' : 'letter';
    return link.icon.startsWith('/uploads/') ? 'upload' : 'url';
  }

  function openEditor(link) {
    editingId = link ? link.id : null;
    $('#link-dialog-title').textContent = link ? 'Modifica collegamento' : 'Nuovo collegamento';
    lf.reset();
    lf.name.value = link ? link.name : '';
    lf.url.value = link ? link.url : '';
    lf.description.value = link ? link.description || '' : '';
    lf.newTab.checked = link ? Boolean(link.newTab) : true;
    lf.color.value = (link && link.color) || '#2563eb';
    lf.emoji.value = (link && link.emoji) || '';
    lf.iconUrl.value = link && link.icon && !link.icon.startsWith('/uploads/') ? link.icon : '';
    const mode = iconModeOf(link);
    $$('input[name=iconMode]', lf).forEach((r) => (r.checked = r.value === mode));
    $('#current-icon-note').hidden = !(link && link.icon && link.icon.startsWith('/uploads/'));
    $('#link-error').hidden = true;
    syncEditor();
    dialog.showModal();
    lf.name.focus();
  }

  function editorDraft() {
    const mode = ($('input[name=iconMode]:checked', lf) || {}).value;
    const current = editingId ? settings.links.find((l) => l.id === editingId) : null;
    let icon = '';
    if (mode === 'url') icon = lf.iconUrl.value.trim();
    if (mode === 'upload') {
      const file = lf.iconFile.files[0];
      if (file) icon = URL.createObjectURL(file);
      else if (current && current.icon && current.icon.startsWith('/uploads/')) icon = current.icon;
    }
    return {
      mode,
      name: lf.name.value || 'Nome',
      icon,
      emoji: mode === 'emoji' ? lf.emoji.value.trim() : '',
      color: lf.color.value,
    };
  }

  function syncEditor() {
    const mode = ($('input[name=iconMode]:checked', lf) || {}).value;
    $$('[data-icon]', lf).forEach((el) => (el.hidden = !el.dataset.icon.split(' ').includes(mode)));
    const tp = $('#tile-preview');
    const prevImg = $('img', tp);
    if (prevImg && prevImg.src.startsWith('blob:')) URL.revokeObjectURL(prevImg.src);
    tp.replaceChildren(UD.renderTile(editorDraft(), { asDiv: true }));
  }

  lf.addEventListener('input', syncEditor);
  lf.addEventListener('change', syncEditor);
  $('#link-cancel').addEventListener('click', () => dialog.close());

  lf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#link-error');
    err.hidden = true;
    const mode = ($('input[name=iconMode]:checked', lf) || {}).value;
    const current = editingId ? settings.links.find((l) => l.id === editingId) : null;

    const fd = new FormData();
    fd.append('name', lf.name.value);
    fd.append('url', lf.url.value);
    fd.append('description', lf.description.value);
    fd.append('newTab', String(lf.newTab.checked));
    fd.append('color', lf.color.value);
    fd.append('emoji', mode === 'emoji' ? lf.emoji.value.trim() : '');

    if (mode === 'upload') {
      const file = lf.iconFile.files[0];
      if (file) fd.append('iconFile', file);
      else if (!(current && current.icon && current.icon.startsWith('/uploads/'))) {
        err.textContent = 'Seleziona un file immagine';
        err.hidden = false;
        return;
      }
    } else if (mode === 'url') {
      fd.append('iconUrl', lf.iconUrl.value.trim());
    } else {
      fd.append('iconUrl', '');
    }

    try {
      if (editingId) {
        const updated = await api('PUT', '/api/admin/links/' + editingId, fd);
        settings.links = settings.links.map((l) => (l.id === editingId ? updated : l));
      } else {
        const created = await api('POST', '/api/admin/links', fd);
        settings.links.push(created);
      }
      dialog.close();
      renderLinks();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  $('#add-link').addEventListener('click', () => openEditor(null));

  // ---------- boot ----------
  api('GET', '/api/me')
    .then((me) => {
      if (me.domain) $('#login-hint').textContent = `Accedi con un account amministratore di ${me.domain}.`;
      if (me.user) return showAdmin(me.user);
      showLogin();
    })
    .catch(showLogin);
})();
