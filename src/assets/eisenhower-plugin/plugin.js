// Eisenhower AI: turns the events of the "Tareas" Google Calendar into tasks
// tagged Urgent / Important. The classification is produced every 12 h by a
// Claude routine that commits static/eisenhower-data/priorities.json.
//
// Rules:
// - One task per calendar event (identity = event id, kept in synced plugin
//   data and as a "ref: cal:<id>" line at the end of the task notes).
// - Her manual changes win: if she moved a task to another quadrant (changed
//   the urgent/important tags), Claude never touches its tags again.
// - If she edits the notes of a task, Claude stops updating those notes.
// - Done tasks and tasks she deleted are left alone and never recreated.

const URGENT_TAG = { id: 'EM_URGENT', title: 'urgent', icon: 'emergency' };
const IMPORTANT_TAG = { id: 'EM_IMPORTANT', title: 'important', icon: 'priority_high' };
const STATE_KEY = 'state';
const REFRESH_MS = 30 * 60 * 1000;
const REF_RE = /ref: cal:(\S+)\s*$/;

const dataUrl = (file) =>
  new URL(
    `static/eisenhower-data/${file}?ngsw-bypass=true&t=${Date.now()}`,
    document.baseURI,
  ).toString();

const fetchJson = async (file) => {
  const res = await fetch(dataUrl(file), { cache: 'no-store' });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.json();
};

const loadState = async () => {
  try {
    const raw = await PluginAPI.loadSyncedData(STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && parsed.events) return parsed;
  } catch (e) {
    console.warn('[eisenhower-ai] could not read state', e);
  }
  return { lastGeneratedAt: null, events: {} };
};

const ensureTags = async () => {
  const tags = await PluginAPI.getAllTags();
  for (const tag of [URGENT_TAG, IMPORTANT_TAG]) {
    if (!tags.some((t) => t.id === tag.id)) {
      await PluginAPI.addTag(tag);
    }
  }
};

const quadrantOf = (tagIds) => ({
  u: tagIds.includes(URGENT_TAG.id),
  i: tagIds.includes(IMPORTANT_TAG.id),
});

const sameQuadrant = (a, b) => !!a && !!b && a.u === b.u && a.i === b.i;

const withQuadrant = (tagIds, q) => {
  const rest = tagIds.filter((id) => id !== URGENT_TAG.id && id !== IMPORTANT_TAG.id);
  if (q.u) rest.push(URGENT_TAG.id);
  if (q.i) rest.push(IMPORTANT_TAG.id);
  return rest;
};

// Built from parts so every browser writes exactly the same text. Otherwise
// iPhone and laptop would keep rewriting each other's notes.
const formatWhen = (iso) => {
  const date = new Date(iso);
  if (!iso || isNaN(date.getTime())) return '';
  const p = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .forEach((part) => (p[part.type] = part.value));
  return `${p.day}/${p.month}/${p.year}, ${p.hour}:${p.minute}`;
};

const buildNotes = (item, generatedAt) => {
  const when = formatWhen(generatedAt);
  const parts = [];
  if (item.description) parts.push(item.description);
  if (item.reason) parts.push(`**Claude:** ${item.reason}`);
  parts.push(`_Classified by Claude${when ? ` · ${when}` : ''}_`);
  parts.push(`ref: cal:${item.eventId}`);
  return parts.join('\n\n');
};

// For tasks recorded before we kept the last notes we wrote: true if the notes
// still have exactly the shape buildNotes gives them, so she has not added to them.
const GENERATED_NOTES_RE =
  /^([\s\S]*?)(?:\n\n)?(?:\*\*Claude:\*\* [^\n]*\n\n)?_(?:Clasificado por|Classified by) Claude[^\n]*_\n\nref: cal:\S+\s*$/;
const looksGenerated = (notes, item) => {
  const m = (notes || '').match(GENERATED_NOTES_RE);
  return !!m && m[1] === (item.description || '');
};

