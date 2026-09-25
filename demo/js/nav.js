/* nav.js: menu behaviour only. The menu itself is written into every page by
   build.py, so the site still works (and prints) with JavaScript switched off. */
(function () {
  var sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // 1. Tablet / phone: open and close the menu.
  var toggle = sidebar.querySelector('.menu-toggle');
  var panel = document.getElementById('sidebar-panel');
  function setOpen(open) {
    var wasFocusedInside = panel && panel.contains(document.activeElement);
    sidebar.classList.toggle('is-open', open);
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open && wasFocusedInside && toggle) toggle.focus();
  }
  // Close the menu when keyboard focus moves out of it.
  sidebar.addEventListener('focusout', function (e) {
    if (sidebar.classList.contains('is-open') && e.relatedTarget && !sidebar.contains(e.relatedTarget)) setOpen(false);
  });
  if (toggle) toggle.addEventListener('click', function () { setOpen(!sidebar.classList.contains('is-open')); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sidebar.classList.contains('is-open')) setOpen(false); });
  document.addEventListener('click', function (e) {
    if (sidebar.classList.contains('is-open') && !sidebar.contains(e.target)) setOpen(false);
  });
  sidebar.querySelectorAll('.nav__sub a').forEach(function (a) {
    a.addEventListener('click', function () { setOpen(false); });
  });

  // 2. Chevrons expand or collapse a section's sub-links.
  sidebar.querySelectorAll('.nav__chev').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var item = btn.closest('.nav__item');
      var open = !item.classList.contains('is-expanded');
      item.classList.toggle('is-expanded', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  // 3. Highlight the sub-link for the section currently on screen.
  var subs = Array.prototype.slice.call(sidebar.querySelectorAll('.nav__item.is-active .nav__sub a'));
  var targets = subs.map(function (a) {
    var id = decodeURIComponent((a.getAttribute('href') || '').split('#')[1] || '');
    return id ? document.getElementById(id) : null;
  });
  if (!subs.length || !('IntersectionObserver' in window)) return;
  function mark() {
    var current = -1;
    for (var i = 0; i < targets.length; i++) {
      if (targets[i] && targets[i].getBoundingClientRect().top < window.innerHeight * 0.35) current = i;
    }
    subs.forEach(function (a, i) { a.classList.toggle('is-current', i === current); });
  }
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(function () { ticking = false; mark(); }); }
  }, { passive: true });
  mark();
})();
