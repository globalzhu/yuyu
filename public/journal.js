const memory = new Map();
const memoryAwards = new Set();
let memoryShells = 0;
let memoryChallengeShells = 0;
try {
  memoryShells = Math.max(0, Math.floor(Number(localStorage.getItem('yuyu-shells')) || 0));
} catch {}

const database = new Promise((resolve) => {
  if (!globalThis.indexedDB) return resolve(null);
  const request = indexedDB.open('yuyu-journal', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('entries', { keyPath: 'id' });
    request.result.createObjectStore('awards');
    request.result.createObjectStore('settings').put(memoryShells, 'shells');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = request.onblocked = () => resolve(null);
});

function resultOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error('Journal update interrupted'));
  });
}

async function loadLocalJournal() {
  const db = await database;
  if (!db) return { entries: [...memory.values()], shells: memoryShells, challengeShells: memoryChallengeShells, local: false };
  const tx = db.transaction(['entries', 'settings'], 'readonly');
  const settings = tx.objectStore('settings');
  const [entries, shells, challengeShells] = await Promise.all([
    resultOf(tx.objectStore('entries').getAll()),
    resultOf(settings.get('shells')),
    resultOf(settings.get('challengeShells')),
  ]);
  return { entries, shells: shells || 0, challengeShells: challengeShells || 0, local: true };
}

function localChallengeReady(entry, parent) {
  return Boolean(entry.parentId && entry.parentId !== entry.id && entry.completionToken &&
    parent?.solved && !parent.challenge && !parent.parentId);
}

async function saveLocalEntry(entry) {
  const challenge = entry.challenge === true || Boolean(entry.parentId);
  const parentAward = challenge ? 'challenge:' + entry.parentId : undefined;
  const keys = parentAward ? [entry.id, parentAward] : [entry.id];
  const db = await database;
  if (!db) {
    const awarded = entry.solved && !keys.some((key) => memoryAwards.has(key)) &&
      (!challenge || localChallengeReady(entry, memory.get(entry.parentId)));
    if (awarded) {
      for (const key of keys) memoryAwards.add(key);
      memoryShells++;
      if (challenge) memoryChallengeShells++;
    }
    memory.set(entry.id, structuredClone(entry));
    return { shells: memoryShells, awarded, local: false };
  }
  const tx = db.transaction(['entries', 'awards', 'settings'], 'readwrite');
  const finished = done(tx);
  const awards = tx.objectStore('awards');
  const settings = tx.objectStore('settings');
  const entries = tx.objectStore('entries');
  const [oldAwards, savedShells, parent, savedChallengeShells] = await Promise.all([
    Promise.all(keys.map((key) => resultOf(awards.get(key)))),
    resultOf(settings.get('shells')),
    challenge && entry.parentId ? resultOf(entries.get(entry.parentId)) : undefined,
    challenge ? resultOf(settings.get('challengeShells')) : undefined,
  ]);
  const awarded = entry.solved && !oldAwards.some(Boolean) && (!challenge || localChallengeReady(entry, parent));
  const shells = (savedShells || 0) + Number(awarded);
  if (awarded) {
    for (const key of keys) awards.put(true, key);
    settings.put(shells, 'shells');
    if (challenge) settings.put((savedChallengeShells || 0) + 1, 'challengeShells');
  }
  entries.put(entry);
  await finished;
  return { shells, awarded, local: true };
}

async function removeLocalEntries(id) {
  const db = await database;
  if (!db) {
    if (id) memory.delete(id);
    else memory.clear();
    return;
  }
  const tx = db.transaction('entries', 'readwrite');
  const finished = done(tx);
  if (id) tx.objectStore('entries').delete(id);
  else tx.objectStore('entries').clear();
  await finished;
}

