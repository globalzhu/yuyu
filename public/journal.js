import { WARDROBE_ITEMS, WARDROBE_SLOTS, emptyWardrobe, normalizeWardrobe, wardrobeSpent } from './wardrobe-catalog.mjs?v=1';

const memory = new Map();
const memoryAwards = new Set();
let memoryShells = 0;
let memoryChallengeShells = 0;
let memoryWardrobe = emptyWardrobe();
const memoryActivityBonuses = {};
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
  if (!db) return { entries: [...memory.values()], ...localEconomy(memoryShells, memoryWardrobe),
    ...activitySnapshot(memoryActivityBonuses), solvedCount: [...memoryAwards].filter(isQuestionId).length,
    challengeShells: memoryChallengeShells, local: false };
  const tx = db.transaction(['entries', 'settings', 'awards'], 'readonly');
  const settings = tx.objectStore('settings');
  const [entries, shells, challengeShells, wardrobe, bonuses, awards] = await Promise.all([
    resultOf(tx.objectStore('entries').getAll()),
    resultOf(settings.get('shells')),
    resultOf(settings.get('challengeShells')),
    resultOf(settings.get('wardrobe')),
    resultOf(settings.get('activityBonuses')),
    resultOf(tx.objectStore('awards').getAllKeys()),
  ]);
  return { entries, ...localEconomy(shells || 0, wardrobe), ...activitySnapshot(bonuses),
    solvedCount: awards.filter(isQuestionId).length, challengeShells: challengeShells || 0, local: true };
}

const isQuestionId = (id) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);

function activitySnapshot(bonuses = {}) {
  return { awardedActivityIds: Object.values(bonuses), activityBonusShells: Object.keys(bonuses).length * 2 };
}

function localEconomy(earnedShells, savedWardrobe) {
  const wardrobe = normalizeWardrobe(savedWardrobe);
  return { earnedShells, shells: Math.max(0, earnedShells - wardrobeSpent(wardrobe)), wardrobe };
}

function localChallengeReady(entry, parent) {
  return Boolean(entry.parentId && entry.parentId !== entry.id && entry.completionToken &&
    parent && (parent.solved || entry.activityId) && !parent.challenge && !parent.parentId);
}

function awardActivity(entry, entries, bonuses) {
  const candidate = entry.activityId ? entry : entries.find((item) => item.parentId === entry.id && item.activityId);
  if (!candidate || bonuses[candidate.parentId]) return false;
  const parent = entries.find((item) => item.id === candidate.parentId);
  if (!parent || parent.challenge || parent.parentId) return false;
  const children = entries.filter((item) => item.activityId === candidate.activityId && item.parentId === candidate.parentId);
  if (![0, 1, 2].every((index) => children.some((item) => item.activityIndex === index && item.solved && item.completionToken))) return false;
  bonuses[candidate.parentId] = candidate.activityId;
  return candidate.parentId;
}

