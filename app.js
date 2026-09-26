/* ============================================================
   BMIBrief — client-side logic
   Everything runs locally; Pro preview data lives only in
   localStorage and is erased with overwrite-then-remove.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ------------------------------------------------ state */
  var LS_KEY = 'bmibrief.state.v1';

  function blank() {
    return { version: 1, proPreview: false, activeProfileId: null, profiles: [] };
  }

  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return blank();
      var s = JSON.parse(raw);
      if (!s || s.version !== 1 || !Array.isArray(s.profiles)) return blank();
      return s;
    } catch (e) { return blank(); }
  }

  var state = load();

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked: app keeps working in memory */ }
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  /* Secure deletion primitive: overwrite stored bytes with random
     data before any remove/rewrite, so nothing recoverable remains. */
  function randomFill(len) {
    var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var out = '', chunk = 1024, pool, i;
    try {
      pool = new Uint32Array(chunk);
      while (out.length < len) {
        crypto.getRandomValues(pool);
        for (i = 0; i < chunk && out.length < len; i++) out += chars[pool[i] % chars.length];
      }
    } catch (e) {
      while (out.length < len) out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function secureRewrite(mutator) {
    try {
      var cur = localStorage.getItem(LS_KEY);
      if (cur !== null) localStorage.setItem(LS_KEY, randomFill(cur.length));
    } catch (e) { /* continue with best-effort erase */ }
    mutator();
    save();
  }

  function activeProfile() {
    for (var i = 0; i < state.profiles.length; i++) {
      if (state.profiles[i].id === state.activeProfileId) return state.profiles[i];
    }
    return null;
  }

  function ensureProfile() {
    var p = activeProfile();
    if (!p) {
      p = { id: uid(), name: 'Profile 1', createdAt: Date.now(), readings: [], reminder: { days: 0, nextDue: null } };
      state.profiles.push(p);
      state.activeProfileId = p.id;
      save();
    }
    return p;
  }

  /* ------------------------------------------------ BMI maths */
  function categorize(bmi) {
    if (bmi < 18.5) return 'Underweight';
    if (bmi < 25) return 'Healthy weight';
    if (bmi < 30) return 'Overweight';
    if (bmi < 35) return 'Obesity, class I';
    if (bmi < 40) return 'Obesity, class II';
    return 'Obesity, class III';
  }

  var SCALE_MIN = 14, SCALE_MAX = 42;
  function markerPct(bmi) {
    var p = (bmi - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 100;
    return Math.max(0, Math.min(100, p));
  }

  /* ------------------------------------------------ elements */
  var form = $('#calc-form');
  var metricBlock = $('#metric-fields');
  var imperialBlock = $('#imperial-fields');
  var hCm = $('#h-cm'), wKg = $('#w-kg');
  var hFt = $('#h-ft'), hIn = $('#h-in'), wLb = $('#w-lb');
  var ageEl = $('#age');
  var errorsBox = $('#form-errors');

  var rBmi = $('#r-bmi'), rCat = $('#r-cat'), rMarker = $('#r-marker'), rExtra = $('#r-extra');
  var saveRow = $('#save-row'), saveBtn = $('#save-btn');
  var childPanel = $('#child-panel'), childBack = $('#child-back');

  var proBadge = $('#pro-badge'), proToggle = $('#pro-toggle'), toolkitFields = $('#toolkit-fields');
  var profileSelect = $('#profile-select'), profileName = $('#profile-name');
  var reminderSelect = $('#reminder-select'), reminderNext = $('#reminder-next');
  var reminderBanner = $('#reminder-banner');
  var trendSvg = $('#trend-svg'), chartEmpty = $('#chart-empty');
  var historyBody = $('#history-body'), historyEmpty = $('#history-empty');

  var lastCalc = null; // {bmi, cat, hText, wText}

  /* ------------------------------------------------ units */
  function currentMode() {
    return $('#u-imperial').checked ? 'imperial' : 'metric';
  }

  function setDisabledIn(block, disabled) {
    var inputs = block.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) inputs[i].disabled = disabled;
  }

  function applyMode(mode, convert) {
    var toImperial = mode === 'imperial';
    metricBlock.hidden = toImperial;
    imperialBlock.hidden = !toImperial;
    setDisabledIn(metricBlock, toImperial);
    setDisabledIn(imperialBlock, !toImperial);

    if (convert) {
      if (toImperial) {
        var cm = parseFloat(hCm.value);
        if (isFinite(cm) && cm > 0) {
          var totalIn = cm / 2.54;
          hFt.value = Math.floor(totalIn / 12);
          hIn.value = (Math.round((totalIn % 12) * 2) / 2).toString();
        }
        var kg = parseFloat(wKg.value);
        if (isFinite(kg) && kg > 0) wLb.value = (kg * 2.20462).toFixed(1);
      } else {
        var ft = parseFloat(hFt.value) || 0, inch = parseFloat(hIn.value) || 0;
        if (ft > 0 || inch > 0) hCm.value = Math.round((ft * 12 + inch) * 2.54 * 10) / 10;
        var lb = parseFloat(wLb.value);
        if (isFinite(lb) && lb > 0) wKg.value = (lb / 2.20462).toFixed(1);
      }
    }
  }

  $('#u-metric').addEventListener('change', function () { applyMode('metric', true); });
  $('#u-imperial').addEventListener('change', function () { applyMode('imperial', true); });

  /* ------------------------------------------------ validation + calc */
  function showErrors(errs) {
    errorsBox.innerHTML = '';
    var strong = document.createElement('strong');
    strong.textContent = errs.length > 1 ? 'Please fix the following:' : 'Please check this detail:';
    errorsBox.appendChild(strong);
    var ul = document.createElement('ul');
    errs.forEach(function (msg) {
      var li = document.createElement('li');
      li.textContent = msg;
      ul.appendChild(li);
    });
    errorsBox.appendChild(ul);
    errorsBox.hidden = false;
    errorsBox.focus();
  }

  function clearErrors() { errorsBox.hidden = true; errorsBox.innerHTML = ''; }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();
    childPanel.hidden = true;
    rExtra.hidden = true;

    var mode = currentMode();
    var errs = [], bmi, hText, wText, kg, cm;

    if (mode === 'metric') {
      cm = parseFloat(hCm.value);
      kg = parseFloat(wKg.value);
      if (!isFinite(cm)) errs.push('Height: enter your height in centimetres.');
      else if (cm < 90 || cm > 272) errs.push('Height: enter a value between 90 and 272 cm.');
      if (!isFinite(kg)) errs.push('Weight: enter your weight in kilograms.');
      else if (kg < 25 || kg > 450) errs.push('Weight: enter a value between 25 and 450 kg.');
      hText = cm + ' cm';
      wText = kg + ' kg';
    } else {
      var ft = parseFloat(hFt.value), inch = parseFloat(hIn.value);
      if (!isFinite(inch)) inch = 0;
      if (!isFinite(ft) || ft < 3 || ft > 8) errs.push('Height: enter feet between 3 and 8.');
      else if (inch < 0 || inch >= 12) errs.push('Height: inches should be between 0 and 11.5.');
      var totalInCheck = (isFinite(ft) ? ft : 0) * 12 + inch;
      if (isFinite(ft) && (totalInCheck < 36 || totalInCheck > 107)) errs.push('Height: enter a value between 3\u20320\u2033 and 8\u203211\u2033.');
      var lb = parseFloat(wLb.value);
      if (!isFinite(lb)) errs.push('Weight: enter your weight in pounds.');
      else if (lb < 55 || lb > 1000) errs.push('Weight: enter a value between 55 and 1000 lb.');
      cm = totalInCheck * 2.54;
      kg = lb / 2.20462;
      hText = (isFinite(ft) ? ft : 0) + ' ft ' + (Math.round(inch * 10) / 10) + ' in';
      wText = lb + ' lb';
    }

    var age = ageEl.value.trim() === '' ? null : parseInt(ageEl.value, 10);
    if (age !== null && (!isFinite(age) || age < 0 || age > 120)) {
      errs.push('Age: enter a value between 0 and 120, or leave it blank.');
    }

    if (errs.length) { showErrors(errs); return; }

    // Adults only by default: route under-18s to professional guidance.
    if (age !== null && age < 18) {
      rBmi.textContent = '—';
      rCat.textContent = 'Adult categories not applied (under 18)';
      rMarker.hidden = true;
      saveRow.hidden = true;
      lastCalc = null;
      showChildPanel();
      return;
    }

    bmi = kg / Math.pow(cm / 100, 2);
    var bmiR = Math.round(bmi * 10) / 10;
    var cat = categorize(bmiR);

    rBmi.textContent = bmiR.toFixed(1);
    rCat.textContent = cat;
    rMarker.hidden = false;
    rMarker.style.left = markerPct(bmiR) + '%';

    var extra = [];
    extra.push('BMI ' + bmiR.toFixed(1) + ' kg/m\u00B2 \u00B7 ' + hText + ' \u00B7 ' + wText + '. Reference range: 18.5\u201324.9.');
    if (age !== null && age >= 65) {
      extra.push('For adults over 65 these cut-offs may be less informative \u2014 a clinician can help interpret the result.');
    }
    rExtra.textContent = extra.join(' ');
    rExtra.hidden = false;

    lastCalc = { bmi: bmiR, cat: cat, hText: hText, wText: wText };
    saveRow.hidden = !state.proPreview;
  });

  $('#reset-btn').addEventListener('click', function () {
    form.reset();
    applyMode('metric', false);
    clearErrors();
    childPanel.hidden = true;
    rBmi.textContent = '—';
    rCat.textContent = 'Enter your details';
    rMarker.hidden = true;
    rExtra.hidden = true;
    saveRow.hidden = true;
    lastCalc = null;
    hCm.focus();
  });

  /* ------------------------------------------------ child routing */
  function showChildPanel() {
    childPanel.hidden = false;
    childPanel.focus();
    childPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  childBack.addEventListener('click', function () {
    childPanel.hidden = true;
    ageEl.value = '';
    ageEl.focus();
  });
  /* ------------------------------------------------ Pro preview */
  function renderPro() {
    document.body.classList.toggle('pro-on', state.proPreview);
    proBadge.hidden = !state.proPreview;
    proToggle.checked = state.proPreview;
    toolkitFields.disabled = !state.proPreview;
    if (state.proPreview) ensureProfile();
    renderProfiles();
    renderHistory();
    renderChart();
    renderReminder();
    if (!state.proPreview) saveRow.hidden = true;
    else if (lastCalc) saveRow.hidden = false;
  }

  proToggle.addEventListener('change', function () {
    state.proPreview = proToggle.checked;
    save();
    renderPro();
  });

  /* ------------------------------------------------ profiles */
  function renderProfiles() {
    profileSelect.innerHTML = '';
    state.profiles.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      profileSelect.appendChild(opt);
    });
    if (state.activeProfileId) profileSelect.value = state.activeProfileId;
    var empty = state.profiles.length === 0;
    if (empty) {
      var opt = document.createElement('option');
      opt.textContent = 'No profiles yet';
      profileSelect.appendChild(opt);
    }
  }

  profileSelect.addEventListener('change', function () {
    state.activeProfileId = profileSelect.value;
    save();
    renderHistory(); renderChart(); renderReminder();
  });

  $('#profile-add').addEventListener('click', function () {
    var name = profileName.value.trim() || ('Profile ' + (state.profiles.length + 1));
    var p = { id: uid(), name: name, createdAt: Date.now(), readings: [], reminder: { days: 0, nextDue: null } };
    state.profiles.push(p);
    state.activeProfileId = p.id;
    profileName.value = '';
    save();
    renderProfiles(); renderHistory(); renderChart(); renderReminder();
  });

  $('#profile-rename').addEventListener('click', function () {
    var p = activeProfile();
    if (!p) return;
    var name = window.prompt('Rename profile', p.name);
    if (name && name.trim()) {
      p.name = name.trim().slice(0, 40);
      save();
      renderProfiles();
    }
  });

  $('#profile-delete').addEventListener('click', function () {
    var p = activeProfile();
    if (!p) return;
    if (!window.confirm('Securely erase "' + p.name + '" and all its readings from this browser? This cannot be undone.')) return;
    secureRewrite(function () {
      state.profiles = state.profiles.filter(function (x) { return x.id !== p.id; });
      state.activeProfileId = state.profiles.length ? state.profiles[0].id : null;
    });
    renderProfiles(); renderHistory(); renderChart(); renderReminder();
  });

  /* ------------------------------------------------ readings */
  saveBtn.addEventListener('click', function () {
    if (!lastCalc || !state.proPreview) return;
    var p = ensureProfile();
    p.readings.push({
      ts: Date.now(),
      bmi: lastCalc.bmi,
      cat: lastCalc.cat,
      h: lastCalc.hText,
      w: lastCalc.wText
    });
    save();
    renderHistory(); renderChart(); renderReminder();
    saveBtn.textContent = 'Saved ✓';
    setTimeout(function () {
      saveBtn.innerHTML = 'Save to profile <span class="pro-pill">Pro</span>';
    }, 1600);
  });

  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function renderHistory() {
    var p = activeProfile();
    historyBody.innerHTML = '';
    var readings = p ? p.readings.slice().sort(function (a, b) { return b.ts - a.ts; }) : [];
    historyEmpty.hidden = readings.length > 0;
    readings.forEach(function (r) {
      var tr = document.createElement('tr');
      [fmtDate(r.ts), r.bmi.toFixed(1), r.cat, r.h, r.w].forEach(function (val) {
        var td = document.createElement('td');
        td.textContent = val;
        tr.appendChild(td);
      });
      var td = document.createElement('td');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'row-del';
      btn.textContent = 'Erase';
      btn.setAttribute('aria-label', 'Securely erase reading from ' + fmtDate(r.ts));
      btn.addEventListener('click', function () {
        secureRewrite(function () {
          p.readings = p.readings.filter(function (x) { return x.ts !== r.ts; });
        });
        renderHistory(); renderChart();
      });
      td.appendChild(btn);
      tr.appendChild(td);
      historyBody.appendChild(tr);
    });
  }

  $('#history-clear').addEventListener('click', function () {
    var p = activeProfile();
    if (!p || !p.readings.length) return;
    if (!window.confirm('Securely erase every saved reading for "' + p.name + '"? This cannot be undone.')) return;
    secureRewrite(function () { p.readings = []; });
    renderHistory(); renderChart();
  });

  /* ------------------------------------------------ chart */
  function renderChart() {
    var p = activeProfile();
    var readings = p ? p.readings.slice().sort(function (a, b) { return a.ts - b.ts; }) : [];
    chartEmpty.hidden = readings.length > 0;
    trendSvg.innerHTML = '';
    if (!readings.length) return;

    var NS = 'http://www.w3.org/2000/svg';
    var W = 640, H = 250, L = 46, R = 16, T = 18, B = 34;
    function el(tag, attrs) {
      var n = document.createElementNS(NS, tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    }

    var bmis = readings.map(function (r) { return r.bmi; });
    var yMin = Math.max(8, Math.floor(Math.min(Math.min.apply(null, bmis), 15)) - 1);
    var yMax = Math.ceil(Math.max(Math.max.apply(null, bmis), 30)) + 1;

    var x0 = L, x1 = W - R, y0 = H - B, y1 = T;
    var t0 = readings[0].ts, t1 = readings[readings.length - 1].ts;

    function X(ts) {
      if (t1 === t0) return (x0 + x1) / 2;
      return x0 + (ts - t0) / (t1 - t0) * (x1 - x0);
    }
    function Y(bmi) {
      return y0 - (bmi - yMin) / (yMax - yMin) * (y0 - y1);
    }

    // reference band 18.5–25 (neutral light blue — context, not judgment)
    var bandTop = Math.max(Y(25), y1), bandBot = Math.min(Y(18.5), y0);
    trendSvg.appendChild(el('rect', { x: x0, y: bandTop, width: x1 - x0, height: bandBot - bandTop, fill: '#dbe6f7' }));
    var bandLabel = el('text', { x: x0 + 6, y: bandTop + 14, 'font-size': '10', fill: '#4c5261' });
    bandLabel.textContent = 'WHO reference 18.5–25';
    trendSvg.appendChild(bandLabel);

    // axes
    trendSvg.appendChild(el('line', { x1: x0, y1: y1, x2: x0, y2: y0, stroke: '#b9c2d4' }));
    trendSvg.appendChild(el('line', { x1: x0, y1: y0, x2: x1, y2: y0, stroke: '#b9c2d4' }));
    [yMin, yMax].forEach(function (v) {
      var t = el('text', { x: x0 - 6, y: Y(v) + 4, 'font-size': '10', fill: '#4c5261', 'text-anchor': 'end' });
      t.textContent = v;
      trendSvg.appendChild(t);
    });
    var d0 = el('text', { x: x0, y: H - 12, 'font-size': '10', fill: '#4c5261' });
    d0.textContent = fmtDate(t0);
    trendSvg.appendChild(d0);
    var d1 = el('text', { x: x1, y: H - 12, 'font-size': '10', fill: '#4c5261', 'text-anchor': 'end' });
    d1.textContent = fmtDate(t1);
    trendSvg.appendChild(d1);

    // line + points
    var pts = readings.map(function (r) { return X(r.ts) + ',' + Y(r.bmi); }).join(' ');
    trendSvg.appendChild(el('polyline', { points: pts, fill: 'none', stroke: '#274b8f', 'stroke-width': '2' }));
    readings.forEach(function (r, i) {
      var c = el('circle', {
        cx: X(r.ts), cy: Y(r.bmi), r: i === readings.length - 1 ? 5 : 3.5,
        fill: '#274b8f', stroke: '#fff', 'stroke-width': '1.5'
      });
      var title = el('title', {});
      title.textContent = fmtDate(r.ts) + ': BMI ' + r.bmi.toFixed(1) + ' (' + r.cat + ')';
      c.appendChild(title);
      trendSvg.appendChild(c);
    });
  }

  /* ------------------------------------------------ reminders */
  var DAY = 86400000;

  function renderReminder() {
    var p = activeProfile();
    var rem = p && p.reminder ? p.reminder : { days: 0, nextDue: null };
    reminderSelect.value = String(rem.days || 0);
    if (!rem.days) {
      reminderNext.textContent = 'No reminder set.';
      reminderBanner.hidden = true;
    } else {
      var dueTxt = rem.nextDue ? fmtDate(rem.nextDue) : 'after your next saved reading';
      reminderNext.textContent = 'Next check-in: ' + dueTxt + '.';
      var due = rem.nextDue && Date.now() >= rem.nextDue;
      reminderBanner.hidden = !due;
    }
  }

  reminderSelect.addEventListener('change', function () {
    var p = ensureProfile();
    var days = parseInt(reminderSelect.value, 10) || 0;
    p.reminder = { days: days, nextDue: days ? Date.now() + days * DAY : null };
    save();
    renderReminder();
  });

  $('#reminder-reschedule').addEventListener('click', function () {
    var p = activeProfile();
    if (!p || !p.reminder) return;
    p.reminder.nextDue = Date.now() + p.reminder.days * DAY;
    save();
    renderReminder();
  });

  /* ------------------------------------------------ print */
  $('#print-btn').addEventListener('click', function () {
    var p = activeProfile();
    var readings = p ? p.readings.slice().sort(function (a, b) { return b.ts - a.ts; }) : [];
    $('#ps-profile').textContent = 'Profile: ' + (p ? p.name : '—');
    $('#ps-date').textContent = 'Printed: ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    $('#ps-latest').textContent = readings.length
      ? 'Latest result: BMI ' + readings[0].bmi.toFixed(1) + ' kg/m² — ' + readings[0].cat + ' (' + fmtDate(readings[0].ts) + '). ' + readings.length + ' saved reading' + (readings.length > 1 ? 's' : '') + '.'
      : 'No saved readings yet.';
    var tbody = $('#ps-body');
    tbody.innerHTML = '';
    readings.slice(0, 12).forEach(function (r) {
      var tr = document.createElement('tr');
      [fmtDate(r.ts), r.bmi.toFixed(1), r.cat].forEach(function (v) {
        var td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    window.print();
  });

  /* ------------------------------------------------ secure delete all */
  $('#delete-all').addEventListener('click', function () {
    if (!window.confirm('Securely delete ALL BMIBrief data from this browser — every profile, reading, and setting? This cannot be undone.')) return;
    try {
      var cur = localStorage.getItem(LS_KEY);
      if (cur !== null) {
        localStorage.setItem(LS_KEY, randomFill(cur.length)); // overwrite
        localStorage.removeItem(LS_KEY);                      // erase
      }
    } catch (e) { /* best effort */ }
    state = blank();
    renderPro();
    $('#delete-all-status').textContent = 'All local data was overwritten and erased.';
    setTimeout(function () { $('#delete-all-status').textContent = ''; }, 5000);
  });

  /* ------------------------------------------------ init */
  applyMode('metric', false);
  renderPro();
})();
