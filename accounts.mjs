import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { WARDROBE_ITEMS, WARDROBE_SLOTS, normalizeWardrobe, wardrobeSpent } from './public/wardrobe-catalog.mjs';

const derive = promisify(scrypt);
const cookieName = 'yuyu_family';
const hour = 60 * 60 * 1000;
const sessionAge = 30 * 24 * hour;
const familyLimit = 250;
const recordLimit = 500;
const journalBytes = 4 * 1024 * 1024;
const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const namePattern = /^[a-z0-9][a-z0-9_-]{3,23}$/;
const signedCookiePattern = /^([a-f0-9]{64})\.([\w-]{43})$/;
const settings = { N: 32768, r: 8, p: 3, maxmem: 40 * 1024 * 1024 };
const formats = new Set(['number', 'equation', 'phrase', 'sentence']);
const feedbackTypes = new Set(['ready', 'correct_step', 'try_again', 'hint', 'solved']);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (status, message) => Object.assign(new Error(message), { status });

function normalizeCredentials(body, registering) {
  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';
  const password = body.password;
  if (!namePattern.test(name)) throw failure(400, '家庭账号请用 4–24 个英文字母、数字、下划线或短横线，以字母或数字开头。');
  if (typeof password !== 'string' || password.length < 8 || password.length > 64 || Buffer.byteLength(password) > 128) {
    throw failure(400, registering ? '请设置 8–64 个字符的密码。' : '请检查家庭账号和密码。');
  }
  return { name, password, id: sha256(name) };
}

function validateText(value, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) throw failure(400, '有一道题的文字格式不对，请重新打开题目本。');
  return value;
}

function normalizeTurn(turn) {
  if (!isObject(turn)) throw failure(400, '有一条解题记录的格式不对。');
  const value = {
    attempt: validateText(turn.attempt, 1000, ''),
    note: validateText(turn.note, 300, ''),
    task: validateText(turn.task, 300, ''),
    message: validateText(turn.message, 600, ''),
  };
  if (formats.has(turn.format)) value.format = turn.format;
  if (feedbackTypes.has(turn.feedback)) value.feedback = turn.feedback;
  if (Number.isSafeInteger(turn.hintLevel) && turn.hintLevel >= 0) value.hintLevel = turn.hintLevel;
  if (typeof turn.hasMoreHints === 'boolean') value.hasMoreHints = turn.hasMoreHints;
  if (Array.isArray(turn.choices) && turn.choices.length >= 2 && turn.choices.length <= 5 &&
      turn.choices.every((choice) => typeof choice === 'string' && choice.trim() && choice.length <= 24)) {
    value.choices = turn.choices;
  }
  return value;
}

function normalizeEntry(candidate, id, revision, now, imported = false) {
  if (!isObject(candidate) || candidate.id !== id || typeof candidate.solved !== 'boolean' ||
      !Array.isArray(candidate.turns) || !candidate.turns.length || candidate.turns.length > 250 ||
      ![0, 1, 2].includes(candidate.stage)) {
    throw failure(400, '有一道题的记录读不出来，请重新打开题目本。');
  }
  const createdAt = Number.isSafeInteger(candidate.createdAt) && candidate.createdAt > 0
    ? Math.min(candidate.createdAt, now)
    : now;
  const updatedAt = imported && Number.isSafeInteger(candidate.updatedAt)
    ? Math.max(createdAt, Math.min(candidate.updatedAt, now))
    : now;
  const problem = validateText(candidate.problem, 2400);
  if (!problem.trim()) throw failure(400, '题目本里有一道空白题。');
  const entry = {
    id, revision, createdAt, updatedAt, problem,
    token: candidate.token == null ? null : validateText(candidate.token, 34_000),
    stage: candidate.stage, solved: candidate.solved, example: candidate.example === true,
    expired: candidate.expired === true, turns: candidate.turns.map(normalizeTurn),
  };
  if (candidate.completionToken != null) entry.completionToken = validateText(candidate.completionToken, 34_000);
  if (candidate.parentId != null) {
    if (typeof candidate.parentId !== 'string' || !idPattern.test(candidate.parentId) || candidate.parentId === id) {
      throw failure(400, '这道挑战题找不到对应的原题。');
    }
    entry.parentId = candidate.parentId;
  }
  if (candidate.activityId != null || candidate.activityIndex != null) {
    if (!entry.parentId || !idPattern.test(candidate.activityId ?? '') ||
        !Number.isInteger(candidate.activityIndex) || candidate.activityIndex < 0 || candidate.activityIndex > 2) {
      throw failure(400, '这道练习的活动编号不完整。');
    }
    entry.activityId = candidate.activityId;
    entry.activityIndex = candidate.activityIndex;
  }
  if (candidate.challenge === true || entry.parentId) entry.challenge = true;
  return entry;
}

