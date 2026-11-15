/* Gallery: photos come from the database (managed on the Admin page), with
   the photos written into the page as a fallback. Click/tap a photo to see it
   full size; arrows or swipe move between photos; Esc, X or outside click closes. */
(function () {
  var grid = document.querySelector('.gallery-grid');
  if (!grid) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- Viewer ---------- */
  var box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Photo viewer');
  box.innerHTML =
    '<button type="button" class="lb-close" aria-label="Close">&times;</button>' +
    '<button type="button" class="lb-nav lb-prev" aria-label="Previous photo">&#8249;</button>' +
    '<figure class="lb-figure"><img class="lb-img" alt=""><figcaption class="lb-caption"></figcaption></figure>' +
    '<button type="button" class="lb-nav lb-next" aria-label="Next photo">&#8250;</button>' +
    '<div class="lb-count" aria-live="polite"></div>';
  document.body.appendChild(box);

  var big = box.querySelector('.lb-img');
  var cap = box.querySelector('.lb-caption');
  var count = box.querySelector('.lb-count');
  var index = 0, lastFocus = null;

  function photos() { return Array.prototype.slice.call(grid.querySelectorAll('img')); }

  function prepare() {
    photos().forEach(function (img) {
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', 'View full size: ' + img.alt);
    });
  }

  function show(i) {
    var imgs = photos();
    if (!imgs.length) return;
    index = (i + imgs.length) % imgs.length;
    var src = imgs[index];
    big.src = src.currentSrc || src.src;
    big.alt = src.alt;
    cap.textContent = src.alt;
    count.textContent = (index + 1) + ' of ' + imgs.length;
  }
  function open(i) {
    lastFocus = document.activeElement;
    show(i);
    box.classList.add('open');
    document.documentElement.classList.add('lb-lock');
    box.querySelector('.lb-close').focus();
  }
  function close() {
    box.classList.remove('open');
    document.documentElement.classList.remove('lb-lock');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  grid.addEventListener('click', function (e) {
    var img = e.target.closest('img');
    if (img) open(photos().indexOf(img));
  });
  grid.addEventListener('keydown', function (e) {
    var img = e.target.closest('img');
    if (img && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(photos().indexOf(img)); }
  });
  box.querySelector('.lb-close').addEventListener('click', close);
  box.querySelector('.lb-prev').addEventListener('click', function () { show(index - 1); });
  box.querySelector('.lb-next').addEventListener('click', function () { show(index + 1); });
  box.addEventListener('click', function (e) {
    if (e.target === box || e.target.classList.contains('lb-figure')) close();
  });
  document.addEventListener('keydown', function (e) {
    if (!box.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
  });
  var startX = null, startY = null;
  box.addEventListener('touchstart', function (e) {
    if (e.touches.length === 1) { startX = e.touches[0].clientX; startY = e.touches[0].clientY; }
  }, { passive: true });
  box.addEventListener('touchend', function (e) {
    if (startX === null) return;
    var dx = e.changedTouches[0].clientX - startX, dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
    startX = startY = null;
  });

  prepare();

  /* ---------- Load the current photo list ---------- */
  var cfg = window.MemberAuth && MemberAuth.config;
  if (!cfg) return;
  fetch(cfg.url + '/rest/v1/gallery_photos?select=src,caption&active=eq.true&order=sort_order.asc,created_at.asc', {
    headers: { apikey: cfg.key }
  }).then(function (r) { return r.ok ? r.json() : null; }).then(function (rows) {
    if (!rows || !rows.length) return;
    grid.innerHTML = rows.map(function (p) {
      return '<figure class="photo-frame"><img src="' + esc(p.src) + '" alt="' + esc(p.caption) + '" loading="lazy"></figure>';
    }).join('');
    var line = document.querySelector('.gallery-caption');
    if (line) line.hidden = true;
    prepare();
  }).catch(function () {});
})();
