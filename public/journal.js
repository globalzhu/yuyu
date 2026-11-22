import { normalizeWardrobe } from './wardrobe-catalog.mjs?v=2';
import { memberFetch } from './member-fetch.js';
const database = new Promise((resolve) => {
  if (!globalThis.indexedDB) return resolve(null);
  const request = indexedDB.open('yuyu-journal', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('entries', { keyPath: 'id' });
    request.result.createObjectStore('awards');
    request.result.createObjectStore('settings');
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
  if (family && action !== 'session') headers['X-Yuyu-Family-Name'] = family.name;
  if (body !== undefined) Object.assign(headers, { 'Content-Type': 'application/json', 'X-Yuyu-Family': '1' });
  const response = await memberFetch('api/family/' + action, {
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
  pending = value ? await setting('pending:' + (value.storageName || value.name)) || [] : [];
  carriedAttempts = value ? await setting('drafts:' + (value.storageName || value.name)) || {} : {};
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
  return setting('pending:' + (family.storageName || family.name), pending);
}

async function sendChanges(changes) {
  try {
    const result = await familyRequest('sync', { changes });
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
        await setting('drafts:' + (family.storageName || family.name), carriedAttempts);
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
    giftSpent: confirmed?.giftSpent || 0,
    solvedCount: confirmed?.solvedCount || 0,
    awardedActivityIds: confirmed?.awardedActivityIds || [],
    local: true,
    family,
    syncState,
  };
}

function requireFamily() {
  if (!family || syncState === 'expired') throw new Error('请先登录家庭账号。');
}

export function redeemGift(fields) {
  return changeWallet('redeem', fields);
}

export async function giftShop() {
  await ready;
  requireFamily();
  return familyRequest('gifts');
}

export async function loadJournal({ refresh = true } = {}) {
  await ready;
  return serialize(async () => {
    requireFamily();
    if (refresh || !confirmed) await pull();
    return visibleFamilyJournal();
  });
}

export async function familyInfo() {
  await ready;
  const db = await database;
  const owner = family.storageName || family.name;
  const available = db && !await setting('imported:' + owner) && await resultOf(db.transaction('entries').objectStore('entries').count()) > 0;
  return { family, syncState, hasArchive: Boolean(available) };
}

export async function restoreHistory() {
  await ready;
  return serialize(async () => {
    requireFamily();
    const db = await database;
    const entries = db ? await resultOf(db.transaction('entries').objectStore('entries').getAll()) : [];
    const result = await familyRequest('restore-history', { entries });
    confirmed = result;
    await setting('imported:' + (family.storageName || family.name), true);
    return result.restored;
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

async function changeWallet(action, body) {
  await ready;
  return serialize(async () => {
    requireFamily();
    await pull();
    if (pending.length || syncState !== 'synced') throw new Error('请先联网同步贝壳，再来兑换。');
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
  return changeWallet('purchase', { itemId });
}

export function equipItem(slot, itemId) {
  return changeWallet('equip', { slot, itemId });
}

export async function saveEntry(entry) {
  await ready;
  return serialize(async () => {
    requireFamily();
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
        await setting('drafts:' + (family.storageName || family.name), carriedAttempts);
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
  return serialize(async () => {
    requireFamily();
    await pull();
    if (!confirmed || pending.length) throw new Error('请等题目同步完成再删除。');
    const changes = confirmed.entries.filter((item) => !id || item.id === id)
      .map((item) => ({ id: item.id, revision: item.revision, entry: null }));
    if (changes.length) await sendChanges(changes);
  });
}
