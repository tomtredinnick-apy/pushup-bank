(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------
  const STORAGE_PREFIX = 'pushupbank:';
  const PROFILES_KEY = STORAGE_PREFIX + 'profiles';
  const CURRENT_KEY = STORAGE_PREFIX + 'current';

  const RAMP_DEFAULT = 0.06;
  const RAMP_SOFT_MAX = 0.10;   // ceiling the auto-nudge will push toward
  const RAMP_HARD_CAP = 0.15;   // absolute week-over-week jump cap
  const RAMP_NUDGE = 0.01;
  const BANK_CAP_DAYS = 3;
  const MISS_STREAK_FOR_RECAL = 3;
  const SURPLUS_RATIO_FOR_NUDGE = 0.4;
  const SURPLUS_WEEKS_FOR_NUDGE = 2;
  const CIRCLE = 2 * Math.PI * 96;

  // ---------------------------------------------------------------------
  // Date helpers (local-time date strings, YYYY-MM-DD)
  // ---------------------------------------------------------------------
  function todayStr() {
    return dateToStr(new Date());
  }
  function dateToStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function strToDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(s, n) {
    const d = strToDate(s);
    d.setDate(d.getDate() + n);
    return dateToStr(d);
  }
  function daysBetween(a, b) {
    return Math.round((strToDate(b) - strToDate(a)) / 86400000);
  }
  function dayOfWeek(s) {
    return strToDate(s).getDay();
  }
  function formatDateShort(s) {
    return strToDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function formatDateLong(s) {
    return strToDate(s).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ---------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------
  function loadProfilesIndex() {
    try {
      return JSON.parse(localStorage.getItem(PROFILES_KEY)) || [];
    } catch (e) {
      return [];
    }
  }
  function saveProfilesIndex(list) {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
  }
  function profileDataKey(id) {
    return STORAGE_PREFIX + 'data:' + id;
  }
  function loadProfile(id) {
    try {
      return JSON.parse(localStorage.getItem(profileDataKey(id)));
    } catch (e) {
      return null;
    }
  }
  function saveProfile(profile) {
    localStorage.setItem(profileDataKey(profile.id), JSON.stringify(profile));
  }
  function deleteProfileData(id) {
    localStorage.removeItem(profileDataKey(id));
  }
  function getCurrentId() {
    return localStorage.getItem(CURRENT_KEY);
  }
  function setCurrentId(id) {
    localStorage.setItem(CURRENT_KEY, id);
  }

  function simpleHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h) + str.charCodeAt(i);
      h = h & h;
    }
    return String(h);
  }
  function makeId() {
    return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------------------------------------------------------------------
  // Baseline / target computation
  // ---------------------------------------------------------------------
  function computeBaseline(method, rawValue) {
    const value = Math.max(1, Math.round(rawValue));
    let perSet;
    if (method === 'sixtySec') {
      perSet = Math.max(3, Math.round(value * 0.35));
    } else {
      perSet = Math.max(3, Math.round(value * 0.6));
    }
    let numSets;
    if (perSet < 6) numSets = 3;
    else if (perSet < 12) numSets = 4;
    else numSets = 5;
    const dayTarget = perSet * numSets;
    return { perSet, numSets, dayTarget };
  }

  // ---------------------------------------------------------------------
  // Profile creation
  // ---------------------------------------------------------------------
  function createProfile(name, pin, method, value) {
    const baseline = computeBaseline(method, value);
    const start = todayStr();
    const profile = {
      id: makeId(),
      name: name,
      pinHash: pin ? simpleHash(pin) : null,
      createdAt: start,
      baseline: { method, value: Math.round(value), ...baseline },
      restDayIndex: 0, // Sunday
      rampRate: RAMP_DEFAULT,
      currentTarget: baseline.dayTarget,
      weekStartDate: start,
      weekStartTarget: baseline.dayTarget,
      lastFullyEarnedTarget: baseline.dayTarget,
      consecutiveMisses: 0,
      consecutiveSurplusWeeks: 0,
      bank: 0,
      lifetime: { totalReps: 0, currentStreak: 0, longestStreak: 0, daysActive: 0 },
      days: {},
      lastProcessedDate: null,
    };
    ensureDayEntry(profile, start);
    saveProfile(profile);
    const idx = loadProfilesIndex();
    idx.push({ id: profile.id, name: profile.name });
    saveProfilesIndex(idx);
    return profile;
  }

  // ---------------------------------------------------------------------
  // Bank
  // ---------------------------------------------------------------------
  function bankCap(profile) {
    return Math.max(1, profile.currentTarget) * BANK_CAP_DAYS;
  }

  function ensureDayEntry(profile, dateStr) {
    if (profile.days[dateStr]) return profile.days[dateStr];
    const isRestDay = dayOfWeek(dateStr) === profile.restDayIndex;
    const baseTarget = isRestDay ? 0 : profile.currentTarget;
    const bankApplied = isRestDay ? 0 : Math.min(profile.bank, baseTarget);
    profile.bank -= bankApplied;
    const effectiveTarget = baseTarget - bankApplied;
    const entry = {
      date: dateStr,
      target: baseTarget,
      bankApplied,
      effectiveTarget,
      sets: [],
      totalLogged: 0,
      isRestDay,
      met: false,
      finalized: false,
    };
    profile.days[dateStr] = entry;
    return entry;
  }

  function finalizeDay(profile, dateStr) {
    const day = profile.days[dateStr];
    if (!day || day.finalized) return;

    const surplus = day.totalLogged - day.effectiveTarget;
    if (surplus > 0) {
      profile.bank = Math.min(bankCap(profile), profile.bank + surplus);
    }

    const met = day.isRestDay || day.totalLogged >= day.effectiveTarget;
    day.met = met;
    day.finalized = true;

    if (day.isRestDay) {
      // streak untouched on rest days
    } else if (met) {
      profile.lifetime.currentStreak += 1;
      profile.lifetime.longestStreak = Math.max(profile.lifetime.longestStreak, profile.lifetime.currentStreak);
    } else {
      profile.lifetime.currentStreak = 0;
    }

    if (!day.isRestDay && day.totalLogged >= day.target) {
      profile.lastFullyEarnedTarget = day.target;
    }

    const fullyBanked = day.target > 0 && day.bankApplied >= day.target;
    if (day.isRestDay || fullyBanked) {
      // neutral: doesn't build or break the non-banked-miss streak
    } else if (!met) {
      profile.consecutiveMisses += 1;
    } else {
      profile.consecutiveMisses = 0;
    }

    profile.lifetime.totalReps += day.totalLogged;
    if (day.totalLogged > 0) profile.lifetime.daysActive += 1;

    if (profile.consecutiveMisses >= MISS_STREAK_FOR_RECAL) {
      profile.currentTarget = profile.lastFullyEarnedTarget;
      profile.weekStartTarget = profile.lastFullyEarnedTarget;
      profile.weekStartDate = addDays(dateStr, 1);
      profile.consecutiveMisses = 0;
      profile.recalibratedAt = dateStr;
    }
  }

  function weeklyRollup(profile, newWeekStartDate) {
    const weekDates = [];
    for (let d = profile.weekStartDate; daysBetween(d, newWeekStartDate) > 0; d = addDays(d, 1)) {
      weekDates.push(d);
    }
    const activeDays = weekDates.map(d => profile.days[d]).filter(d => d && !d.isRestDay && d.target > 0);

    let qualifies = false;
    if (activeDays.length >= 3) {
      const avgRatio = activeDays.reduce((sum, d) => sum + (d.totalLogged - d.target) / d.target, 0) / activeDays.length;
      qualifies = avgRatio >= SURPLUS_RATIO_FOR_NUDGE;
    }
    profile.consecutiveSurplusWeeks = qualifies ? (profile.consecutiveSurplusWeeks || 0) + 1 : 0;

    let rampRate = profile.rampRate;
    if (profile.consecutiveSurplusWeeks >= SURPLUS_WEEKS_FOR_NUDGE) {
      rampRate = Math.min(RAMP_SOFT_MAX, rampRate + RAMP_NUDGE);
      profile.consecutiveSurplusWeeks = 0;
    }
    profile.rampRate = rampRate;

    const base = profile.weekStartTarget;
    let newTarget = Math.round(base * (1 + rampRate));
    const maxJump = Math.round(base * (1 + RAMP_HARD_CAP));
    if (newTarget > maxJump) newTarget = maxJump;

    profile.currentTarget = newTarget;
    profile.weekStartTarget = newTarget;
    profile.weekStartDate = newWeekStartDate;
  }

  function processRollover(profile) {
    const today = todayStr();
    if (!profile.lastProcessedDate) {
      ensureDayEntry(profile, today);
      profile.lastProcessedDate = addDays(today, -1);
      return;
    }
    let cursor = addDays(profile.lastProcessedDate, 1);
    let guard = 0;
    while (daysBetween(cursor, today) >= 0 && guard < 3650) {
      guard++;
      if (daysBetween(profile.weekStartDate, cursor) >= 7) {
        weeklyRollup(profile, cursor);
      }
      ensureDayEntry(profile, cursor);
      if (cursor !== today) {
        finalizeDay(profile, cursor);
        profile.lastProcessedDate = cursor;
      }
      cursor = addDays(cursor, 1);
    }
  }

  // ---------------------------------------------------------------------
  // App state
  // ---------------------------------------------------------------------
  let profile = null;
  let obDraft = { method: 'oneSet' };
  let onboardingMode = 'new'; // 'new' | 'redoBaseline'

  function refreshAndSave() {
    processRollover(profile);
    saveProfile(profile);
  }

  // ---------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    show(t);
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => hide(t), 2200);
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function renderAll() {
    renderTopbar();
    renderHome();
    renderHistory();
    renderSettings();
  }

  function renderTopbar() {
    $('topbar-name').textContent = profile.name;
    $('streak-chip').textContent = `🔥 ${profile.lifetime.currentStreak}`;
  }

  function renderHome() {
    const today = profile.days[todayStr()];
    const logged = today.totalLogged;
    const effTarget = today.effectiveTarget;
    const ringFg = $('ring-fg');

    const ratio = effTarget > 0 ? Math.min(1, logged / effTarget) : 1;
    const offset = CIRCLE * (1 - ratio);
    ringFg.style.strokeDashoffset = String(offset);
    ringFg.classList.toggle('complete', logged >= effTarget);

    $('ring-logged').textContent = logged;
    if (today.isRestDay) {
      $('ring-target').textContent = 'rest day';
      $('ring-label').textContent = 'no target today';
    } else {
      $('ring-target').textContent = `of ${effTarget}`;
      $('ring-label').textContent = 'today';
    }

    const cap = bankCap(profile);
    $('bank-amount').textContent = profile.bank;
    const coverDays = profile.currentTarget > 0 ? Math.floor(profile.bank / profile.currentTarget) : 0;
    $('bank-covers').textContent = coverDays > 0
      ? ` — covers ${coverDays} more ${coverDays === 1 ? 'day' : 'days'} off`
      : ` (cap ${cap})`;

    let breakdown = '';
    if (today.isRestDay) {
      breakdown = 'Sundays are automatic rest days — log if you feel like it, no pressure.';
    } else if (today.bankApplied > 0) {
      breakdown = `Target ${today.target} · ${today.bankApplied} covered by bank · ${Math.max(0, today.effectiveTarget - logged)} to go`;
    } else {
      breakdown = `Target ${today.target} · ${Math.max(0, today.effectiveTarget - logged)} to go`;
    }
    if (logged > today.effectiveTarget) {
      breakdown += ` · +${logged - today.effectiveTarget} will bank`;
    }
    $('target-breakdown').textContent = breakdown;

    const list = $('sets-list');
    list.innerHTML = '';
    if (today.sets.length === 0) {
      list.innerHTML = '<div class="empty-note">No sets logged yet today</div>';
    } else {
      today.sets.forEach((s, i) => {
        const row = document.createElement('div');
        row.className = 'set-row';
        const time = new Date(s.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        row.innerHTML = `<span>${s.reps} reps</span><span class="set-time">${time}</span><button class="set-del" data-idx="${i}">remove</button>`;
        list.appendChild(row);
      });
    }
  }

  function renderHistory() {
    $('stat-lifetime').textContent = profile.lifetime.totalReps;
    $('stat-current-streak').textContent = profile.lifetime.currentStreak;
    $('stat-longest-streak').textContent = profile.lifetime.longestStreak;
    $('stat-days-active').textContent = profile.lifetime.daysActive;

    const heatmap = $('heatmap');
    heatmap.innerHTML = '';
    const today = todayStr();
    const weeks = 12;
    const totalDays = weeks * 7;
    // align end of grid to the end of this week (Saturday)
    const endDow = dayOfWeek(today);
    const gridEnd = addDays(today, 6 - endDow);
    const gridStart = addDays(gridEnd, -(totalDays - 1));

    for (let i = 0; i < totalDays; i++) {
      const d = addDays(gridStart, i);
      const cell = document.createElement('div');
      cell.className = 'hm-cell';
      cell.dataset.date = d;
      if (daysBetween(d, today) < 0) {
        cell.classList.add('future');
      } else {
        const entry = profile.days[d];
        if (entry) {
          if (entry.isRestDay && entry.totalLogged === 0) {
            cell.classList.add('rest');
          } else if (entry.finalized || d === today) {
            const ratio = entry.effectiveTarget > 0 ? entry.totalLogged / entry.effectiveTarget : (entry.totalLogged > 0 ? 1 : 0);
            cell.style.background = colorForRatio(ratio, entry.isRestDay);
          }
          cell.title = `${d}: ${entry.totalLogged} reps`;
          cell.addEventListener('click', () => showDayDetail(d));
        }
      }
      heatmap.appendChild(cell);
    }
  }

  function colorForRatio(ratio, isRestDay) {
    if (isRestDay && ratio === 0) return '';
    if (ratio <= 0) return 'var(--ring-track)';
    if (ratio < 0.5) return '#7c4a12';
    if (ratio < 1) return '#c2760f';
    if (ratio < 1.5) return '#34d399';
    return '#059669';
  }

  function showDayDetail(dateStr) {
    const entry = profile.days[dateStr];
    const box = $('day-detail');
    if (!entry) { hide(box); return; }
    show(box);
    box.innerHTML = `
      <div class="dd-title">${formatDateLong(dateStr)}</div>
      <div class="dd-row"><span>Logged</span><span>${entry.totalLogged}</span></div>
      <div class="dd-row"><span>Target</span><span>${entry.isRestDay ? 'Rest day' : entry.target}</span></div>
      <div class="dd-row"><span>Covered by bank</span><span>${entry.bankApplied}</span></div>
      <div class="dd-row"><span>Sets</span><span>${entry.sets.length}</span></div>
      <div class="dd-row"><span>Result</span><span>${entry.isRestDay ? '—' : (entry.met ? 'Hit target' : 'Missed')}</span></div>
    `;
  }

  function renderSettings() {
    $('set-name').textContent = profile.name;
    $('set-since').textContent = formatDateShort(profile.createdAt);
    $('set-target').textContent = profile.currentTarget;
    $('set-ramp').textContent = Math.round(profile.rampRate * 1000) / 10 + '%';
    $('set-restday').value = String(profile.restDayIndex);
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  function logReps(reps) {
    reps = Math.max(1, Math.round(reps));
    const today = profile.days[todayStr()];
    today.sets.push({ ts: Date.now(), reps });
    today.totalLogged += reps;
    saveProfile(profile);
    renderHome();
    renderHistory();
    renderTopbar();
    toast(`+${reps} logged`);
  }

  function removeSet(idx) {
    const today = profile.days[todayStr()];
    today.sets.splice(idx, 1);
    today.totalLogged = today.sets.reduce((s, x) => s + x.reps, 0);
    saveProfile(profile);
    renderHome();
    renderHistory();
  }

  // ---------------------------------------------------------------------
  // Profile switching / onboarding flow
  // ---------------------------------------------------------------------
  function bootProfile(id) {
    profile = loadProfile(id);
    if (!profile) return false;
    setCurrentId(id);
    refreshAndSave();
    renderAll();
    hide($('onboarding'));
    hide($('profile-switcher'));
    show($('main'));
    return true;
  }

  function openSwitcher() {
    const idx = loadProfilesIndex();
    const list = $('profile-list');
    list.innerHTML = '';
    idx.forEach(p => {
      const item = document.createElement('div');
      item.className = 'profile-item' + (profile && p.id === profile.id ? ' current' : '');
      item.innerHTML = `<span>${p.name}</span><span>${p.id === (profile && profile.id) ? 'current' : 'switch'}</span>`;
      item.addEventListener('click', () => requestUnlock(p.id));
      list.appendChild(item);
    });
    show($('profile-switcher'));
  }

  let pendingUnlockId = null;
  function requestUnlock(id) {
    const target = loadProfile(id);
    if (!target) return;
    if (!target.pinHash) {
      hide($('profile-switcher'));
      bootProfile(id);
      return;
    }
    pendingUnlockId = id;
    $('pin-unlock-name').textContent = `PIN for ${target.name}`;
    $('pin-unlock-input').value = '';
    hide($('pin-error'));
    hide($('profile-switcher'));
    show($('pin-unlock'));
  }

  function attemptUnlock() {
    const pin = $('pin-unlock-input').value.trim();
    const target = loadProfile(pendingUnlockId);
    if (target && target.pinHash === simpleHash(pin)) {
      hide($('pin-unlock'));
      bootProfile(pendingUnlockId);
    } else {
      show($('pin-error'));
    }
  }

  function startOnboarding(forNewProfile) {
    onboardingMode = 'new';
    hide($('main'));
    hide($('profile-switcher'));
    show($('onboarding'));
    document.querySelectorAll('.ob-step').forEach(hide);
    show($('ob-step-welcome'));
    if (forNewProfile) {
      goToStep('ob-step-name');
    }
  }

  function startRedoBaseline() {
    onboardingMode = 'redoBaseline';
    obDraft = { method: profile.baseline.method };
    document.querySelectorAll('#ob-method-seg .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.method === obDraft.method);
    });
    $('ob-value-label').textContent = obDraft.method === 'sixtySec'
      ? 'How many push-ups can you do in 60 seconds?'
      : 'How many push-ups can you do in one set, to failure?';
    $('ob-value').value = '';
    hide($('main'));
    hide($('profile-switcher'));
    show($('onboarding'));
    goToStep('ob-step-baseline');
  }

  function goToStep(stepId) {
    document.querySelectorAll('.ob-step').forEach(hide);
    show($(stepId));
  }

  function finishNewProfile() {
    const name = $('ob-name').value.trim() || 'Friend';
    const pin = $('ob-pin').value.trim();
    const method = obDraft.method;
    const value = Number($('ob-value').value) || 10;
    const p = createProfile(name, pin, method, value);
    bootProfile(p.id);
    toast(`Welcome, ${name}!`);
  }

  function finishRedoBaseline() {
    const method = obDraft.method;
    const value = Number($('ob-value').value) || profile.baseline.value;
    const b = computeBaseline(method, value);
    profile.baseline = { method, value, ...b };
    profile.currentTarget = b.dayTarget;
    profile.weekStartTarget = b.dayTarget;
    profile.weekStartDate = todayStr();
    profile.lastFullyEarnedTarget = b.dayTarget;

    const today = profile.days[todayStr()];
    const bankAvailable = profile.bank + today.bankApplied;
    today.target = today.isRestDay ? 0 : b.dayTarget;
    today.bankApplied = today.isRestDay ? 0 : Math.min(bankAvailable, today.target);
    today.effectiveTarget = today.target - today.bankApplied;
    profile.bank = bankAvailable - today.bankApplied;

    saveProfile(profile);
    bootProfile(profile.id);
    toast('Baseline updated');
  }

  function finishOnboardingConfirm() {
    if (onboardingMode === 'redoBaseline') {
      finishRedoBaseline();
    } else {
      finishNewProfile();
    }
  }

  // ---------------------------------------------------------------------
  // Export / import / delete
  // ---------------------------------------------------------------------
  function exportData() {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pushup-bank-${profile.name.replace(/\s+/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.id || !data.days) throw new Error('invalid');
        saveProfile(data);
        const idx = loadProfilesIndex();
        if (!idx.find(p => p.id === data.id)) {
          idx.push({ id: data.id, name: data.name });
          saveProfilesIndex(idx);
        }
        bootProfile(data.id);
        toast('Data imported');
      } catch (e) {
        toast('Import failed — invalid file');
      }
    };
    reader.readAsText(file);
  }

  function deleteCurrentProfile() {
    if (!confirm(`Delete ${profile.name}'s data? This can't be undone.`)) return;
    const id = profile.id;
    deleteProfileData(id);
    let idx = loadProfilesIndex().filter(p => p.id !== id);
    saveProfilesIndex(idx);
    if (getCurrentId() === id) localStorage.removeItem(CURRENT_KEY);
    profile = null;
    if (idx.length > 0) {
      bootProfile(idx[0].id);
    } else {
      hide($('main'));
      startOnboarding(false);
    }
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------
  function wireEvents() {
    document.querySelectorAll('[data-next]').forEach(btn => {
      btn.addEventListener('click', () => goToStep(btn.dataset.next));
    });
    $('ob-switch-existing').addEventListener('click', () => {
      hide($('onboarding'));
      openSwitcher();
    });
    $('ob-name-next').addEventListener('click', () => {
      if (!$('ob-name').value.trim()) { toast('Enter a name'); return; }
      goToStep('ob-step-baseline');
    });
    document.querySelectorAll('#ob-method-seg .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#ob-method-seg .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        obDraft.method = btn.dataset.method;
        $('ob-value-label').textContent = obDraft.method === 'sixtySec'
          ? 'How many push-ups can you do in 60 seconds?'
          : 'How many push-ups can you do in one set, to failure?';
      });
    });
    $('ob-baseline-next').addEventListener('click', () => {
      const value = Number($('ob-value').value);
      if (!value || value < 1) { toast('Enter a number'); return; }
      const b = computeBaseline(obDraft.method, value);
      obDraft.value = value;
      $('ob-plan-preview').innerHTML = `
        <div class="big">${b.dayTarget} push-ups / day</div>
        <div class="row"><span>Split into</span><span>${b.numSets} sets of ~${b.perSet}</span></div>
        <div class="row"><span>Weekly ramp</span><span>~${Math.round(RAMP_DEFAULT * 100)}%</span></div>
        <div class="row"><span>Rest day</span><span>Sunday</span></div>
      `;
      goToStep('ob-step-confirm');
    });
    $('ob-confirm-start').addEventListener('click', finishOnboardingConfirm);

    $('open-switcher').addEventListener('click', openSwitcher);
    $('close-switcher-btn').addEventListener('click', () => hide($('profile-switcher')));
    $('add-profile-btn').addEventListener('click', () => {
      hide($('profile-switcher'));
      startOnboarding(true);
    });
    $('pin-unlock-btn').addEventListener('click', attemptUnlock);
    $('pin-cancel-btn').addEventListener('click', () => {
      hide($('pin-unlock'));
      if (!profile) startOnboarding(false);
    });
    $('pin-unlock-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptUnlock(); });

    document.querySelectorAll('.qa-btn').forEach(btn => {
      btn.addEventListener('click', () => logReps(Number(btn.dataset.add)));
    });
    $('custom-add-btn').addEventListener('click', () => {
      const v = Number($('custom-reps').value);
      if (!v || v < 1) { toast('Enter a rep count'); return; }
      logReps(v);
      $('custom-reps').value = '';
    });
    $('sets-list').addEventListener('click', (e) => {
      if (e.target.classList.contains('set-del')) {
        removeSet(Number(e.target.dataset.idx));
      }
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.view').forEach(v => hide(v));
        show($(btn.dataset.view));
      });
    });

    $('set-restday').addEventListener('change', (e) => {
      profile.restDayIndex = Number(e.target.value);
      saveProfile(profile);
      toast('Rest day updated');
    });
    $('redo-baseline-btn').addEventListener('click', () => {
      if (!confirm('Redo your baseline test? This resets today\'s target based on a fresh test, but keeps your bank and streak.')) return;
      startRedoBaseline();
    });
    $('export-btn').addEventListener('click', exportData);
    $('import-input').addEventListener('change', (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
    });
    $('delete-profile-btn').addEventListener('click', deleteCurrentProfile);
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function boot() {
    wireEvents();
    const currentId = getCurrentId();
    if (currentId && loadProfile(currentId)) {
      const target = loadProfile(currentId);
      if (target.pinHash) {
        requestUnlock(currentId);
      } else {
        bootProfile(currentId);
      }
    } else {
      startOnboarding(false);
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && profile) {
        refreshAndSave();
        renderAll();
      }
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
