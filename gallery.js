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
    // Each photo now carries its own description, so the old one-line summary isn't needed.
    var line = document.querySelector('.gallery-caption');
    if (line) line.hidden = true;
    photos().forEach(function (img) {
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', 'View full size: ' + img.alt);
      // Description under each photo.
      var fig = img.closest('figure');
      if (fig && img.alt && !fig.querySelector('figcaption')) {
        var cap = document.createElement('figcaption');
        cap.textContent = img.alt;
        fig.appendChild(cap);
      }
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

  /* ---------- Photos / Videos switch ---------- */
  var vgrid = document.getElementById('videoGrid');
  var tabs = document.querySelectorAll('.gallery-tab');
  var caption = document.querySelector('.gallery-caption');
  var videosLoaded = false;

  function showView(view, fromHash) {
    var vids = view === 'videos';
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-view') === view;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    grid.hidden = vids;
    if (vgrid) vgrid.hidden = !vids;
    if (vids && !videosLoaded) loadVideos();
    if (!fromHash) history.replaceState(null, '', vids ? '#videos' : location.pathname + location.search);
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { showView(t.getAttribute('data-view')); }); });
  window.addEventListener('hashchange', function () { showView(location.hash === '#videos' ? 'videos' : 'photos', true); });

  /* ---------- Videos ---------- */
  var V = window.VideoUtils;
  var vbox = document.createElement('div');
  vbox.className = 'lightbox video-box';
  vbox.setAttribute('role', 'dialog');
  vbox.setAttribute('aria-modal', 'true');
  vbox.setAttribute('aria-label', 'Video player');
  vbox.innerHTML = '<button type="button" class="lb-close" aria-label="Close">&times;</button>' +
    '<div class="vb-inner"><div class="vb-frame"></div><div class="vb-caption"></div></div>';
  document.body.appendChild(vbox);
  var videos = [];

  function closeVideo() {
    vbox.classList.remove('open');
    vbox.querySelector('.vb-frame').innerHTML = '';   // stops playback
    document.documentElement.classList.remove('lb-lock');
  }
  function openVideo(v) {
    var frame = vbox.querySelector('.vb-frame');
    frame.className = 'vb-frame' + (V.isVertical(v) ? ' vertical' : '');
    frame.innerHTML = v.provider === 'file'
      ? '<video src="' + esc(v.url) + '" controls autoplay playsinline title="' + esc(v.title || 'Video') + '"></video>'
      : '<iframe src="' + esc(V.embedUrl(v)) + '" title="' + esc(v.title || 'Video') + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
    vbox.querySelector('.vb-caption').innerHTML = '<strong>' + esc(v.title) + '</strong>' +
      (v.credit ? ' <span>&middot; ' + esc(v.credit) + '</span>' : '') +
      (v.description ? '<div>' + esc(v.description) + '</div>' : '') +
      (v.provider === 'file' ? '' : '<div><a href="' + esc(v.url) + '" target="_blank" rel="noopener">Watch on ' + esc(V.name(v.provider)) + ' &#8599;</a></div>');
    vbox.classList.add('open');
    document.documentElement.classList.add('lb-lock');
    vbox.querySelector('.lb-close').focus();
    if (window.MemberAuth && MemberAuth.track) MemberAuth.track('video_play', { type: 'video', id: v.id, label: v.title, details: { provider: v.provider } });
  }
  vbox.querySelector('.lb-close').addEventListener('click', closeVideo);
  vbox.addEventListener('click', function (e) { if (e.target === vbox || e.target.classList.contains('vb-inner')) closeVideo(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && vbox.classList.contains('open')) closeVideo(); });

  function renderVideos() {
    if (!videos.length) {
      vgrid.innerHTML = '<p class="video-empty">No videos yet. Check back soon.</p>';
      return;
    }
    vgrid.innerHTML = videos.map(function (v, i) {
      var thumb = V.thumbUrl(v);
      return '<button type="button" class="video-card" data-i="' + i + '" aria-label="Play video: ' + esc(v.title) + '">' +
        '<span class="video-thumb vt-' + esc(v.provider) + '">' +
          (thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy">' : v.provider === 'file' ? '<video src="' + esc(v.url) + '#t=0.5" preload="metadata" muted playsinline tabindex="-1"></video>' : '<span class="vt-name">' + esc(V.name(v.provider)) + '</span>') +
          '<span class="video-play" aria-hidden="true">&#9654;</span>' +
          (v.provider === 'file' ? '' : '<span class="video-source">' + esc(V.name(v.provider)) + '</span>') +
        '</span>' +
        '<span class="video-title">' + esc(v.title || 'Video') + '</span>' +
        (v.credit ? '<span class="video-credit">' + esc(v.credit) + '</span>' : '') +
      '</button>';
    }).join('');
  }
  if (vgrid) vgrid.addEventListener('click', function (e) {
    var c = e.target.closest('.video-card');
    if (c) openVideo(videos[+c.getAttribute('data-i')]);
  });

  function loadVideos() {
    videosLoaded = true;
    var cfg = window.MemberAuth && MemberAuth.config;
    if (!cfg || !vgrid) return;
    vgrid.innerHTML = '<p class="video-empty">Loading videos&hellip;</p>';
    fetch(cfg.url + '/rest/v1/gallery_videos?select=id,url,provider,video_id,title,description,credit&active=eq.true&order=sort_order.asc,created_at.asc', {
      headers: { apikey: cfg.key }
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
      videos = rows || [];
      renderVideos();
      var n = document.getElementById('tabVideos');
      if (n) n.textContent = 'Videos (' + videos.length + ')';
    }).catch(function () { vgrid.innerHTML = '<p class="video-empty">Videos couldn\'t be loaded right now.</p>'; });
  }

  if (location.hash === '#videos') showView('videos', true);

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
    var t = document.getElementById('tabPhotos');
    if (t) t.textContent = 'Photos (' + rows.length + ')';
  }).catch(function () {});
  // Show the video count on the tab without waiting for a click.
  if (window.MemberAuth && MemberAuth.config) {
    fetch(MemberAuth.config.url + '/rest/v1/gallery_videos?select=id&active=eq.true', { headers: { apikey: MemberAuth.config.key } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) { var t = document.getElementById('tabVideos'); if (rows && t && !videosLoaded) t.textContent = 'Videos (' + rows.length + ')'; })
      .catch(function () {});
  }
})();
