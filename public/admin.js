const el = id => document.getElementById(id);
const operations = {
  show: ['恢复上榜', '这个家庭将重新出现在学习榜。'],
  hide: ['暂时下榜', '这个家庭的成绩将暂时从学习榜隐藏，做题和领奖可以照常进行。'],
  'reset-nickname': ['恢复默认昵称', '学习榜将显示系统分配的小鱼昵称。家庭可以重新取名。'],
  'revoke-sessions': ['退出所有设备', '这个家庭的设备都需要重新登录，学习进度和贝壳会保留。'],
};
let rows = [];
let pending;
let working = false;

function identity(signedIn) {
  el('access').hidden = signedIn;
  el('dashboard').hidden = !signedIn;
  if (!signedIn) {
    rows = [];
    pending = null;
    el('list').replaceChildren();
    el('search').value = el('password').value = '';
    if (el('confirm').open) el('confirm').close();
  }
}

async function api(action, body) {
  const response = await fetch('api/admin/' + action, {
    cache: 'no-store',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Yuyu-Admin': '1' }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (response.status === 401) identity(false);
  if (!response.ok) throw new Error(data.error || '操作失败，请重试。');
  return data;
}

function part(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function render() {
  el('families-count').textContent = rows.length;
  el('solved-count').textContent = rows.reduce((n, row) => n + row.solvedCount, 0);
  el('visible-count').textContent = rows.filter(row => !row.hidden).length;
  const query = el('search').value.trim().toLowerCase();
  const shown = rows.filter(row => (row.name + ' ' + row.nickname).toLowerCase().includes(query));
  const list = el('list');
  list.replaceChildren();
  if (!shown.length) list.append(part('p', query ? '没有找到匹配的家庭。' : '还没有家庭账号。'));
  for (const row of shown) {
    const article = part('article', '', 'family');
    const info = part('div', '', 'profile');
    info.append(part('strong', row.nickname), part('span', row.hidden ? '已下榜' : '上榜中', 'flag'), part('small', '登录账号 · ' + row.name));
    const score = part('div', '答对 ' + row.solvedCount + ' 题 · 可用贝壳 ' + row.shells + ' 枚', 'score');
    const actions = part('div', '', 'actions');
    for (const op of [row.hidden ? 'show' : 'hide', ...(row.customNickname ? ['reset-nickname'] : []), 'revoke-sessions']) {
      const button = part('button', operations[op][0]);
      button.onclick = () => {
        pending = { name: row.name, operation: op };
        el('confirm-title').textContent = operations[op][0] + '？';
        el('confirm-detail').textContent = row.name + ' · ' + operations[op][1];
        el('confirm').returnValue = '';
        el('confirm').showModal();
      };
      actions.append(button);
    }
    article.append(info, score, actions);
    list.append(article);
  }
}

async function refresh() {
  const result = await api('families');
  rows = result.families;
  render();
}

async function run(task) {
  if (working) return;
  working = true;
  const main = document.querySelector('main');
  main.inert = true;
  try { el('status').textContent = ''; await task(); }
  catch (e) { el('status').textContent = e.message || '网络连接失败。'; }
  finally { working = false; main.inert = false; }
}

el('search').oninput = render;
el('refresh').onclick = () => run(refresh);
el('login').onsubmit = event => {
  event.preventDefault();
  run(async () => {
    await api('login', { name: el('username').value, password: el('password').value });
    el('password').value = '';
    identity(true);
    await refresh();
  });
};
el('logout').onclick = () => run(async () => { await api('logout', {}); identity(false); });
el('confirm').onclose = () => {
  const action = pending;
  pending = null;
  if (el('confirm').returnValue === 'yes' && action) run(async () => {
    await api('moderate', action);
    await refresh();
    el('status').textContent = '管理操作已保存。';
  });
};
identity(false);
run(async () => {
  const { signedIn } = await api('session');
  identity(signedIn);
  if (signedIn) await refresh();
});
