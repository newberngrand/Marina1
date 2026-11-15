/* Gallery viewer: click/tap a photo to see it full size.
   Arrows or swipe to move between photos; Esc, the X, or a click outside closes it. */
(function () {
  var imgs = Array.prototype.slice.call(document.querySelectorAll('.gallery-grid img'));
  if (!imgs.length) return;

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

  function show(i) {
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

  imgs.forEach(function (img, i) {
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-label', 'View full size: ' + img.alt);
    img.addEventListener('click', function () { open(i); });
    img.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); }
    });
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

  // Swipe left/right on phones.
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
})();
