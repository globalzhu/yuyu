export const WARDROBE_SLOTS = [
  { id: 'hat', name: '帽子', icon: '🧢' },
  { id: 'glasses', name: '眼镜', icon: '👓' },
  { id: 'neck', name: '领饰', icon: '🎀' },
  { id: 'scene', name: '背景', icon: '🫧' },
];

export const WARDROBE_ITEMS = [
  { id: 'sunhat', slot: 'hat', name: '海边草帽', price: 2 },
  { id: 'captain', slot: 'hat', name: '小船长帽', price: 5 },
  { id: 'crown', slot: 'hat', name: '星星王冠', price: 8 },
  { id: 'round', slot: 'glasses', name: '圆圆眼镜', price: 2 },
  { id: 'heart', slot: 'glasses', name: '爱心墨镜', price: 4 },
  { id: 'goggles', slot: 'glasses', name: '探险泳镜', price: 6 },
  { id: 'scarf', slot: 'neck', name: '海风围巾', price: 2 },
  { id: 'bow', slot: 'neck', name: '蝴蝶领结', price: 4 },
  { id: 'pearl', slot: 'neck', name: '珍珠项链', price: 7 },
  { id: 'coral', slot: 'scene', name: '珊瑚小屋', price: 3 },
  { id: 'twilight', slot: 'scene', name: '星光海湾', price: 5 },
  { id: 'bubbles', slot: 'scene', name: '泡泡乐园', price: 8 },
];

export function emptyWardrobe() {
  return { owned: [], equipped: Object.fromEntries(WARDROBE_SLOTS.map(({ id }) => [id, null])), revision: 0 };
}

export function wardrobeSpent(wardrobe) {
  const owned = new Set(Array.isArray(wardrobe?.owned) ? wardrobe.owned : []);
  return WARDROBE_ITEMS.reduce((total, item) => total + (owned.has(item.id) ? item.price : 0), 0);
}

export function normalizeWardrobe(wardrobe) {
  const result = emptyWardrobe();
  const owned = Array.isArray(wardrobe?.owned) ? wardrobe.owned : [];
  result.owned = WARDROBE_ITEMS.filter((item) => owned.includes(item.id)).map((item) => item.id);
  for (const { id: slot } of WARDROBE_SLOTS) {
    const item = WARDROBE_ITEMS.find((item) => item.id === wardrobe?.equipped?.[slot] && item.slot === slot);
    if (item && result.owned.includes(item.id)) result.equipped[slot] = item.id;
  }
  if (Number.isSafeInteger(wardrobe?.revision) && wardrobe.revision >= 0) result.revision = wardrobe.revision;
  return result;
}