function verifiedCompletion(entry, verifyCompletion) {
  if (!entry.completionToken) return null;
  const proof = verifyCompletion(entry.completionToken);
  return proof?.entryId === entry.id && proof.problem === entry.problem ? proof : null;
}

function markChallenge(entry, prior, verifyCompletion) {
  const proof = verifiedCompletion(entry, verifyCompletion);
  if (prior?.challenge || proof?.parentId) {
    entry.challenge = true;
    entry.parentId = prior?.parentId || entry.parentId || proof?.parentId;
  }
  if (prior?.activityId || proof?.activityId) {
    entry.activityId = prior?.activityId || proof.activityId;
    entry.activityIndex = prior?.activityIndex ?? proof.activityIndex;
  }
}

function snapshot(journal) {
  const wardrobe = normalizeWardrobe(journal.wardrobe);
  const solvedCount = Object.keys(journal.awards).length;
  const earnedShells = journal.legacyShells + solvedCount + Object.keys(journal.activityBonuses || {}).length * 2;
  return {
    entries: Object.values(journal.entries),
    shells: Math.max(0, earnedShells - wardrobeSpent(wardrobe)),
    earnedShells,
    solvedCount,
    awardedActivityIds: Object.values(journal.activityBonuses || {}),
    wardrobe,
    revision: journal.revision,
  };
}

function importWardrobe(journal, source) {
  const requested = normalizeWardrobe(source);
  const current = normalizeWardrobe(journal.wardrobe);
  const skipped = [];
  let balance = snapshot(journal).shells;
  let changed = false;
  for (const item of WARDROBE_ITEMS) {
    if (!requested.owned.includes(item.id) || current.owned.includes(item.id)) continue;
    if (item.price > balance) {
      skipped.push(item.id);
      continue;
    }
    current.owned.push(item.id);
    balance -= item.price;
    changed = true;
  }
  for (const { id: slot } of WARDROBE_SLOTS) {
    const itemId = requested.equipped[slot];
    if (!itemId || !current.owned.includes(itemId) || current.equipped[slot] === itemId) continue;
    current.equipped[slot] = itemId;
    changed = true;
  }
  if (changed) {
    current.revision++;
    journal.wardrobe = current;
  }
  return skipped;
}

function validateChanges(changes) {
  if (!Array.isArray(changes) || changes.length > recordLimit) throw failure(400, '这次有太多题一起同步，请重新打开题目本。');
  const seen = new Set();
  for (const change of changes) {
    if (!isObject(change) || !idPattern.test(change.id ?? '') || !Number.isSafeInteger(change.revision) ||
        change.revision < 0 || !Object.hasOwn(change, 'entry') || seen.has(change.id)) {
      throw failure(400, '同步的记录格式不对，请重新打开题目本。');
    }
    seen.add(change.id);
  }
}

function conflictsFor(journal, changes) {
  return changes.filter((change) => {
    const existing = journal.entries[change.id];
    return journal.deleted[change.id] || (existing?.revision ?? 0) !== change.revision;
  }).map((change) => change.id);
}

