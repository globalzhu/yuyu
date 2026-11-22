import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const fail = (status, message) => Object.assign(new Error(message), { status });

export function createAdmin(families, verifier = process.env.YUYU_ADMIN_VERIFIER) {
  const sessions = new Map();
  const attempts = new Map();
  let deriving = 0;
  const hour = 3600_000;
  const path = (process.env.YUYU_COOKIE_PATH || '/').replace(/\/$/, '') + '/api/admin';
  const cookie = (res, value, seconds) => res.setHeader('Set-Cookie',
    'yuyu_admin=' + value + '; HttpOnly; Secure; SameSite=Strict; Path=' + path + '; Max-Age=' + seconds);

  return async (req, res, action, readJson, json) => {
    const now = Date.now();
    const token = (req.headers.cookie || '').match(/(?:^|;\s*)yuyu_admin=([a-f0-9]{64})(?:;|$)/)?.[1];
    const signedIn = (sessions.get(token) || 0) > now;
    if (req.method === 'GET' && action === 'session') return json(res, 200, { signedIn });
    if (req.method === 'GET' && action === 'families' && signedIn) return json(res, 200, { families: await families.adminList() });
    if (req.method === 'POST' && (req.headers['x-yuyu-admin'] !== '1' ||
        ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']))) throw fail(403, '请在管理后台操作。');
    if (req.method === 'POST' && action === 'login') {
      if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(verifier || '')) throw fail(503, '后台登录暂未配置。');
      for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
      const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
      const bucket = attempts.get(ip) || { count: 0, until: now + 15 * 60_000 };
      if (bucket.count >= 8 || attempts.size > 2000) throw fail(429, '尝试次数较多，请稍后再登录。');
      bucket.count++;
      attempts.set(ip, bucket);
      const body = await readJson(req);
      const [salt, hash] = verifier.split(':');
      if (body.name !== 'admin' || typeof body.password !== 'string' || body.password.length > 128) {
        throw fail(401, '管理员账号或密码不正确。');
      }
      if (deriving >= 2) throw fail(429, '请稍后再登录。');
      deriving++;
      try {
        const actual = await derive(body.password, Buffer.from(salt, 'hex'), 64);
        if (!timingSafeEqual(actual, Buffer.from(hash, 'hex'))) throw fail(401, '管理员账号或密码不正确。');
      } finally {
        deriving--;
      }
      attempts.delete(ip);
      for (const [key, expiry] of sessions) if (expiry <= now) sessions.delete(key);
      if (token) sessions.delete(token);
      if (sessions.size >= 20) sessions.delete(sessions.keys().next().value);
      const next = randomBytes(32).toString('hex');
      sessions.set(next, now + 4 * hour);
      cookie(res, next, 4 * 3600);
      return json(res, 200, { signedIn: true });
    }
    if (!signedIn) throw fail(401, '请登录管理员账号。');
    if (req.method === 'POST' && action === 'logout') {
      sessions.delete(token);
      cookie(res, '', 0);
      return json(res, 200, { signedIn: false });
    }
    if (req.method === 'GET' && action === 'catalog') return json(res, 200, { gifts: await families.catalog() });
    if (req.method === 'POST' && action === 'gift') return json(res, 200, await families.saveGift(await readJson(req)));
    if (req.method === 'POST' && action === 'moderate') return json(res, 200, await families.adminModerate(await readJson(req)));
    throw fail(404, '未找到这项管理功能。');
  };
}
