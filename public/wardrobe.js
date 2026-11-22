import { WARDROBE_ITEMS, WARDROBE_SLOTS, emptyWardrobe, normalizeWardrobe } from './wardrobe-catalog.mjs';

const byId = (id) => document.getElementById(id);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function gear(item) {
  const node = element('span', `gear gear-${item.slot} gear-${item.id}`);
  node.setAttribute('aria-hidden', 'true');
  node.append(element('i'), element('i'), element('i'));
  return node;
}

export function createWardrobe({ purchase, equip, report }) {
  const mount = byId('wardrobe');
  let state = { shells: 0, earnedShells: 0, wardrobe: emptyWardrobe() };
  let category = 'hat';
  let selection;
  let working = false;
  let externalBusy = false;

  const panel = element('section', 'wardrobe-panel card');
  panel.setAttribute('aria-labelledby', 'wardrobe-title');
  const top = element('div', 'wardrobe-heading');
  const heading = element('div');
  const title = element('h3', '', '小鱼衣橱');
  title.id = 'wardrobe-title';
  heading.append(title, element('p', '', '点一件先试穿，喜欢再兑换。'));
  const balance = element('div', 'wardrobe-balance');
  balance.setAttribute('aria-label', '可用贝壳');
  top.append(heading, balance);

  const layout = element('div', 'wardrobe-layout');
  const shop = element('div', 'wardrobe-shop');
  const tabs = element('div', 'wardrobe-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '装扮种类');
  const grid = element('div', 'wardrobe-grid');
  grid.id = 'wardrobe-items';
  grid.setAttribute('role', 'tabpanel');
  const itemDetail = element('div', 'wardrobe-detail');
  const itemTitle = element('h4');
  const itemDescription = element('p');
  const action = element('button', 'button primary wardrobe-action');
  action.id = 'wardrobe-action';
  action.type = 'button';
  itemDetail.append(itemTitle, itemDescription, action);
  shop.append(tabs, grid, itemDetail);

  const preview = element('div', 'wardrobe-preview');
  const avatar = element('div', 'wardrobe-avatar');
  avatar.id = 'wardrobe-avatar';
  avatar.setAttribute('role', 'img');
  const base = element('img', 'wardrobe-fish');
  base.src = 'avatar-fish.png';
  base.alt = '';
  const layers = element('div', 'wardrobe-layers');
  const water = element('div', 'wardrobe-water');
  water.setAttribute('aria-hidden', 'true');
  avatar.append(water, base, layers);
  const caption = element('p', 'wardrobe-preview-caption');
  const reset = element('button', 'quiet wardrobe-reset', '结束试穿');
  reset.type = 'button';
  reset.addEventListener('click', () => { selection = undefined; draw(); });
  preview.append(avatar, caption, reset);
  layout.append(shop, preview);
  const status = element('p', 'wardrobe-status');
  status.id = 'wardrobe-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  panel.append(top, layout, status);
  mount.append(panel);

  const dialog = element('dialog', 'wardrobe-confirm');
  dialog.id = 'wardrobe-confirm';
  dialog.setAttribute('aria-labelledby', 'wardrobe-confirm-title');
  const confirmTitle = element('h3');
  confirmTitle.id = 'wardrobe-confirm-title';
  const confirmCopy = element('p');
  const confirmActions = element('div', 'actions');
  const cancel = element('button', 'button secondary', '再想想');
  const confirm = element('button', 'button primary', '确认兑换');
  cancel.type = confirm.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  confirmActions.append(cancel, confirm);
  dialog.append(confirmTitle, confirmCopy, confirmActions);
  mount.append(dialog);
  let proposedPurchase;
  confirm.addEventListener('click', async () => {
    const chosen = proposedPurchase;
    dialog.close();
    if (chosen) await mutate(() => purchase(chosen.id), `换到了「${chosen.name}」，已经给小鱼穿上啦！`);
  });

  for (const slot of WARDROBE_SLOTS) {
    const tab = element('button', 'wardrobe-tab');
    tab.type = 'button';
    tab.id = `wardrobe-tab-${slot.id}`;
    tab.dataset.slot = slot.id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', grid.id);
    tab.append(element('span', '', slot.icon), document.createTextNode(slot.name));
    tab.addEventListener('click', () => { category = slot.id; selection = undefined; status.textContent = ''; draw(); });
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = WARDROBE_SLOTS.findIndex((value) => value.id === category);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? WARDROBE_SLOTS.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + WARDROBE_SLOTS.length) % WARDROBE_SLOTS.length;
      category = WARDROBE_SLOTS[next].id;
      selection = undefined;
      draw();
      byId(`wardrobe-tab-${category}`).focus();
    });
    tabs.append(tab);
  }

  async function mutate(operation, message) {
    if (working || externalBusy) return;
    const selectedId = selection;
    working = true;
    status.textContent = '正在给小鱼换装…';
    draw();
    try {
      const result = await operation();
      state = { ...state, ...result, wardrobe: normalizeWardrobe(result.wardrobe) };
      selection = undefined;
      status.textContent = message;
    } catch (error) {
      const message = error.message || '这次没换好，再试一次吧。';
      status.textContent = message;
      report?.(message);
    } finally {
      working = false;
      draw();
      grid.querySelector(`[data-item="${selectedId}"]`)?.focus({ preventScroll: true });
    }
  }

  action.addEventListener('click', async () => {
    const item = WARDROBE_ITEMS.find((value) => value.id === selection);
    if (!item || working || externalBusy) return;
    if (state.wardrobe.owned.includes(item.id)) {
      const current = state.wardrobe.equipped[item.slot] === item.id;
      await mutate(() => equip(item.slot, current ? null : item.id), current ? '这件已经收回衣橱了。' : `已经穿上「${item.name}」啦！`);
      return;
    }
    if (state.shells < item.price) return;
    proposedPurchase = item;
    confirmTitle.textContent = `兑换「${item.name}」？`;
    confirmCopy.textContent = `用 ${item.price} 枚贝壳兑换，之后还能剩 ${state.shells - item.price} 枚。这件装扮会一直在你的衣橱里。`;
    dialog.showModal();
    cancel.focus();
  });

  function draw() {
    const { shells, wardrobe } = state;
    const disabled = working || externalBusy;
    balance.textContent = `🐚 ${shells} 枚可用`;
    for (const tab of tabs.children) {
      const selected = tab.dataset.slot === category;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.disabled = disabled;
    }
    grid.setAttribute('aria-labelledby', `wardrobe-tab-${category}`);
    grid.replaceChildren();
    for (const item of WARDROBE_ITEMS.filter((value) => value.slot === category)) {
      const owned = wardrobe.owned.includes(item.id);
      const worn = wardrobe.equipped[item.slot] === item.id;
      const button = element('button', 'wardrobe-item');
      button.type = 'button';
      button.dataset.item = item.id;
      button.disabled = disabled;
      button.setAttribute('aria-pressed', String(item.id === selection));
      const art = element('span', 'wardrobe-item-art');
      art.append(gear(item));
      button.append(art, element('strong', '', item.name), element('span', 'wardrobe-price', worn ? '✓ 已穿戴' : owned ? '已拥有' : `🐚 ${item.price}`));
      button.addEventListener('click', () => {
        selection = item.id;
        status.textContent = '';
        draw();
        grid.querySelector(`[data-item="${item.id}"]`)?.focus({ preventScroll: true });
      });
      grid.append(button);
    }
    const selected = WARDROBE_ITEMS.find((item) => item.id === selection);
    const outfit = { ...wardrobe.equipped };
    if (selected) outfit[selected.slot] = selected.id;
    avatar.dataset.scene = outfit.scene || 'sea';
    const names = [];
    layers.replaceChildren();
    for (const slot of ['neck', 'glasses', 'hat']) {
      const item = WARDROBE_ITEMS.find((value) => value.id === outfit[slot]);
      if (item) { layers.append(gear(item)); names.push(item.name); }
    }
    avatar.setAttribute('aria-label', `你的小鱼${names.length ? '，穿着' + names.join('、') : '，初始造型'}`);
    caption.textContent = selected ? `正在试穿 · ${selected.name}` : '你的小鱼伙伴';
    reset.hidden = !selected;
    reset.disabled = disabled;
    itemTitle.textContent = selected ? selected.name : '试试喜欢的装扮';
    itemDescription.textContent = selected
      ? wardrobe.owned.includes(selected.id) ? '已经在你的衣橱里，想换就换。'
        : `永久拥有 · ${selected.price} 枚贝壳`
      : '选一件看看，小鱼会马上试给你看。';
    action.hidden = !selected;
    if (selected) {
      const owned = wardrobe.owned.includes(selected.id);
      const worn = wardrobe.equipped[selected.slot] === selected.id;
      action.textContent = owned ? worn ? '收回衣橱' : '穿上这件' : shells < selected.price
        ? `还差 ${selected.price - shells} 枚贝壳` : `用 ${selected.price} 枚贝壳兑换`;
      action.disabled = disabled || (!owned && shells < selected.price);
    }
  }

  return {
    render(snapshot) {
      state = { ...state, ...snapshot, wardrobe: normalizeWardrobe(snapshot.wardrobe) };
      externalBusy = snapshot.busy === true;
      draw();
    },
  };
}
