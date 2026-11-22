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
  return { name, password };
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
  if ([0, 1, 2].includes(turn.stage)) value.stage = turn.stage;
  if (turn.resumeToken) value.resumeToken = validateText(turn.resumeToken, 34_000);
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
  const grants = journal.grants || [];
  const giftSpent = (journal.orders || []).reduce((n, order) => n + (order.status === 'refunded' ? 0 : order.price), 0);
  const earnedShells = grants.reduce((n, grant) => n + grant.amount, 0) + journal.legacyShells + solvedCount + Object.keys(journal.activityBonuses || {}).length * 2;
  return {
    entries: Object.values(journal.entries),
    shells: Math.max(0, earnedShells - wardrobeSpent(wardrobe) - giftSpent),
    giftSpent,
    earnedShells,
    solvedCount,
    awardedActivityIds: Object.values(journal.activityBonuses || {}),
    wardrobe,
    revision: journal.revision,
  };
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
  const proof = verifiedCompletion(entry, verifyCompletion);
  if (!proof) return false;
  if (entry.challenge) {
    const parent = journal.entries[entry.parentId];
    if (!proof.parentId || proof.parentId !== entry.parentId || !parent || parent.challenge || parent.parentId) return false;
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

function publicNickname(family, id) {
  return family.nickname || '珊瑚小鱼·' + id.slice(0, 6).toUpperCase();
}

function sessionProfile(family, id) {
  return { name: family.name, storageName: family.formerNames?.[0] || family.name, nickname: publicNickname(family, id), hasRecovery: Boolean(family.recoveryHash) };
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

  // The on-disk identity stays stable when a login name changes. Reserve old
  // names so that queued work on an older device cannot reach another family.
  let nameIndex;
  async function names() {
    if (!nameIndex) nameIndex = (async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const map = new Map();
      for (const file of await readdir(directory)) {
        if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
        const id = file.slice(0, -5);
        const family = await read(id);
        for (const name of [family.name, ...(family.formerNames || [])]) map.set(name, id);
      }
      return map;
    })().catch(error => { nameIndex = undefined; throw error; });
    return nameIndex;
  }

  async function write(id, family) {
    const data = JSON.stringify(family);
    if (Buffer.byteLength(data) > journalBytes || (family.journal && Object.keys(family.journal.entries).length > recordLimit)) {
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
      leaderboardTask = undefined;
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
    const { name, password } = normalizeCredentials(body, action === 'register');
    const index = await names();
    const id = index.get(name) || sha256(name);
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
        if (family || index.has(name)) throw failure(409, '这个家庭账号已经有人用了，试试换一个。');
        familyCount ??= (await readdir(directory)).filter((filename) => /^[a-f0-9]{64}\.json$/.test(filename)).length;
        if (familyCount >= familyLimit) throw failure(429, '家庭账号名额已满。');
        const salt = randomBytes(16).toString('hex');
        const passwordHash = (await derivePassword(password, salt)).toString('hex');
        family = emptyFamily(name, salt, passwordHash);
      } else {
        const expected = Buffer.from(family?.passwordHash ?? '00'.repeat(64), 'hex');
        const supplied = await derivePassword(password, family?.salt ?? dummySalt);
        if (!timingSafeEqual(expected, supplied) || family?.name !== name) {
          throw failure(401, '家庭账号或密码不对，再看看。');
        }
      }
      const secret = newSession(family);
      await write(id, family);
      if (action === 'register') { familyCount++; index.set(name, id); }
      return { secret, profile: sessionProfile(family, id) };
    }
    const { secret, profile } = action === 'register'
      ? await lock('register', () => lock(id, openSession))
      : await lock(id, openSession);
    setCookie(res, id + '.' + secret, secureCookies, cookiePath);
    return json(res, 200, { family: profile });
  }

  async function replacePassword(id, family, password, res, json, recovering) {
    const salt = randomBytes(16).toString('hex');
    family.passwordHash = (await derivePassword(password, salt)).toString('hex');
    family.salt = salt;
    family.sessions = {};
    if (recovering) delete family.recoveryHash;
    const secret = newSession(family);
    await write(id, family);
    setCookie(res, id + '.' + secret, secureCookies, cookiePath);
    return json(res, 200, { family: sessionProfile(family, id) });
  }

  async function recover(req, body, res, json) {
    const { name, password } = normalizeCredentials({ name: body.name, password: body.newPassword }, true);
    const id = (await names()).get(name) || sha256(name);
    checkLimit('recover-ip:' + (req.headers['x-real-ip'] || req.socket.remoteAddress), 20, hour);
    checkLimit('recover-account:' + id, 10, hour);
    const code = String(body.code || '').replace(/[\s-]/g, '').toUpperCase();
    return lock(id, async () => {
      const family = await read(id);
      if (!/^[0-9A-F]{32}$/.test(code) || family?.name !== name || !family.recoveryHash ||
          !timingSafeEqual(Buffer.from(sha256(code), 'hex'), Buffer.from(family.recoveryHash, 'hex'))) {
        throw failure(400, '账号名或找回码不匹配，请核对家长保存的那一组。');
      }
      return replacePassword(id, family, password, res, json, true);
    });
  }

  async function managePassword(action, id, family, body, res, json) {
    checkLimit('manage-password:' + id, 15, hour);
    const { password } = normalizeCredentials({ name: family.name, password: body.currentPassword }, false);
    const supplied = await derivePassword(password, family.salt);
    if (!timingSafeEqual(supplied, Buffer.from(family.passwordHash, 'hex'))) throw failure(400, '当前密码不正确。');
    if (action === 'recovery-code') {
      const code = randomBytes(16).toString('hex').toUpperCase();
      family.recoveryHash = sha256(code);
      await write(id, family);
      return json(res, 200, { code: code.match(/.{4}/g).join('-') });
    }
    const next = normalizeCredentials({ name: family.name, password: body.newPassword }, true);
    if (next.password === password) throw failure(400, '请设置一个与当前密码不同的新密码。');
    return replacePassword(id, family, next.password, res, json, false);
  }

  async function sync(id, family, body, res, json) {
    if (body.migration) throw failure(400, '访客模式已关闭，请刷新后登录家庭账号。');
    const changes = body.changes ?? [];
    validateChanges(changes);
    const journal = family.journal;
    const conflicts = conflictsFor(journal, changes);
    if (conflicts.length) {
      return json(res, 409, { error: '另一台设备刚刚更新了这道题，已取回最新记录。', conflicts, ...snapshot(journal) });
    }
    const verify = token => verifyCompletion(token, id);
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
      markChallenge(entry, journal.entries[change.id], verify);
      journal.entries[change.id] = entry;
      touched.add(entry.id);
    }
    const awarded = awardChanges(journal, touched, verify);
    const activityBonusAwarded = awardActivityBonuses(journal);
    if (changes.length) {
      journal.revision++;
      await write(id, family);
    }
    return json(res, 200, { ...snapshot(journal), awarded, activityBonusAwarded });
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
    const isRead = req.method === 'GET' && (action === 'session' || action === 'journal' || action === 'gifts');
    const isWrite = req.method === 'POST' && ['register', 'login', 'logout', 'sync', 'purchase', 'equip', 'password', 'recovery-code', 'recover', 'nickname', 'redeem', 'restore-history'].includes(action);
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
    if (action === 'recover') return await recover(req, body, res, json);
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
      if (action === 'session') return json(res, 200, { family: signedIn ? sessionProfile(family, id) : null });
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
      if (action === 'password' || action === 'recovery-code') return managePassword(action, id, family, body, res, json);
      checkLimit('journal:' + id, 180, 60_000);
      if (action === 'nickname') {
        const nickname = typeof body.nickname === 'string' ? body.nickname.normalize('NFKC').trim() : '';
        if (!/^[\p{L}\p{N} ·_-]{1,16}$/u.test(nickname) || !/[\p{L}\p{N}]/u.test(nickname)) {
          throw failure(400, '昵称请用 1–16 个字，可用中英文、数字、空格、间隔点、下划线和短横线。');
        }
        if (nickname.toLowerCase() === family.name) throw failure(400, '给学习榜另取一个小名吧，家庭登录名由你自己保管。');
        family.nickname = nickname;
        await write(id, family);
        return json(res, 200, { family: sessionProfile(family, id) });
      }
      if (action === 'restore-history') {
        if (!Array.isArray(body.entries) || body.entries.length > recordLimit) throw failure(400, '旧题目本格式不正确。');
        const journal = family.journal;
        const now = Date.now();
        let restored = 0;
        for (const source of body.entries) {
          if (!isObject(source) || !idPattern.test(source.id || '')) throw failure(400, '旧题目编号有误。');
          if (journal.entries[source.id] || journal.deleted[source.id]) continue;
          journal.entries[source.id] = normalizeEntry(source, source.id, 1, now, true);
          restored++;
        }
        if (restored) {
          journal.revision++;
          await write(id, family);
        }
        return json(res, 200, { ...snapshot(journal), restored });
      }
      if (action === 'gifts') {
        const catalog = await readCatalog();
        return json(res, 200, { gifts: catalog.filter(gift => gift.active), orders: family.journal.orders || [], grants: family.journal.grants || [] });
      }
      if (action === 'redeem') {
        if (!idPattern.test(body.requestId || '')) throw failure(400, '请重新打开礼物。');
        const orders = (family.journal.orders ??= []);
        const prior = orders.find(order => order.id === body.requestId);
        if (prior && (prior.giftId !== body.giftId || prior.price !== body.price)) throw failure(409, '这次兑换请求已经处理，请重新选择礼物。');
        if (!prior) {
          const gift = (await readCatalog()).find(item => item.id === body.giftId && item.active);
          if (!gift || gift.price !== body.price) throw failure(409, '礼物已更新，请刷新后再选。');
          if (snapshot(family.journal).shells < gift.price) throw failure(409, '贝壳还不够，先攒一攒吧。');
          orders.push({ id: body.requestId, giftId: gift.id, title: gift.title, price: gift.price, status: 'pending', at: Date.now() });
          family.journal.revision++;
          await write(id, family);
        }
        return json(res, 200, snapshot(family.journal));
      }
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
        if (!family?.journal?.awards || family.hideFromLeaderboard) continue;
        entries.push({ id, displayName: publicNickname(family, id), equipped: normalizeWardrobe(family.journal.wardrobe).equipped, solvedCount: Object.keys(family.journal.awards).length });
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

  async function sessionId(req) {
    const cookie = readCookie(req);
    if (!directory || !cookie) return null;
    const [, id, secret] = cookie;
    const family = await read(id);
    return Number(family?.sessions[sha256(secret)]) > Date.now() ? id : null;
  }

  handle.sessionId = req => withCapacity(() => sessionId(req));
  handle.leaderboard = async (req) => withCapacity(async () => {
    const currentId = await sessionId(req);
    if (!currentId) throw failure(401, '请先登录家庭账号。');
    const ip = req.headers['x-real-ip'] || req.socket.remoteAddress || '';
    checkLimit('leaderboard:' + ip, 60, 60_000);
    const leaderboard = await loadLeaderboard();
    const display = (entry, index) => ({
      rank: index + 1,
      displayName: entry.displayName,
      equipped: entry.equipped,
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

  async function readCatalog() {
    return (await read('gift-catalog'))?.gifts || [];
  }
  handle.catalog = readCatalog;
  handle.saveGift = body => lock('gift-catalog', async () => {
    if (!idPattern.test(body.id || '') || typeof body.title !== 'string' || !body.title.trim() ||
        body.title.length > 40 || !Number.isSafeInteger(body.price) || body.price < 1 || body.price > 10000 ||
        typeof body.active !== 'boolean') throw failure(400, '请填写礼物名称和 1–10000 枚的整数价格。');
    const gifts = await readCatalog();
    const gift = { id: body.id, title: body.title.trim(), price: body.price, active: body.active };
    const index = gifts.findIndex(item => item.id === gift.id);
    if (index >= 0) gifts[index] = gift;
    else gifts.push(gift);
    await write('gift-catalog', { gifts });
    return { ok: true };
  });
  // These methods are only exposed through the authenticated admin router.
  handle.adminList = () => withCapacity(async () => {
    if (!directory) throw failure(503, '账号服务暂不可用。');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const rows = [];
    for (const filename of (await readdir(directory)).filter((value) => /^[a-f0-9]{64}\.json$/.test(value))) {
      const id = filename.slice(0, -5);
      const family = await read(id);
      const { shells, solvedCount } = snapshot(family.journal);
      rows.push({ name: family.name, nickname: publicNickname(family, id), customNickname: Boolean(family.nickname),
        hidden: Boolean(family.hideFromLeaderboard), shells, solvedCount, orders: family.journal.orders || [], grants: family.journal.grants || [] });
    }
    return rows.sort((a, b) => b.solvedCount - a.solvedCount || a.name.localeCompare(b.name));
  });
  handle.adminModerate = (body) => withCapacity(async () => {
    const actions = ['hide', 'show', 'reset-nickname', 'revoke-sessions', 'rename', 'reset-password', 'grant', 'deliver', 'refund'];
    if (!namePattern.test(body.name || '') || !actions.includes(body.operation)) throw failure(400, '请选择账号和管理操作。');
    const index = await names();
    const id = index.get(body.name);
    if (!id) throw failure(404, '找不到这个账号。');
    const change = () => lock(id, async () => {
      const family = await read(id);
      if (family?.name !== body.name) throw failure(409, '账号名已更新，请刷新。');
      const journal = family.journal;
      if (body.operation === 'rename') {
        const name = typeof body.value === 'string' ? body.value.trim().toLowerCase() : '';
        if (!namePattern.test(name)) throw failure(400, '登录名须为 4–24 个字母、数字、下划线或短横线，以字母或数字开头。');
        if (index.has(name) && index.get(name) !== id) throw failure(409, '这个登录名已被使用。');
        if (name === family.name) return;
        const former = (family.formerNames ??= []);
        if (!former.includes(family.name)) former.push(family.name);
        family.name = name;
        family.sessions = {};
      } else if (body.operation === 'reset-password') {
        const { password } = normalizeCredentials({ name: family.name, password: body.value }, true);
        family.salt = randomBytes(16).toString('hex');
        family.passwordHash = (await derivePassword(password, family.salt)).toString('hex');
        family.sessions = {};
        delete family.recoveryHash;
      } else if (body.operation === 'grant') {
        if (!idPattern.test(body.requestId || '') || !Number.isSafeInteger(body.amount) || body.amount < 1 || body.amount > 10000 ||
            typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 80) throw failure(400, '请输入 1–10000 枚贝壳和赠送原因。');
        const grants = (journal.grants ??= []);
        const prior = grants.find(grant => grant.id === body.requestId);
        if (prior) {
          if (prior.amount !== body.amount || prior.reason !== body.reason.trim()) throw failure(409, '这次赠送已经处理，请刷新记录。');
          return;
        }
        grants.push({ id: body.requestId, amount: body.amount, reason: body.reason.trim(), at: Date.now() });
        journal.revision++;
      } else if (body.operation === 'deliver' || body.operation === 'refund') {
        const order = journal.orders?.find(order => order.id === body.orderId);
        if (!order) throw failure(404, '未找到兑换记录。');
        const status = body.operation === 'deliver' ? 'delivered' : 'refunded';
        if (order.status === status) return;
        if (order.status !== 'pending') throw failure(409, '这笔兑换已处理，请刷新。');
        order.status = status;
        order.updatedAt = Date.now();
        journal.revision++;
      } else if (body.operation === 'reset-nickname') delete family.nickname;
      else if (body.operation === 'revoke-sessions') family.sessions = {};
      else family.hideFromLeaderboard = body.operation === 'hide';
      await write(id, family);
      if (body.operation === 'rename') index.set(family.name, id);
    });
    if (body.operation === 'rename') await lock('register', change);
    else await change();
    return { ok: true };
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