// With sync on, two devices can each create a task for the same event before
// they have synced with each other. Keep one per event (a done one first, then
// the one this device's state points to, then the oldest) and delete the other
// copies, unless she already worked on them (done or time tracked).
const removeDuplicates = async (tasks, state) => {
  const groups = new Map();
  for (const t of tasks) {
    const m = (t.notes || '').match(REF_RE);
    if (!m) continue;
    if (!groups.has(m[1])) groups.set(m[1], []);
    groups.get(m[1]).push(t);
  }
  const removed = new Set();
  for (const [eventId, copies] of groups) {
    if (copies.length < 2) continue;
    const recId = state.events[eventId]?.taskId;
    const score = (t) => (t.isDone ? 0 : t.id === recId ? 1 : 2);
    copies.sort((a, b) => score(a) - score(b) || (a.created || 0) - (b.created || 0));
    for (const dup of copies.slice(1)) {
      if (dup.isDone || dup.timeSpent > 0) continue;
      try {
        await PluginAPI.deleteTask(dup.id);
        removed.add(dup.id);
      } catch (e) {
        console.warn('[eisenhower-ai] could not remove duplicate', e);
      }
    }
  }
  return removed.size ? tasks.filter((t) => !removed.has(t.id)) : tasks;
};

let isRunning = false;

const syncTasks = async () => {
  if (isRunning) return;
  isRunning = true;
  try {
    let data;
    try {
      data = await fetchJson('priorities.json');
    } catch (e) {
      console.warn('[eisenhower-ai] no priorities yet', e);
      return;
    }
    const items = Array.isArray(data?.tasks) ? data.tasks : [];
    if (!items.length) return;

    await ensureTags();
    const state = await loadState();
    const tasks = await removeDuplicates(await PluginAPI.getTasks(), state);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const byRef = new Map();
    for (const t of tasks) {
      const m = (t.notes || '').match(REF_RE);
      if (m) byRef.set(m[1], t);
    }

    let isChanged = state.lastGeneratedAt !== data.generatedAt;
    let created = 0;
    let updated = 0;

    for (const item of items) {
      if (!item || !item.eventId || !item.title) continue;
      const q = { u: !!item.urgent, i: !!item.important };
      const rec = state.events[item.eventId];
      const task = (rec && byId.get(rec.taskId)) || byRef.get(item.eventId);

      if (!task) {
        // We created it before and it is gone: she deleted or archived it.
        if (rec) continue;
        const notes = buildNotes(item, data.generatedAt);
        const taskId = await PluginAPI.addTask({
          title: item.title,
          notes,
          tagIds: withQuadrant([], q),
          dueDay: item.due || null,
          isIgnoreShortSyntax: true,
        });
        state.events[item.eventId] = { taskId, applied: q, due: item.due || null, notes };
        isChanged = true;
        created++;
        continue;
      }

      if (!rec || rec.taskId !== task.id) {
        // Found through the notes ref (e.g. created on another device).
        state.events[item.eventId] = {
          taskId: task.id,
          applied: quadrantOf(task.tagIds),
          due: task.dueDay || null,
        };
        isChanged = true;
      }
      const r = state.events[item.eventId];
      if (task.isDone) continue;

      // r.notes = the notes we last wrote, or null once they are hers.
      if (r.notes === undefined) {
        r.notes = looksGenerated(task.notes, item) ? task.notes : null;
        isChanged = true;
      }

      const current = quadrantOf(task.tagIds);
      const isUntouchedByHer = sameQuadrant(current, r.applied);
      const updates = {};

      if (isUntouchedByHer && !sameQuadrant(current, q)) {
        updates.tagIds = withQuadrant(task.tagIds, q);
        r.applied = q;
      }
      if (isUntouchedByHer && task.notes === r.notes) {
        const notes = buildNotes(item, data.generatedAt);
        if (task.notes !== notes) {
          updates.notes = notes;
          r.notes = notes;
        }
      }
      const due = item.due || null;
      if (due && due !== r.due && (task.dueDay || null) === r.due && !task.dueWithTime) {
        updates.dueDay = due;
        r.due = due;
      }

      if (Object.keys(updates).length) {
        await PluginAPI.updateTask(task.id, updates);
        isChanged = true;
        updated++;
      }
    }

    if (isChanged) {
      state.lastGeneratedAt = data.generatedAt || null;
      await PluginAPI.persistDataSynced(JSON.stringify(state), STATE_KEY);
    }
    if (created || updated) {
      PluginAPI.showSnack({
        msg: `Claude: ${created} new, ${updated} updated`,
        type: 'SUCCESS',
        ico: 'auto_awesome',
      });
    }
  } catch (e) {
    console.error('[eisenhower-ai] sync failed', e);
  } finally {
    isRunning = false;
  }
};