async function saveLocalEntry(entry) {
  const challenge = entry.challenge === true || Boolean(entry.parentId);
  const parentAward = entry.activityId ? 'activity:' + entry.parentId + ':' + entry.activityIndex
    : challenge ? 'challenge:' + entry.parentId : undefined;
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
    const activityBonus = awardActivity(entry, [...memory.values()], memoryActivityBonuses);
    if (activityBonus) memoryShells += 2;
    return { ...localEconomy(memoryShells, memoryWardrobe), ...activitySnapshot(memoryActivityBonuses),
      activityBonusAwarded: activityBonus ? [activityBonus] : [], awarded, local: false };
  }
  const tx = db.transaction(['entries', 'awards', 'settings'], 'readwrite');
  const finished = done(tx);
  const awards = tx.objectStore('awards');
  const settings = tx.objectStore('settings');
  const entries = tx.objectStore('entries');
  const [oldAwards, savedShells, parent, savedChallengeShells, wardrobe, savedBonuses, savedEntries] = await Promise.all([
    Promise.all(keys.map((key) => resultOf(awards.get(key)))),
    resultOf(settings.get('shells')),
    challenge && entry.parentId ? resultOf(entries.get(entry.parentId)) : undefined,
    challenge ? resultOf(settings.get('challengeShells')) : undefined,
    resultOf(settings.get('wardrobe')),
    resultOf(settings.get('activityBonuses')),
    resultOf(entries.getAll()),
  ]);
  const awarded = entry.solved && !oldAwards.some(Boolean) && (!challenge || localChallengeReady(entry, parent));
  const bonuses = savedBonuses || {};
  const activityBonus = awardActivity(entry, [...savedEntries.filter((item) => item.id !== entry.id), entry], bonuses);
  const shells = (savedShells || 0) + Number(awarded) + (activityBonus ? 2 : 0);
  if (awarded) {
    for (const key of keys) awards.put(true, key);
    if (challenge) settings.put((savedChallengeShells || 0) + 1, 'challengeShells');
  }
  if (awarded || activityBonus) settings.put(shells, 'shells');
  if (activityBonus) settings.put(bonuses, 'activityBonuses');
  entries.put(entry);
  await finished;
  return { ...localEconomy(shells, wardrobe), ...activitySnapshot(bonuses),
    activityBonusAwarded: activityBonus ? [activityBonus] : [], awarded, local: true };
}

function purchaseWardrobe(wardrobe, earnedShells, itemId) {
  const item = WARDROBE_ITEMS.find((item) => item.id === itemId);
  if (!item) throw new Error('没有找到这个装扮。');
  const purchased = !wardrobe.owned.includes(itemId);
  if (purchased && localEconomy(earnedShells, wardrobe).shells < item.price) {
    throw new Error('贝壳还差一点，先解一道题再来吧。');
  }
  if (purchased) wardrobe.owned.push(itemId);
  wardrobe.equipped[item.slot] = itemId;
  wardrobe.revision++;
  return { purchased };
}

function equipWardrobe(wardrobe, slot, itemId) {
  if (!WARDROBE_SLOTS.some((item) => item.id === slot)) throw new Error('没有找到这个装扮位置。');
  if (itemId !== null && !WARDROBE_ITEMS.some((item) => item.id === itemId && item.slot === slot && wardrobe.owned.includes(itemId))) {
    throw new Error('先兑换这个装扮，就能给小鱼穿上。');
  }
  wardrobe.equipped[slot] = itemId;
  wardrobe.revision++;
  return {};
}

async function changeLocalWardrobe(change) {
  const db = await database;
  if (!db) {
    const wardrobe = normalizeWardrobe(memoryWardrobe);
    const result = change(wardrobe, memoryShells);
    memoryWardrobe = wardrobe;
    return { ...localEconomy(memoryShells, wardrobe), ...result, local: false };
  }
  const tx = db.transaction('settings', 'readwrite');
  const finished = done(tx);
  const store = tx.objectStore('settings');
  const [earned, saved] = await Promise.all([resultOf(store.get('shells')), resultOf(store.get('wardrobe'))]);
  const wardrobe = normalizeWardrobe(saved);
  let result;
  try {
    result = change(wardrobe, earned || 0);
  } catch (error) {
    await finished;
    throw error;
  }
  store.put(wardrobe, 'wardrobe');
  await finished;
  return { ...localEconomy(earned || 0, wardrobe), ...result, local: true };
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
  if (family && ['journal', 'sync', 'logout', 'purchase', 'equip', 'nickname', 'password', 'recovery-code'].includes(action)) headers['X-Yuyu-Family-Name'] = family.name;
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
  .catch(() => { syncState = 'unknown'; });

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
    earnedShells: confirmed?.earnedShells ?? confirmed?.shells ?? 0,
    wardrobe: normalizeWardrobe(confirmed?.wardrobe),
    solvedCount: confirmed?.solvedCount || 0,
    awardedActivityIds: confirmed?.awardedActivityIds || [],
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
  if (!family) return { family: null, syncState };
  const [local, imported] = await Promise.all([loadLocalJournal(), setting('imported:' + family.name)]);
  return { family, syncState, canImport: !imported && (local.entries.length > 0 || local.earnedShells > 0 || local.wardrobe.owned.length > 0) };
}