async function setting(key, value) {
  const db = await database;
  if (!db) {
    if (value !== undefined) settings.set(key, value);
    return settings.get(key);
  }
  const tx = db.transaction('settings', value === undefined ? 'readonly' : 'readwrite');
  const store = tx.objectStore('settings');
  if (value === undefined) return resultOf(store.get(key));
  const finished = done(tx);
  store.put(value, key);
  await finished;
  return value;
}

const settings = new Map();
let family = null;
let confirmed = null;
let pending = [];
let carriedAttempts = {};
let syncState = 'local';
let syncTask = Promise.resolve();

async function familyRequest(action, body) {
  const headers = {};
  if (family && ['journal', 'sync', 'logout'].includes(action)) headers['X-Yuyu-Family-Name'] = family.name;
  if (body !== undefined) Object.assign(headers, { 'Content-Type': 'application/json', 'X-Yuyu-Family': '1' });
  const response = await fetch('api/family/' + action, {
    cache: 'no-store',
    headers,
    signal: AbortSignal.timeout?.(10_000),
    ...(body === undefined ? {} : {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || '家庭账号暂时连不上。');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function setFamily(value) {
  family = value;
  confirmed = null;
  pending = value ? await setting('pending:' + value.name) || [] : [];
  carriedAttempts = value ? await setting('drafts:' + value.name) || {} : {};
  syncState = value ? 'waiting' : 'local';
}

const ready = familyRequest('session')
  .then(({ family }) => setFamily(family))
  .catch(() => {});

function serialize(task) {
  const next = syncTask.then(task);
  syncTask = next.catch(() => {});
  return next;
}

function rememberPending() {
  return setting('pending:' + family.name, pending);
}

async function sendChanges(changes, migration) {
  try {
    const result = await familyRequest('sync', { changes, migration });
    confirmed = result;
    syncState = 'synced';
    return result;
  } catch (error) {
    if (error.status === 409 && Array.isArray(error.data.entries)) {
      confirmed = error.data;
      syncState = 'synced';
    } else syncState = error.status === 401 ? 'expired' : 'waiting';
    throw error;
  }
}

async function flushPending() {
  const completed = [];
  for (const change of pending) {
    try {
      await sendChanges([change]);
      completed.push(change.id);
    } catch (error) {
      if (error.status !== 409 || !Array.isArray(error.data.entries)) break;
      const latest = confirmed.entries.find((entry) => entry.id === change.id);
      const localTurn = change.entry?.turns.at(-1);
      const serverTurn = latest?.turns.at(-1);
      if (continuesProgress(latest, change.entry)) {
        try {
          await sendChanges([{ ...change, revision: latest.revision }]);
          completed.push(change.id);
          continue;
        } catch (retry) {
          if (retry.status !== 409 || !Array.isArray(retry.data.entries)) break;
        }
      }
      if (localTurn?.attempt && !sameTurn(localTurn, serverTurn)) {
        carriedAttempts[change.id] = localTurn.attempt;
        await setting('drafts:' + family.name, carriedAttempts);
      }
      completed.push(change.id);
    }
  }
  if (completed.length) {
    pending = pending.filter((change) => !completed.includes(change.id));
    await rememberPending();
  }
}

function sameTurn(first, second) {
  return first?.attempt === second?.attempt && first?.message === second?.message &&
    first?.hintLevel === second?.hintLevel;
}

function continuesProgress(latest, local) {
  if (!latest || latest.solved || latest.turns.length > local.turns.length) return false;
  const earlier = latest.turns.slice(0, -1);
  if (!earlier.every((turn, index) => sameTurn(turn, local.turns[index]))) return false;
  const last = latest.turns.at(-1);
  const corresponding = local.turns[earlier.length];
  if (sameTurn(last, corresponding)) return latest.turns.length < local.turns.length;
  return last?.feedback === 'hint' && corresponding?.feedback === 'hint' &&
    !last.attempt && !corresponding.attempt &&
    Number.isSafeInteger(last.hintLevel) && Number.isSafeInteger(corresponding.hintLevel) &&
    corresponding.hintLevel > last.hintLevel && last.task === corresponding.task;
}

async function pull() {
  if (!family) return;
  await flushPending();
  if (pending.length) return;
  try {
    confirmed = await familyRequest('journal');
    syncState = 'synced';
  } catch (error) {
    syncState = error.status === 401 ? 'expired' : 'waiting';
    if (!confirmed) throw error;
  }
}

function visibleFamilyJournal() {
  const entries = new Map((confirmed?.entries || []).map((item) => [item.id, item]));
  for (const change of pending) entries.set(change.id, change.entry);
  return {
    entries: [...entries.values()].map((item) => ({ ...item, carriedAttempt: carriedAttempts[item.id] })),
    shells: confirmed?.shells || 0,
    local: true,
    family,
    syncState,
  };
}

export async function loadJournal({ refresh = true } = {}) {
  await ready;
  if (!family) return loadLocalJournal();
  return serialize(async () => {
    if (refresh || !confirmed) await pull();
    return visibleFamilyJournal();
  });
}

export async function familyInfo() {
  await ready;
  if (!family) return { family: null };
  const [local, imported] = await Promise.all([loadLocalJournal(), setting('imported:' + family.name)]);
  return { family, syncState, canImport: !imported && (local.entries.length > 0 || local.shells > 0) };
}

export async function signIn(mode, credentials) {
  await ready;
  return serialize(async () => {
    const result = await familyRequest(mode, credentials);
    await setFamily(result.family);
    await pull().catch(() => {});
    return result.family;
  });
}

export async function signOut() {
  await ready;
  return serialize(async () => {
    await familyRequest('logout', {});
    await setFamily(null);
  });
}

export async function importLocalJournal() {
  await ready;
  return serialize(async () => {
    const { entries, shells, challengeShells } = await loadLocalJournal();
    let deviceId = await setting('device-id');
    if (!deviceId) deviceId = await setting('device-id', crypto.randomUUID());
    await sendChanges([], { deviceId, entries, shells, challengeShells });
    await setting('imported:' + family.name, true);
    return visibleFamilyJournal();
  });
}

export async function saveEntry(entry) {
  await ready;
  if (!family) return saveLocalEntry(entry);
  return serialize(async () => {
    const prior = pending.find((change) => change.id === entry.id);
    const change = { id: entry.id, revision: prior?.revision ?? entry.revision ?? 0, entry };
    const storeResult = async () => {
      pending = pending.filter((item) => item.id !== entry.id);
      await rememberPending();
    };
    try {
      const result = await sendChanges([change]);
      await storeResult();
      if (carriedAttempts[entry.id]) {
        delete carriedAttempts[entry.id];
        await setting('drafts:' + family.name, carriedAttempts);
      }
      return { entry: result.entries.find((item) => item.id === entry.id), shells: result.shells, awarded: result.awarded.includes(entry.id) };
    } catch (error) {
      if (error.status === 409 && Array.isArray(error.data.entries)) {
        await storeResult();
        return { conflict: true, entry: confirmed.entries.find((item) => item.id === entry.id), shells: confirmed.shells };
      }
      if (error.status && error.status < 500 && error.status !== 401 && error.status !== 429) throw error;
      pending = pending.filter((item) => item.id !== entry.id);
      pending.push(change);
      await rememberPending();
      return { pending: true, shells: confirmed?.shells || 0, local: Boolean(await database) };
    }
  });
}

export async function removeEntries(id) {
  await ready;
  if (!family) return removeLocalEntries(id);
  return serialize(async () => {
    await pull();
    if (!confirmed || pending.length) throw new Error('请等题目同步完成再删除。');
    const changes = confirmed.entries.filter((item) => !id || item.id === id)
      .map((item) => ({ id: item.id, revision: item.revision, entry: null }));
    if (changes.length) await sendChanges(changes);
  });
}