// ---------- "⟳ Sync with Claude" header button ----------
// Fires the routine through the Pages Function /api/sync (the token stays on
// the server), then polls the same priorities.json for a newer generatedAt.
const COOLDOWN_KEY = 'eisenhower-ai:syncCooldownUntil';
const COOLDOWN_MS = 10 * 60 * 1000;
const POLL_MS = 60 * 1000;
const POLL_MAX_MS = 15 * 60 * 1000;
let pollId = null;
let isFiring = false;

const getCooldownUntil = () => {
  try {
    return Number(localStorage.getItem(COOLDOWN_KEY)) || 0;
  } catch {
    return 0;
  }
};
const setCooldownUntil = (ts) => {
  try {
    localStorage.setItem(COOLDOWN_KEY, String(ts));
  } catch {
    // Storage blocked: the cooldown then only lasts for this session.
  }
};

const currentGeneratedAt = async () => {
  try {
    return (await fetchJson('priorities.json')).generatedAt || null;
  } catch {
    return null;
  }
};

const stopPolling = () => {
  if (pollId) clearInterval(pollId);
  pollId = null;
};

const pollForResults = (before) => {
  stopPolling();
  const startedAt = Date.now();
  pollId = setInterval(async () => {
    const now = await currentGeneratedAt();
    if (now && now !== before) {
      stopPolling();
      await syncTasks();
      PluginAPI.showSnack({ msg: 'Updated ✓', type: 'SUCCESS', ico: 'check' });
    } else if (Date.now() - startedAt > POLL_MAX_MS) {
      stopPolling();
      PluginAPI.showSnack({
        msg: 'Claude is still working. The results will appear on their own in a few minutes.',
        type: 'INFO',
      });
    }
  }, POLL_MS);
};

const syncWithClaude = async () => {
  const left = getCooldownUntil() - Date.now();
  if (left > 0) {
    PluginAPI.showSnack({
      msg: `Already requested. Try again in ${Math.ceil(left / 60000)} min.`,
      type: 'INFO',
    });
    return;
  }
  if (isFiring) return;
  isFiring = true;
  PluginAPI.showSnack({ msg: 'Syncing with Claude…', type: 'INFO', ico: 'sync' });
  try {
    const before = await currentGeneratedAt();
    const res = await fetch(new URL('api/sync', document.baseURI).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'same-origin',
    });
    let body = {};
    try {
      body = await res.json();
    } catch {
      // Not JSON (e.g. Cloudflare Access login page): handled below.
    }
    if (!res.ok || !body.ok) {
      throw new Error(body.error || `Error ${res.status}`);
    }
    setCooldownUntil(Date.now() + COOLDOWN_MS);
    PluginAPI.showSnack({
      msg: 'Claude is reviewing your calendar. This takes about 5 minutes.',
      type: 'SUCCESS',
      ico: 'auto_awesome',
      ...(body.sessionUrl && {
        action: {
          label: 'View',
          onClick: () => window.open(body.sessionUrl, '_blank', 'noopener'),
        },
      }),
    });
    pollForResults(before);
  } catch (e) {
    PluginAPI.showSnack({
      msg: `Could not sync: ${e.message || e}`,
      type: 'ERROR',
    });
  } finally {
    isFiring = false;
  }
};

PluginAPI.registerHeaderButton({
  id: 'claude-sync',
  label: 'Sync with Claude',
  // A sparkle on phones, where it sat next to Dropbox's nearly identical icon.
  icon: window.matchMedia('(max-width: 599px)').matches ? 'auto_awesome' : 'sync',
  onClick: syncWithClaude,
});

