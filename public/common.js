/* Shared helpers for the public page and the admin preview. */
(function () {
  'use strict';

  function applyBackground(el, bg) {
    const layer = el.querySelector('.bg-layer') || el;
    layer.style.background = '';
    layer.style.backgroundImage = '';
    layer.style.filter = '';
    if (bg.type === 'image' && bg.image) {
      const overlay = Number(bg.overlay) || 0;
      layer.style.backgroundImage =
        `linear-gradient(rgba(0,0,0,${overlay}), rgba(0,0,0,${overlay})), url("${encodeURI(bg.image)}")`;
      layer.style.backgroundSize = 'cover';
      layer.style.backgroundPosition = 'center';
      layer.style.filter = bg.blur ? `blur(${Number(bg.blur)}px)` : '';
      layer.style.transform = bg.blur ? 'scale(1.05)' : '';
    } else if (bg.type === 'color') {
      layer.style.background = bg.color;
    } else {
      layer.style.background = `linear-gradient(${Number(bg.gradientAngle) || 0}deg, ${bg.gradientFrom}, ${bg.gradientTo})`;
    }
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function renderTile(link, opts) {
    opts = opts || {};
    const a = document.createElement(opts.asDiv ? 'div' : 'a');
    a.className = 'tile';
    if (!opts.asDiv) {
      a.href = link.url;
      if (link.newTab) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    }
    if (link.description) a.title = link.description;

    const icon = document.createElement('div');
    icon.className = 'tile-icon';
    if (link.icon) {
      const img = document.createElement('img');
      img.src = link.icon;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => {
        img.remove();
        icon.textContent = link.emoji || initials(link.name);
        icon.style.background = link.color || '#2563eb';
        icon.classList.add('tile-icon--text');
      };
      icon.appendChild(img);
    } else {
      icon.textContent = link.emoji || initials(link.name);
      icon.style.background = link.color || '#2563eb';
      icon.classList.add(link.emoji ? 'tile-icon--emoji' : 'tile-icon--text');
    }

    const label = document.createElement('div');
    label.className = 'tile-label';
    label.textContent = link.name;

    a.appendChild(icon);
    a.appendChild(label);
    return a;
  }

  window.UD = { applyBackground, renderTile };
})();
