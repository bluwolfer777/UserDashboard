(function () {
  'use strict';

  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const search = document.getElementById('search');
  let links = [];

  function render() {
    const q = search.value.trim().toLowerCase();
    const visible = links.filter(
      (l) => !q || l.name.toLowerCase().includes(q) || (l.description || '').toLowerCase().includes(q)
    );
    grid.replaceChildren(...visible.map((l) => UD.renderTile(l)));
    empty.hidden = links.length > 0;
    search.hidden = links.length < 8;
  }

  async function load() {
    const res = await fetch('/api/public', { cache: 'no-store' });
    const data = await res.json();
    document.title = data.title || 'Dashboard';
    document.getElementById('title').textContent = data.title || '';
    const sub = document.getElementById('subtitle');
    sub.textContent = data.subtitle || '';
    sub.hidden = !data.subtitle;
    document.body.classList.toggle('text-dark', data.textColor === 'dark');
    UD.applyBackground(document.body, data.background);
    links = data.links || [];
    render();
  }

  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = grid.querySelector('a.tile');
      if (first) first.click();
    }
  });

  load().catch((err) => {
    empty.hidden = false;
    empty.textContent = 'Impossibile caricare la dashboard.';
    console.error(err);
  });
})();