// ---------- Easter egg ----------
// Now and then, finishing a task shows a small picture in the corner.
// The live app uses a private list of saved Pinterest images. This public copy ships with an
// empty list, so the easter egg stays off until you add your own paths below PIN_BASE.
const PIN_BASE = 'https://i.pinimg.com/736x/';
const PINS = [];
const EGG_CHANCE = 0.5;
const EGG_MS = 30000;
const EGG_FADE_MS = 300;
const RECENT_PINS_KEY = 'eisenhower-ai:recentPins';
const RECENT_PINS_MAX = 50;
let eggEl = null;
let eggTimer = null;

const hideEgg = () => {
  clearTimeout(eggTimer);
  eggEl?.remove();
  eggEl = null;
};

const showEgg = () => {
  if (eggEl || !PINS.length) return;
  let recent = [];
  try {
    recent = JSON.parse(localStorage.getItem(RECENT_PINS_KEY)) || [];
  } catch {
    // Storage blocked: an image may just come up again sooner.
  }
  const pool = PINS.filter((pin) => !recent.includes(pin));
  const pin = pool[Math.floor(Math.random() * pool.length)];
  const img = new Image();
  img.alt = '';
  img.style.cssText = 'display:block;width:100%;max-height:190px;object-fit:cover;';
  img.onload = () => {
    if (eggEl) return;
    // A small picture in the corner: taps go straight through it.
    const isPhone = window.matchMedia('(max-width: 599px)').matches;
    const bottom = isPhone ? 'calc(92px + env(safe-area-inset-bottom, 0px))' : '16px';
    eggEl = document.createElement('div');
    eggEl.setAttribute('aria-hidden', 'true');
    eggEl.style.cssText =
      `position:fixed;right:16px;bottom:${bottom};z-index:99999;width:${isPhone ? 112 : 150}px;` +
      'padding:5px 5px 14px;background:#fff;box-shadow:0 6px 18px rgba(0,0,0,.35);pointer-events:none;' +
      `opacity:0;transform:translateY(8px) rotate(-2deg);transition:opacity ${EGG_FADE_MS}ms,transform ${EGG_FADE_MS}ms;`;
    eggEl.appendChild(img);
    document.body.appendChild(eggEl);
    requestAnimationFrame(() => {
      if (!eggEl) return;
      eggEl.style.opacity = '1';
      eggEl.style.transform = 'rotate(-2deg)';
    });
    eggTimer = setTimeout(() => {
      if (eggEl) eggEl.style.opacity = '0';
      eggTimer = setTimeout(hideEgg, EGG_FADE_MS);
    }, EGG_MS);
    try {
      localStorage.setItem(
        RECENT_PINS_KEY,
        JSON.stringify([pin, ...recent].slice(0, RECENT_PINS_MAX)),
      );
    } catch {
      // See above.
    }
  };
  // Without this the app's service worker fails the request on the live site.
  img.src = `${PIN_BASE}${pin}?ngsw-bypass=true`;
};

PluginAPI.registerHook(PluginAPI.Hooks.TASK_COMPLETE, () => {
  if (Math.random() < EGG_CHANCE) showEgg();
});

let intervalId = null;

const onVisible = () => {
  if (document.visibilityState === 'visible') syncTasks();
};

// When another device's changes arrive through sync, re-check (this also
// removes duplicate tasks created on two devices at the same time).
let syncedDataTimer = null;
PluginAPI.registerHook(PluginAPI.Hooks.PERSISTED_DATA_CHANGED, () => {
  clearTimeout(syncedDataTimer);
  syncedDataTimer = setTimeout(syncTasks, 3000);
});

PluginAPI.onReady(async () => {
  await syncTasks();
  intervalId = setInterval(syncTasks, REFRESH_MS);
  document.addEventListener('visibilitychange', onVisible);
});

PluginAPI.onUnload(() => {
  if (intervalId) clearInterval(intervalId);
  clearTimeout(syncedDataTimer);
  stopPolling();
  hideEgg();
  document.removeEventListener('visibilitychange', onVisible);
});
