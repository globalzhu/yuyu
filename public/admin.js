const el = id => document.getElementById(id);
const operations = {
  rename: ['修改登录名', '改名后请使用新账号名登录。'],
  'reset-password': ['重设密码', '保存后请将新密码交给家长。旧密码、找回码和设备登录会失效。'],
  grant: ['赠送贝壳', '赠送的贝壳可用于兑换，原因会显示给这个家庭。'],
  deliver: ['确认已发放', '请确认礼物已交到孩子手中。'],
  refund: ['取消并退贝壳', '取消这笔兑换，并退回实际支付的贝壳。'],
  show: ['恢复上榜', '这个家庭将重新出现在学习榜。'],
  hide: ['暂时下榜', '这个家庭的成绩将暂时从学习榜隐藏，做题和领奖可以照常进行。'],
  'reset-nickname': ['恢复默认昵称', '学习榜将显示系统分配的小鱼昵称。家庭可以重新取名。'],
  'revoke-sessions': ['退出所有设备', '这个家庭的设备都需要重新登录，学习进度和贝壳会保留。'],
};
let rows = [];
let gifts = [];
let pending;
let working = false;

function identity(signedIn) {
  el('access').hidden = signedIn;
  el('dashboard').hidden = !signedIn;
  if (!signedIn) {
    rows = [];
    pending = null;
    for (const id of ['list','catalog','orders','op-fields']) el(id).replaceChildren();
    gifts = [];
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
    for (const op of ['grant', 'rename', 'reset-password', row.hidden ? 'show' : 'hide', ...(row.customNickname ? ['reset-nickname'] : []), 'revoke-sessions']) {
      const button = part('button', operations[op][0]);
      button.onclick = () => {
        openOperation({ name: row.name, operation: op }, operations[op][0], row.name + ' · ' + operations[op][1]);
        if (op === 'rename') field('value', '新登录名', 'text', row.name, 24);
        if (op === 'reset-password') {
          field('value', '新密码（8–64 个字符）', 'password', '', 64);
          field('repeat', '再次输入新密码', 'password', '', 64);
        }
        if (op === 'grant') {
          field('amount', '赠送数量（枚）', 'number');
          field('reason', '送给孩子的话', 'text', '', 80);
        }
      };
      actions.append(button);
    }
    article.append(info, score, actions);
    if (row.grants.length) {
      const history = part('details', '');
      history.append(part('summary', '赠送记录（' + row.grants.length + '）'));
      for (const g of row.grants.slice().reverse()) history.append(part('p', date(g.at) + ' · +' + g.amount + ' 枚 · ' + g.reason));
      article.append(history);
    }
    list.append(article);
  }
}

function date(at) {
  return new Date(at).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

function openOperation(data, title, detail) {
  pending = { ...data, requestId: crypto.randomUUID() };
  el('op-fields').replaceChildren();
  el('op-error').textContent = '';
  el('confirm-title').textContent = title;
  el('confirm-detail').textContent = detail;
  el('confirm').showModal();
}

function field(name, label, type, value = '', max = 40) {
  const node = part('label', label);
  const input = document.createElement('input');
  input.name = name;
  input.type = type;
  input.required = true;
  input.autocomplete = type === 'password' ? 'new-password' : 'off';
  input.value = value;
  if (type === 'number') { input.min = 1; input.max = 10000; }
  else input.maxLength = max;
  node.append(input);
  el('op-fields').append(node);
}

function editGift(gift = { id: crypto.randomUUID(), title: '', price: 5, active: true }) {
  openOperation({ operation: 'gift', ...gift }, gift.title ? '编辑礼物' : '添加礼物', '保存后按当前上架状态展示给家庭。');
  field('title', '礼物名称', 'text', gift.title);
  field('price', '兑换需要的贝壳', 'number', gift.price);
}

function renderRewards() {
  const list = el('catalog');
  list.replaceChildren();
  if (!gifts.length) list.append(part('p', '添加一件可以实际发放的礼物，孩子就能在贝壳岛看到它。'));
  for (const gift of gifts) {
    const row = part('article', '', 'family');
    row.append(part('strong', gift.title), part('span', gift.price + ' 枚 · ' + (gift.active ? '已上架' : '已下架')));
    const actions = part('div', '', 'actions');
    const edit = part('button', '编辑'); edit.onclick = () => editGift(gift);
    const toggle = part('button', gift.active ? '下架' : '上架');
    toggle.onclick = () => openOperation({ ...gift, active: !gift.active, operation: 'gift' }, toggle.textContent + '礼物？', gift.title);
    actions.append(edit, toggle); row.append(actions); list.append(row);
  }
  const orders = rows.flatMap(row => row.orders.map(order => ({ ...order, name: row.name })))
    .filter(order => el('order-filter').value === 'all' || order.status === 'pending').sort((a,b) => b.at - a.at);
  const mount = el('orders'); mount.replaceChildren();
  if (!orders.length) mount.append(part('p', '当前没有对应的兑换记录。'));
  const labels = { pending: '待发放', delivered: '已发放', refunded: '已退贝壳' };
  for (const order of orders) {
    const row = part('article', '', 'family');
    const info = part('div', '', 'profile');
    info.append(part('strong', order.title), part('small', order.name + ' · ' + date(order.at)));
    row.append(info, part('span', order.price + ' 枚 · ' + labels[order.status]));
    if (order.status === 'pending') {
      const actions = part('div', '', 'actions');
      for (const op of ['deliver','refund']) {
        const btn = part('button', operations[op][0]);
        btn.onclick = () => openOperation({ name: order.name, orderId: order.id, operation: op },
          operations[op][0], order.name + ' · ' + order.title + ' · ' + operations[op][1]);
        actions.append(btn);
      }
      row.append(actions);
    }
    mount.append(row);
  }
}

async function refresh() {
  const [result, catalog] = await Promise.all([api('families'), api('catalog')]);
  gifts = catalog.gifts;
  rows = result.families;
  render();
  renderRewards();
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
el('order-filter').onchange = renderRewards;
el('add-gift').onclick = () => editGift();
const form = el('confirm').querySelector('form');
el('confirm').onclose = () => { pending = null; el('op-fields').replaceChildren(); };
el('confirm').oncancel = event => { if (working) event.preventDefault(); };
form.onsubmit = async event => {
  event.preventDefault();
  if (working || !pending) return;
  if (event.submitter?.value === 'cancel') return el('confirm').close();
  const data = { ...pending, ...Object.fromEntries(new FormData(form)) };
  if (data.operation === 'reset-password' && data.value !== data.repeat) {
    el('op-error').textContent = '两次输入的新密码不同。'; return;
  }
  delete data.repeat;
  if (data.amount !== undefined) data.amount = Number(data.amount);
  if (data.price !== undefined) data.price = Number(data.price);
  working = form.inert = true;
  try {
    await api(data.operation === 'gift' ? 'gift' : 'moderate', data);
    el('confirm').close();
    await refresh();
    el('status').textContent = '已保存。';
  } catch (error) {
    (el('confirm').open ? el('op-error') : el('status')).textContent = error.message;
  } finally { working = form.inert = false; }
};
identity(false);
run(async () => {
  const { signedIn } = await api('session');
  identity(signedIn);
  if (signedIn) await refresh();
});