function award(journal, entry, verifyCompletion) {
  if (!entry.solved || journal.awards[entry.id]) return false;
  if (entry.challenge) {
    const parent = journal.entries[entry.parentId];
    const proof = verifiedCompletion(entry, verifyCompletion);
    if (!proof?.parentId || proof.parentId !== entry.parentId || !parent || parent.challenge || parent.parentId) return false;
    if (!entry.activityId && !parent.solved) return false;
    const originalProof = verifiedCompletion(parent, verifyCompletion);
    const verifiedOriginal = originalProof && !originalProof.parentId;
    const verifiedArchive = proof.legacyParentProblem === parent.problem.trim();
    if (!(verifiedOriginal || verifiedArchive)) return false;
    if (entry.activityId) {
      if (proof.activityId !== entry.activityId || proof.activityIndex !== entry.activityIndex ||
          !idPattern.test(entry.activityId) || !Number.isInteger(entry.activityIndex) || entry.activityIndex < 0 || entry.activityIndex > 2) return false;
      const prior = journal.activityAwards?.[parent.id];
      if (prior && (prior.activityId !== entry.activityId || prior.entries[entry.activityIndex])) return false;
      const activity = prior || { activityId: entry.activityId, entries: {} };
      activity.entries[entry.activityIndex] = entry.id;
      (journal.activityAwards ??= {})[parent.id] = activity;
    } else {
      if (proof.activityId || journal.challengeAwards?.[parent.id]) return false;
      (journal.challengeAwards ??= {})[parent.id] = entry.id;
    }
  }
  journal.awards[entry.id] = true;
  return true;
}

function awardChanges(journal, touched, verifyCompletion) {
  const awarded = [];
  // A second device can send the challenge before the original finishes syncing.
  for (const entry of Object.values(journal.entries)) {
    if (!touched.has(entry.id) && !touched.has(entry.parentId)) continue;
    if (award(journal, entry, verifyCompletion)) awarded.push(entry.id);
  }
  return awarded;
}

function awardActivityBonuses(journal) {
  const rewarded = [];
  for (const [parentId, activity] of Object.entries(journal.activityAwards || {})) {
    if (journal.activityBonuses?.[parentId] || ![0, 1, 2].every((index) => journal.awards[activity.entries[index]])) continue;
    (journal.activityBonuses ??= {})[parentId] = activity.activityId;
    rewarded.push(parentId);
  }
  return rewarded;
}

function importDevice(journal, migration, now, touched, verifyCompletion) {
  if (!migration) return false;
  if (!isObject(migration) || !idPattern.test(migration.deviceId ?? '') ||
      !Array.isArray(migration.entries) || migration.entries.length > recordLimit ||
      !Number.isSafeInteger(migration.shells) || migration.shells < 0 || migration.shells > 100_000 ||
      (migration.challengeShells != null && (!Number.isSafeInteger(migration.challengeShells) ||
        migration.challengeShells < 0 || migration.challengeShells > migration.shells)) ||
      (migration.activityBonusShells != null && (!Number.isSafeInteger(migration.activityBonusShells) ||
        migration.activityBonusShells < 0 || migration.activityBonusShells > migration.shells || migration.activityBonusShells % 2))) {
    throw failure(400, '这台设备的旧记录格式不对，暂时无法导入。');
  }
  if (journal.devices[migration.deviceId]) return false;
  if (Object.keys(journal.devices).length >= 200) throw failure(413, '这个家庭已导入太多设备。');
  const imported = new Set();
  let originalSolved = 0;
  let challengesSolved = 0;
  const activities = new Map();
  for (const source of migration.entries) {
    if (!isObject(source) || !idPattern.test(source.id ?? '') || imported.has(source.id)) {
      throw failure(400, '有一道旧题读不出来，请检查题目本。');
    }
    imported.add(source.id);
    const entry = normalizeEntry(source, source.id, 1, now, true);
    markChallenge(entry, journal.entries[entry.id], verifyCompletion);
    if (entry.solved) {
      if (entry.challenge) challengesSolved++;
      else originalSolved++;
      if (entry.activityId) {
        const proof = verifiedCompletion(entry, verifyCompletion);
        if (proof?.activityId === entry.activityId && proof.activityIndex === entry.activityIndex && proof.parentId === entry.parentId) {
          const key = entry.parentId + '/' + entry.activityId;
          if (!activities.has(key)) activities.set(key, new Set());
          activities.get(key).add(entry.activityIndex);
        }
      }
    }
    if (journal.entries[entry.id] || journal.deleted[entry.id]) continue;
    journal.entries[entry.id] = entry;
    touched.add(entry.id);
  }
  // Only ordinary historical shells may enter anonymously. Bonuses are verified
  // and deduplicated by their original question when awarded.
  const bonuses = Math.max(migration.challengeShells || 0, challengesSolved);
  const completedActivities = [...activities.values()].filter((indices) => [0, 1, 2].every((index) => indices.has(index))).length;
  const activityBonusShells = Math.max(migration.activityBonusShells || 0, completedActivities * 2);
  journal.legacyShells = Math.max(journal.legacyShells, migration.shells - originalSolved - bonuses - activityBonusShells);
  journal.devices[migration.deviceId] = true;
  return true;
}