export async function signIn(mode, credentials) {
  await ready;
  return serialize(async () => {
    const result = await familyRequest(mode, credentials);
    await setFamily(result.family);
    await pull().catch(() => {});
    if (syncState === 'expired') {
      const actual = await familyRequest('session');
      await setFamily(actual.family);
      throw new Error('浏览器未能保持这次登录。请允许此网站使用 Cookie，再用账号和密码登录。');
    }
    return result.family;
  });
}

export async function verifyFamilySession() {
  await ready;
  return serialize(async () => {
    const result = await familyRequest('session');
    const changed = result.family?.name !== family?.name;
    if (changed) await setFamily(result.family);
    else if (family) family = result.family;
    else syncState = 'local';
    return changed;
  });
}

export async function saveNickname(nickname) {
  await ready;
  return serialize(async () => {
    const result = await familyRequest('nickname', { nickname });
    family = result.family;
    return family;
  });
}

export async function managePassword(action, fields) {
  await ready;
  return serialize(async () => {
    const result = await familyRequest(action, fields);
    if (action === 'recovery-code' && family) family.hasRecovery = true;
    return result;
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
    const { entries, earnedShells, challengeShells, wardrobe, activityBonusShells } = await loadLocalJournal();
    let deviceId = await setting('device-id');
    if (!deviceId) deviceId = await setting('device-id', crypto.randomUUID());
    const result = await sendChanges([], { deviceId, entries, shells: earnedShells, challengeShells, wardrobe, activityBonusShells });
    await setting('imported:' + family.name, true);
    return { ...visibleFamilyJournal(), skippedWardrobeItems: result.skippedWardrobeItems || [] };
  });
}

async function changeWardrobe(action, body, localChange) {
  await ready;
  return serialize(async () => {
    if (!family) return changeLocalWardrobe(localChange);
    await pull();
    if (pending.length || syncState !== 'synced') throw new Error('先连上网络同步贝壳，再来兑换装扮吧。');
    try {
      const result = await familyRequest(action, body);
      confirmed = result;
      syncState = 'synced';
      return result;
    } catch (error) {
      if (Array.isArray(error.data?.entries)) confirmed = error.data;
      if (error.status === 401) syncState = 'expired';
      throw error;
    }
  });
}

export function purchaseItem(itemId) {
  return changeWardrobe('purchase', { itemId }, (wardrobe, earned) => purchaseWardrobe(wardrobe, earned, itemId));
}

export function equipItem(slot, itemId) {
  return changeWardrobe('equip', { slot, itemId }, (wardrobe) => equipWardrobe(wardrobe, slot, itemId));
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
      return { entry: result.entries.find((item) => item.id === entry.id), shells: result.shells,
        earnedShells: result.earnedShells, wardrobe: result.wardrobe, awarded: result.awarded.includes(entry.id),
        awardedActivityIds: result.awardedActivityIds, activityBonusAwarded: result.activityBonusAwarded };
    } catch (error) {
      if (error.status === 409 && Array.isArray(error.data.entries)) {
        await storeResult();
        return { conflict: true, entry: confirmed.entries.find((item) => item.id === entry.id), shells: confirmed.shells,
          earnedShells: confirmed.earnedShells, wardrobe: confirmed.wardrobe };
      }
      if (error.status && error.status < 500 && error.status !== 401 && error.status !== 429) throw error;
      pending = pending.filter((item) => item.id !== entry.id);
      pending.push(change);
      await rememberPending();
      return { pending: true, shells: confirmed?.shells || 0, earnedShells: confirmed?.earnedShells || 0,
        wardrobe: normalizeWardrobe(confirmed?.wardrobe), local: Boolean(await database) };
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
