/* questionnaire.js: behaviour for the questionnaire page. questionnaire.py writes every question into the
   page, so this file only adds: autosave, sliders, the noun builder, one question per screen on phones,
   Send and Download. Answers stay in this browser (localStorage) until the visitor sends or downloads them.
   Nothing ever goes into the web address. */
(function () {
  var form = document.getElementById('qform');
  var dataEl = document.getElementById('q-data');
  if (!form || !dataEl) return;
  var Q = JSON.parse(dataEl.textContent);
  var S = Q.strings || {};
  var KEY = 'questionnaire:' + Q.mode + ':' + location.pathname;
  var MAX_NOUNS = 40;
  var questions = [];
  Q.chapters.forEach(function (ch) { ch.questions.forEach(function (q) { questions.push(q); }); });

  function $(sel, el) { return (el || form).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || form).querySelectorAll(sel)); }
  function fmt(s, vals) { return String(s || '').replace(/\{(\w+)\}/g, function (m, k) { return vals[k] != null ? vals[k] : m; }); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function cap(w) { return w.charAt(0).toUpperCase() + w.slice(1); }
  var stepper = document.querySelector('.q-stepper');

  // ---- 1. Saving. Storage can be missing (private windows, blocked cookies): then nothing saves, nothing breaks.
  function load() { try { return JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function store() { try { window.localStorage.setItem(KEY, JSON.stringify(saved)); return true; } catch (e) { return false; } }
  var saved = load() || {};
  var ready = false, dirty = false, timer = null;
  var savedEls = Array.prototype.slice.call(document.querySelectorAll('.q-saved'));
  function flush() {
    clearTimeout(timer);
    if (!ready) return;
    saved.answers = collect();
    saved.step = current;
    if (store() && dirty) savedEls.forEach(function (el) { el.textContent = S.saved || 'Saved'; });
  }
  function save() { clearTimeout(timer); timer = setTimeout(flush, 250); }
  function touched() { dirty = true; save(); }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });

  // ---- 2. Text boxes grow with what's typed
  function grow(t) {
    if (!t.offsetParent) return;   // hidden (another phone screen): measured when it's shown
    t.style.height = 'auto';
    t.style.height = (t.scrollHeight + 2) + 'px';
    moreBelow();
  }
  form.addEventListener('input', function (e) { if (e.target.tagName === 'TEXTAREA') grow(e.target); });

  // Keep an element visible above the phone keyboard, or above the Back/Next bar when the keyboard is down
  function keepInView(el) {
    var vv = window.visualViewport;
    var top = vv ? vv.offsetTop : 0, height = vv ? vv.height : window.innerHeight;
    var keyboard = vv && vv.height < window.innerHeight - 100;
    var below = keyboard || !stepped() ? 16 : stepper.offsetHeight + 16;
    var over = el.getBoundingClientRect().bottom - (top + height - below);
    if (over > 0) window.scrollBy(0, over);
  }

  // ---- 3. Sliders: the guidelines' slider, hollow and unfilled until moved. On touch screens only a sideways
  //         drag moves one, so scrolling past ten sliders records nothing; a mouse can click anywhere on the line.
  function touch(r) {
    var row = r.closest('.q-slider'), v = +r.value;
    row.classList.remove('is-untouched');
    row.style.setProperty('--v', v + '%');   // the guidelines' fill and marker follow --v
    r.setAttribute('data-touched', '1');
    r.setAttribute('aria-valuetext', v + ' of 100' + (v < 50 ? ', towards ' + r.getAttribute('data-left') : v > 50 ? ', towards ' + r.getAttribute('data-right') : ', the middle'));
  }
  form.addEventListener('input', function (e) { if (e.target.classList.contains('q-range')) touch(e.target); });
  $$('.q-range__pad').forEach(function (pad) {
    var r = pad.parentNode.querySelector('.q-range');
    pad.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var id = e.pointerId, x0 = e.clientX, y0 = e.clientY, dragging = false;
      function set(x) {
        var box = pad.parentNode.getBoundingClientRect();   // the line itself: the marker's centre sits at v%
        var v = Math.round(Math.max(0, Math.min(1, (x - box.left) / box.width)) * 100);
        if (+r.value !== v || !r.hasAttribute('data-touched')) { r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); }
      }
      function begin() { dragging = true; try { pad.setPointerCapture(id); } catch (err) {} }
      function move(ev) {
        if (ev.pointerId !== id) return;
        if (!dragging) {
          var dx = Math.abs(ev.clientX - x0), dy = Math.abs(ev.clientY - y0);
          if (dy > 10 && dy >= dx) { stop(); return; }   // a scroll: the page has it
          if (dx < 8 || dx < dy) return;
          begin();
        }
        ev.preventDefault();
        set(ev.clientX);
      }
      function stop() {
        pad.removeEventListener('pointermove', move);
        pad.removeEventListener('pointerup', stop);
        pad.removeEventListener('pointercancel', stop);
        if (dragging) r.dispatchEvent(new Event('change', { bubbles: true }));
      }
      pad.addEventListener('pointermove', move);
      pad.addEventListener('pointerup', stop);
      pad.addEventListener('pointercancel', stop);
      if (e.pointerType === 'mouse') { e.preventDefault(); r.focus({ preventScroll: true }); begin(); set(e.clientX); }
    });
  });

  // ---- 4. "Something else" opens a box for the answer
  function syncOther(box) {
    var other = document.getElementById(box.getAttribute('data-other'));
    if (!other) return;
    other.hidden = !box.checked;
    grow(other);
  }
  form.addEventListener('change', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-other')) {
      syncOther(e.target);
      if (e.target.checked) { var o = document.getElementById(e.target.getAttribute('data-other')); if (o) o.focus(); }
    }
  });

  // ---- 5. Brand nouns: a list per person, with a nudge for words that can't be drawn
  var nudgeRe = (Q.nudge_words || []).length ? new RegExp('\\b(' + Q.nudge_words.map(escRe).join('|') + ')\\b', 'i') : null;
  var nounsBox = $('[data-nouns]');
  var pristine = nounsBox ? $('[data-person]', nounsBox).cloneNode(true) : null;
  function people() { return nounsBox ? $$('[data-person]', nounsBox) : []; }
  function nounsOf(p) { return $$('.q-noun', p).map(function (li) { return li.getAttribute('data-noun'); }); }
  function count(p) {
    var n = nounsOf(p).length;
    $('.q-count', p).textContent = n === 0 ? '' : n === 1 ? (S.count_one || '1 noun') : fmt(S.count || '{n} nouns', { n: n });
  }
  function note(p, text) {
    var el = $('.q-nudge', p);
    el.hidden = !text;
    el.textContent = text || '';
  }
  function addNouns(p, text, quiet) {
    var list = $('.q-nounlist', p), have = nounsOf(p).map(function (w) { return w.toLowerCase(); });
    var nudged = null, dup = null, added = 0;
    String(text).split(/[\n\r,;]+/).forEach(function (raw) {
      var w = raw.replace(/\s+/g, ' ').trim();
      if (!w) return;
      if (have.indexOf(w.toLowerCase()) >= 0) { dup = w; return; }
      if (have.length >= MAX_NOUNS) return;
      have.push(w.toLowerCase());
      var li = document.createElement('li');
      li.className = 'q-noun';
      li.setAttribute('data-noun', w);
      var span = document.createElement('span');
      span.textContent = w;
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'q-noun__remove';
      x.setAttribute('aria-label', fmt(S.remove_noun || 'Remove {noun}', { noun: w }));
      x.innerHTML = Q.cross;
      li.appendChild(span);
      li.appendChild(x);
      var m = nudgeRe && w.match(nudgeRe);
      if (m) { li.classList.add('is-nudged'); nudged = m[1]; }
      list.appendChild(li);
      added++;
    });
    count(p);
    if (!quiet) {
      note(p, nudged ? fmt(S.nudge, { word: cap(nudged) }) : dup && !added ? fmt(S.duplicate || '"{word}" is already on the list.', { word: dup }) : '');
      touched();
    }
    moreBelow();
    return added;
  }
  function commit(p, refocus) {
    var input = $('.q-add__input', p);
    if (input.value.trim()) addNouns(p, input.value);
    input.value = '';
    if (refocus) { input.focus({ preventScroll: true }); keepInView(input); }
  }
  function commitAll() { people().forEach(function (p) { if ($('.q-add__input', p).value.trim()) commit(p, false); }); }
  function addPerson(focus) {
    var n = people().length + 1, p = pristine.cloneNode(true);
    ['.q-person__name', '.q-add__input'].forEach(function (sel) {
      var input = $(sel, p), label = $('label[for="' + input.id + '"]', p);
      input.id = input.id.replace(/-\d+$/, '-' + n);
      if (label) label.htmlFor = input.id;
    });
    $('.q-person__label', p).textContent = S.extra_name || 'Name';
    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'q-link q-person__remove';
    rm.textContent = S.remove_person || 'Remove this person';
    p.appendChild(rm);
    nounsBox.insertBefore(p, $('.q-another', nounsBox));
    if (focus) { $('.q-person__name', p).focus({ preventScroll: true }); keepInView($('.q-add', p)); }
    return p;
  }
  if (nounsBox) {
    nounsBox.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      var p = t.closest('[data-person]');
      if (t.classList.contains('q-add__btn')) commit(p, true);
      else if (t.classList.contains('q-noun__remove')) {
        t.closest('.q-noun').remove();
        count(p); note(p, ''); touched();
        $('.q-add__input', p).focus({ preventScroll: true });
      } else if (t.classList.contains('q-person__remove')) {
        var name = $('.q-person__name', p).value.trim();
        if ((name || nounsOf(p).length) && !window.confirm(fmt(S.remove_confirm || 'Remove {name} and their list?', { name: name || 'this person' }))) return;
        var prev = p.previousElementSibling;
        p.remove(); touched();
        if (prev) $('.q-add__input', prev).focus({ preventScroll: true });
      } else if (t.classList.contains('q-another')) { addPerson(true); touched(); }
    });
    nounsBox.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.target.classList.contains('q-add__input')) { e.preventDefault(); commit(e.target.closest('[data-person]'), true); }
    });
    // a word typed but not added still counts: it's added when the box loses focus
    nounsBox.addEventListener('change', function (e) {
      if (e.target.classList.contains('q-add__input')) commit(e.target.closest('[data-person]'), false);
    });
    // pasting a list from notes adds every noun in it
    nounsBox.addEventListener('paste', function (e) {
      if (!e.target.classList.contains('q-add__input')) return;
      var text = (e.clipboardData || window.clipboardData).getData('text');
      if (/[\n\r,;]/.test(text)) { e.preventDefault(); addNouns(e.target.closest('[data-person]'), text); keepInView(e.target); }
    });
  }
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  // Enter in a one-line box never sends anything. On a phone it goes to the next question.
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.target.type !== 'text') return;
    e.preventDefault();
    var t = e.target;
    if (t.classList.contains('q-add__input')) return;
    if (t.classList.contains('q-person__name')) { $('.q-add__input', t.closest('[data-person]')).focus(); return; }
    if (stepped()) { t.blur(); show(current + 1, true); }
  });

  // ---- 6. Read and restore every answer
  function named(name) { return form.querySelector('[name="' + name + '"]'); }
  function collect() {
    var a = {};
    questions.forEach(function (q) {
      var id = q.id;
      if (q.type === 'long' || q.type === 'short') a[id] = (named(id) || {}).value || '';
      else if (q.type === 'chips') { var c = form.querySelector('input[name="' + id + '"]:checked'); a[id] = c ? c.value : ''; }
      else if (q.type === 'ticks') {
        a[id] = { ticked: $$('input[name="' + id + '"]:checked').map(function (b) { return b.value; }), other: (named(id + '-other') || {}).value || '' };
      } else if (q.type === 'sliders') {
        a[id] = q.pairs.map(function (p, k) { var r = named(id + '-' + k); return r && r.hasAttribute('data-touched') ? +r.value : null; });
      } else if (q.type === 'nouns') {
        a[id] = people().map(function (p) {
          return { name: $('.q-person__name', p).value.trim(), nouns: nounsOf(p), draft: $('.q-add__input', p).value };
        });
      }
    });
    return a;
  }
  function restore(a) {
    questions.forEach(function (q) {
      var id = q.id, v = a[id];
      if (v == null) return;
      if (q.type === 'long' || q.type === 'short') { if (named(id)) named(id).value = v; }
      else if (q.type === 'chips') $$('input[name="' + id + '"]').forEach(function (b) { b.checked = b.value === v; });
      else if (q.type === 'ticks') {
        if (named(id + '-other')) named(id + '-other').value = v.other || '';
        $$('input[name="' + id + '"]').forEach(function (b) { b.checked = (v.ticked || []).indexOf(b.value) >= 0; if (b.hasAttribute('data-other')) syncOther(b); });
      } else if (q.type === 'sliders') {
        (v || []).forEach(function (val, k) { var r = named(id + '-' + k); if (r && val != null) { r.value = val; touch(r); } });
      } else if (q.type === 'nouns' && nounsBox) {
        (v || []).forEach(function (person, k) {
          var p = people()[k] || addPerson(false);
          $('.q-person__name', p).value = person.name || '';
          addNouns(p, (person.nouns || []).join('\n'), true);
          $('.q-add__input', p).value = person.draft || '';
        });
      }
    });
  }

  // ---- 7. Phones: one question per screen, with Back and Next
  var steps = $$('[data-step]');
  var chapters = $$('.q-chapter');
  var backBtn = stepper.querySelector('[data-back]'), nextBtn = stepper.querySelector('[data-next]');
  var countEl = stepper.querySelector('.q-stepper__count');
  var phone = window.matchMedia('(max-width: 809.98px)');
  var current = Math.max(0, Math.min(saved.step || 0, steps.length - 1));
  var done = false;
  function stepped() { return document.body.classList.contains('is-stepped'); }
  // a soft fade above the Back/Next bar while the screen carries on below it
  function moreBelow() {
    var on = stepped() && steps[current] && steps[current].getBoundingClientRect().bottom > stepper.getBoundingClientRect().top + 4;
    document.body.classList.toggle('has-more', !!on);
  }
  function show(i, focus) {
    current = Math.max(0, Math.min(i, steps.length - 1));
    steps.forEach(function (s, k) { s.classList.toggle('is-current', k === current); });
    chapters.forEach(function (c) { c.classList.toggle('is-current', c.contains(steps[current])); });
    countEl.textContent = fmt(S.step || '{n} of {total}', { n: current + 1, total: steps.length });
    backBtn.hidden = current === 0;
    nextBtn.hidden = current === steps.length - 1;
    $$('textarea', steps[current]).forEach(grow);
    if (stepped()) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });   // a new screen starts at its top, no glide
      if (focus) steps[current].focus({ preventScroll: true });
    }
    moreBelow();
    save();
  }
  function layout() {
    var on = phone.matches && steps.length > 1 && !done;
    document.body.classList.toggle('is-stepped', on);
    if (on) show(current); else { $$('textarea').forEach(grow); moreBelow(); }
  }
  // leaving a screen adds any noun still sitting in its box, so nothing typed is lost
  backBtn.addEventListener('click', function () { commitAll(); show(current - 1, true); });
  nextBtn.addEventListener('click', function () { commitAll(); show(current + 1, true); });
  if (phone.addEventListener) phone.addEventListener('change', layout); else phone.addListener(layout);
  var resizeTimer = null;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { $$('textarea').forEach(grow); moreBelow(); }, 150); });
  window.addEventListener('scroll', moreBelow, { passive: true });
  window.addEventListener('hashchange', function () {   // menu links on a phone jump to that chapter's first question
    if (!stepped()) return;
    var el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!el) return;
    for (var k = 0; k < steps.length; k++) {
      if (el.id === 'page-header' || el.contains(steps[k])) { commitAll(); show(el.id === 'page-header' ? 0 : k, true); return; }
    }
  });

  // ---- 8. The answers as a plain text file: for Download, and the body of the Send email
  function isoDate() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function exportText() {
    commitAll();
    var a = collect();
    var when = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
    var out = [Q.heading, when, ''];
    Q.chapters.forEach(function (ch) {
      if (!ch.questions.length) return;
      out.push((ch.n < 10 ? '0' : '') + ch.n + ' ' + ch.title.toUpperCase(), '');
      ch.questions.forEach(function (q) {
        var v = a[q.id];
        if (q.type === 'sliders') {
          out.push(q.label, '(' + (S.slider_key || '0 is the left word, 100 the right word') + ')');
          q.pairs.forEach(function (p, k) { out.push(p[0] + ' to ' + p[1] + ': ' + (v[k] == null ? (S.not_set || 'not set') : v[k])); });
        } else if (q.type === 'nouns') {
          v.forEach(function (p, k) {
            if (!p.name && !p.nouns.length) return;
            out.push((p.name || 'Person ' + (k + 1)) + ' (' + p.nouns.length + '): ' + (p.nouns.join(', ') || (S.no_answer || '(no answer)')));
          });
          if (!v.some(function (p) { return p.name || p.nouns.length; })) out.push(S.no_answer || '(no answer)');
        } else if (q.type === 'ticks') {
          var t = v.ticked.map(function (x) { return x === q.other && v.other.trim() ? x + ': ' + v.other.trim() : x; });
          out.push(q.label, t.join(', ') || (S.no_answer || '(no answer)'));
        } else {
          out.push(q.label, String(v || '').trim() || (S.no_answer || '(no answer)'));
        }
        out.push('');
      });
    });
    return out.join('\n');
  }

  // ---- 9. Download and Send
  var sendBtn = $('[data-send]'), dlBtn = $('[data-download]'), statusEl = $('.q-status');
  function download() {
    var name = Q.file + '-' + isoDate() + '.txt';
    var blob = new Blob([exportText()], { type: 'text/plain;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 1500);
    statusEl.textContent = fmt(S.downloaded || 'Downloaded as {file}.', { file: name });
    flush();
  }
  function thanks() {
    done = true;
    form.hidden = true;
    document.getElementById('q-thanks').hidden = false;
    layout();
    window.scrollTo(0, 0);
  }
  var sending = false;
  function send() {
    if (!Q.send || sending) return;
    sending = true;
    sendBtn.disabled = true;
    statusEl.textContent = S.sending || 'Sending...';
    var body = {}, extra = Q.send.fields || {};
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k];
    body.message = exportText();
    var who = people().map(function (p) { return $('.q-person__name', p).value.trim(); }).filter(Boolean)[0];
    body[Q.send.subject_field || 'subject'] = Q.subject + (who ? ' from ' + who : '');
    fetch(Q.send.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {   // a service can answer 200 and still refuse, so read what it says
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || j.success === false || j.ok === false) throw new Error('not sent');
        });
      })
      .then(function () { saved.sent = new Date().toISOString(); flush(); statusEl.textContent = ''; thanks(); })
      .catch(function () { statusEl.textContent = S.failed || ''; })
      .then(function () { sending = false; sendBtn.disabled = false; });
  }
  if (dlBtn) dlBtn.addEventListener('click', download);
  if (sendBtn) sendBtn.addEventListener('click', send);

  // ---- Start: put back what was saved, then lay the page out
  if (saved.answers) restore(saved.answers);
  if (saved.sent && sendBtn) statusEl.textContent = S.sent_before || '';
  ready = true;
  form.addEventListener('input', touched);
  form.addEventListener('change', touched);
  layout();
})();