function setCookie(res, token, secure, cookiePath) {
  const maxAge = token ? Math.floor(sessionAge / 1000) : 0;
  const attributes = `Path=${cookiePath}; HttpOnly; SameSite=Strict`;
  res.setHeader('Set-Cookie', `${cookieName}=${token}; ${attributes}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

function readCookie(req) {
  const value = (req.headers.cookie || '').match(/(?:^|;\s*)yuyu_family=([^;]+)/)?.[1];
  return value?.match(signedCookiePattern);
}

function emptyFamily(name, salt, passwordHash) {
  return {
    name, salt, passwordHash, sessions: {},
    journal: { entries: {}, deleted: {}, awards: {}, devices: {}, legacyShells: 0, revision: 0 },
  };
}

export function createFamilyHandler({
  directory, secureCookies = true, cookiePath = process.env.YUYU_COOKIE_PATH || '/',
  verifyCompletion = () => null,
} = {}) {
  const locks = new Map();
  const limits = new Map();
  const dummySalt = randomBytes(16).toString('hex');
  let registrationDay = 0;
  let registrations = 0;
  let hashing = 0;
  let active = 0;
  let familyCount;
  let ready;
  let leaderboardCache;
  let leaderboardTask;
  let leaderboardVersion = 0;

  async function lock(id, task) {
    const previous = locks.get(id) || Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    locks.set(id, run);
    try {
      return await run;
    } finally {
      if (locks.get(id) === run) locks.delete(id);
    }
  }

  async function read(id) {
    await (ready ||= mkdir(directory, { recursive: true, mode: 0o700 }).catch((error) => {
      ready = undefined;
      throw error;
    }));
    try {
      return JSON.parse(await readFile(join(directory, id + '.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function write(id, family) {
    const data = JSON.stringify(family);
    if (Buffer.byteLength(data) > journalBytes || Object.keys(family.journal.entries).length > recordLimit) {
      throw failure(413, '家庭题目本空间满了。整理掉几道旧题后，再同步这道题。');
    }
    const file = join(directory, id + '.json');
    const temporary = file + '.' + randomBytes(10).toString('hex') + '.tmp';
    try {
      const writer = await open(temporary, 'wx', 0o600);
      try {
        await writer.writeFile(data);
        await writer.sync();
      } finally {
        await writer.close();
      }
      await rename(temporary, file);
      leaderboardVersion++;
      leaderboardCache = undefined;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  function checkLimit(key, maximum, duration) {
    const now = Date.now();
    if (limits.size > 4000) {
      for (const [address, bucket] of limits) if (bucket.until <= now) limits.delete(address);
      if (limits.size > 5000 && !limits.has(key)) throw failure(429, '现在请求有点多，过一会儿再试。');
    }
    const existing = limits.get(key);
    const bucket = existing?.until > now ? existing : { until: now + duration, count: 0 };
    if (bucket.count >= maximum) throw failure(429, '试的次数有点多，请稍后再试。');
    bucket.count++;
    limits.set(key, bucket);
  }

  async function derivePassword(password, salt) {
    if (hashing >= 2) throw failure(429, '现在登录的人有点多，请过几秒再试。');
    hashing++;
    try {
      return await derive(password, Buffer.from(salt, 'hex'), 64, settings);
    } finally {
      hashing--;
    }
  }

  function newSession(family) {
    const now = Date.now();
    const sessions = Object.entries(family.sessions).filter(([, expiry]) => expiry > now);
    family.sessions = Object.fromEntries(sessions.sort((a, b) => b[1] - a[1]).slice(0, 11));
    const secret = randomBytes(32).toString('base64url');
    family.sessions[sha256(secret)] = now + sessionAge;
    return secret;
  }

  async function authenticate(action, req, res, body, json) {
    const ip = req.headers['x-real-ip'] || req.socket.remoteAddress || '';
    const { id, name, password } = normalizeCredentials(body, action === 'register');
    checkLimit('auth:' + ip, 20, hour);
    if (action === 'register') {
      checkLimit('register:' + ip, 6, hour);
      const today = Math.floor(Date.now() / (hour * 24));
      if (today !== registrationDay) {
        registrationDay = today;
        registrations = 0;
      }
      if (registrations >= 100) throw failure(429, '今天创建的家庭账号有点多，请明天再试。');
      registrations++;
    } else {
      checkLimit('login:' + id, 12, hour);
    }
    async function openSession() {
      let family = await read(id);
      if (action === 'register') {
        if (family) throw failure(409, '这个家庭账号已经有人用了，试试换一个。');
        familyCount ??= (await readdir(directory)).filter((filename) => /^[a-f0-9]{64}\.json$/.test(filename)).length;
        if (familyCount >= familyLimit) throw failure(429, '家庭账号名额已满。');
        const salt = randomBytes(16).toString('hex');
        const passwordHash = (await derivePassword(password, salt)).toString('hex');
        family = emptyFamily(name, salt, passwordHash);
      } else {
        const expected = Buffer.from(family?.passwordHash ?? '00'.repeat(64), 'hex');
        const supplied = await derivePassword(password, family?.salt ?? dummySalt);
        if (!timingSafeEqual(expected, supplied) || !family) {
          throw failure(401, '家庭账号或密码不对，再看看。');
        }
      }
      const secret = newSession(family);
      await write(id, family);
      if (action === 'register') familyCount++;
      return secret;
    }
    const secret = action === 'register'
      ? await lock('register', () => lock(id, openSession))
      : await lock(id, openSession);
    setCookie(res, id + '.' + secret, secureCookies, cookiePath);
    return json(res, 200, { family: { name } });
  }

  async function sync(id, family, body, res, json) {
    const changes = body.changes ?? [];
    validateChanges(changes);
    const journal = family.journal;
    const conflicts = conflictsFor(journal, changes);
    if (conflicts.length) {
      return json(res, 409, { error: '另一台设备刚刚更新了这道题，已取回最新记录。', conflicts, ...snapshot(journal) });
    }
    const now = Date.now();
    const touched = new Set();
    for (const change of changes) {
      if (change.entry === null) {
        if (!journal.entries[change.id]) continue;
        delete journal.entries[change.id];
        journal.deleted[change.id] = true;
        continue;
      }
      const entry = normalizeEntry(change.entry, change.id, change.revision + 1, now);
      markChallenge(entry, journal.entries[change.id], verifyCompletion);
      journal.entries[change.id] = entry;
      touched.add(entry.id);
    }
    const migrated = importDevice(journal, body.migration, now, touched, verifyCompletion);
    const awarded = awardChanges(journal, touched, verifyCompletion);
    const activityBonusAwarded = awardActivityBonuses(journal);
    const skippedWardrobeItems = migrated ? importWardrobe(journal, body.migration.wardrobe) : [];
    if (changes.length || migrated) {
      journal.revision++;
      await write(id, family);
    }
    return json(res, 200, { ...snapshot(journal), awarded, activityBonusAwarded, skippedWardrobeItems });
  }

  async function purchase(id, family, body, res, json) {
    const item = WARDROBE_ITEMS.find((item) => item.id === body.itemId);
    if (!item) throw failure(400, '这个道具还没上架。');
    const journal = family.journal;
    const current = snapshot(journal);
    const wardrobe = current.wardrobe;
    const purchased = !wardrobe.owned.includes(item.id);
    if (purchased && current.shells < item.price) {
      return json(res, 409, { ...current, error: `还差 ${item.price - current.shells} 枚贝壳，解开几道题再来吧。` });
    }
    if (purchased || wardrobe.equipped[item.slot] !== item.id) {
      if (purchased) wardrobe.owned.push(item.id);
      wardrobe.equipped[item.slot] = item.id;
      wardrobe.revision++;
      journal.wardrobe = wardrobe;
      journal.revision++;
      await write(id, family);
    }
    return json(res, 200, { ...snapshot(journal), purchased });
  }

  async function equip(id, family, body, res, json) {
    if (!WARDROBE_SLOTS.some((slot) => slot.id === body.slot)) throw failure(400, '这个位置戴不了道具。');
    const journal = family.journal;
    const current = snapshot(journal);
    const itemId = body.itemId;
    if (itemId !== null) {
      const item = WARDROBE_ITEMS.find((item) => item.id === itemId && item.slot === body.slot);
      if (!item || !current.wardrobe.owned.includes(itemId)) throw failure(409, '先兑换这个道具，就能给小鱼戴上。');
    }
    if (current.wardrobe.equipped[body.slot] === itemId) return json(res, 200, current);
    const wardrobe = current.wardrobe;
    wardrobe.equipped[body.slot] = itemId;
    wardrobe.revision++;
    journal.wardrobe = wardrobe;
    journal.revision++;
    await write(id, family);
    return json(res, 200, snapshot(journal));
  }

  async function handleFamily(req, res, action, readJson, json) {
    const isRead = req.method === 'GET' && (action === 'session' || action === 'journal');
    const isWrite = req.method === 'POST' && ['register', 'login', 'logout', 'sync', 'purchase', 'equip'].includes(action);
    if (!isRead && !isWrite) throw failure(404, '找不到这个家庭账号操作。');
    if (isWrite && (req.headers['x-yuyu-family'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site' ||
        req.headers['sec-fetch-site'] === 'same-site')) {
      throw failure(403, '请从鱼渔页面提交。');
    }
    if (!directory) {
      if (action === 'session') return json(res, 200, { family: null });
      throw failure(503, '家庭同步服务还没准备好。');
    }
    const body = isWrite ? await readJson(req) : null;
    if (action === 'login' || action === 'register') return await authenticate(action, req, res, body, json);
    const cookie = readCookie(req);
    if (!cookie) {
      if (action === 'logout') setCookie(res, '', secureCookies, cookiePath);
      if (action === 'session' || action === 'logout') return json(res, 200, { family: null });
      throw failure(401, '请先登录你的家庭账号。');
    }
    const [, id, secret] = cookie;
    const sessionHash = sha256(secret);
    return await lock(id, async () => {
      const family = await read(id);
      const signedIn = Number(family?.sessions[sessionHash]) > Date.now();
      if (action === 'session') return json(res, 200, { family: signedIn ? { name: family.name } : null });
      if (signedIn && req.headers['x-yuyu-family-name'] !== family.name) {
        throw failure(401, '当前浏览器切换了家庭账号，请重新登录。');
      }
      if (action === 'logout') {
        if (signedIn) {
          delete family.sessions[sessionHash];
          await write(id, family);
        }
        setCookie(res, '', secureCookies, cookiePath);
        return json(res, 200, { family: null });
      }
      if (!signedIn) throw failure(401, '请先登录你的家庭账号。');
      checkLimit('journal:' + id, 180, 60_000);
      if (action === 'journal') return json(res, 200, snapshot(family.journal));
      if (action === 'purchase') return await purchase(id, family, body, res, json);
      if (action === 'equip') return await equip(id, family, body, res, json);
      return await sync(id, family, body, res, json);
    });
  }

  async function withCapacity(task) {
    if (active >= 8) throw failure(429, '家庭同步有点忙，请稍后再试。');
    active++;
    try {
      return await task();
    } finally {
      active--;
    }
  }

  const handle = (req, res, action, readJson, json) =>
    withCapacity(() => handleFamily(req, res, action, readJson, json));

  async function loadLeaderboard() {
    if (!directory) return { entries: [], updatedAt: Date.now() };
    if (leaderboardCache && Date.now() - leaderboardCache.updatedAt < 30_000) return leaderboardCache;
    if (leaderboardTask) return leaderboardTask;
    const version = leaderboardVersion;
    const pending = (async () => {
      await (ready ||= mkdir(directory, { recursive: true, mode: 0o700 }));
      const files = (await readdir(directory)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort();
      const entries = [];
      for (const filename of files) {
        const id = filename.slice(0, -5);
        const family = await read(id);
        if (!family?.journal?.awards) continue;
        entries.push({ id, solvedCount: Object.keys(family.journal.awards).length });
      }
      entries.sort((a, b) => b.solvedCount - a.solvedCount || a.id.localeCompare(b.id));
      return { entries, updatedAt: Date.now() };
    })();
    leaderboardTask = pending;
    try {
      const result = await pending;
      if (version === leaderboardVersion) leaderboardCache = result;
      return result;
    } finally {
      if (leaderboardTask === pending) leaderboardTask = undefined;
    }
  }

  handle.leaderboard = async (req) => withCapacity(async () => {
    const ip = req.headers['x-real-ip'] || req.socket.remoteAddress || '';
    checkLimit('leaderboard:' + ip, 60, 60_000);
    const cookie = readCookie(req);
    let currentId;
    if (directory && cookie) {
      const [, id, secret] = cookie;
      const family = await read(id);
      if (Number(family?.sessions[sha256(secret)]) > Date.now()) currentId = id;
    }
    const leaderboard = await loadLeaderboard();
    const display = (entry, index) => ({
      rank: index + 1,
      displayName: '珊瑚小鱼·' + entry.id.slice(0, 6).toUpperCase(),
      solvedCount: entry.solvedCount,
      isYou: entry.id === currentId,
    });
    const ownIndex = leaderboard.entries.findIndex((entry) => entry.id === currentId);
    return {
      leaders: leaderboard.entries.slice(0, 20).map(display),
      you: ownIndex < 0 ? null : display(leaderboard.entries[ownIndex], ownIndex),
      updatedAt: leaderboard.updatedAt,
    };
  });

  handle.completedOriginal = async (req, parentId) => {
    const cookie = readCookie(req);
    if (!directory || !cookie) return null;
    const [, id, secret] = cookie;
    const sessionHash = sha256(secret);
    return withCapacity(() => lock(id, async () => {
      const family = await read(id);
      if (!(Number(family?.sessions[sessionHash]) > Date.now())) return null;
      checkLimit('journal:' + id, 180, 60_000);
      if (typeof parentId !== 'string' || !idPattern.test(parentId)) return false;
      const entry = family.journal.entries[parentId];
      if (!entry?.solved || entry.challenge || entry.parentId) return false;
      const { id: entryId, problem, solved, challenge, parentId: originalParent } = entry;
      return { id: entryId, problem, solved, challenge, parentId: originalParent };
    }));
  };
  return handle;
}
