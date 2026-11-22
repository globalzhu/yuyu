export function createPhotoCropper() {
  const dialog = document.getElementById('photo-crop');
  const stage = document.getElementById('crop-stage');
  const preview = document.getElementById('crop-image');
  const selection = document.getElementById('crop-selection');
  const status = document.getElementById('crop-status');
  let picture;
  let rectangle;
  let pending;
  let drag;

  const limit = (value, low, high) => Math.min(high, Math.max(low, value));

  function render() {
    selection.style.left = `${rectangle.left * 100}%`;
    selection.style.top = `${rectangle.top * 100}%`;
    selection.style.width = `${(rectangle.right - rectangle.left) * 100}%`;
    selection.style.height = `${(rectangle.bottom - rectangle.top) * 100}%`;
    selection.setAttribute('aria-label', `裁剪范围，宽 ${Math.round((rectangle.right - rectangle.left) * 100)}%，高 ${Math.round((rectangle.bottom - rectangle.top) * 100)}%。方向键可以移动。`);
  }

  function fit() {
    if (!picture || !dialog.open) return;
    const width = Math.max(80, dialog.clientWidth - 32);
    const height = Math.max(120, Math.min(520, window.innerHeight - 230));
    const scale = Math.min(width / picture.naturalWidth, height / picture.naturalHeight, 1);
    stage.style.width = `${Math.floor(picture.naturalWidth * scale)}px`;
    stage.style.height = `${Math.floor(picture.naturalHeight * scale)}px`;
    render();
  }

  function reshape(start, handle, dx, dy) {
    const next = { ...start };
    const minimumWidth = Math.min(1, 44 / stage.clientWidth);
    const minimumHeight = Math.min(1, 44 / stage.clientHeight);
    if (!handle) {
      const horizontal = limit(dx, -start.left, 1 - start.right);
      const vertical = limit(dy, -start.top, 1 - start.bottom);
      next.left += horizontal;
      next.right += horizontal;
      next.top += vertical;
      next.bottom += vertical;
    } else {
      if (handle.includes('w')) next.left = limit(start.left + dx, 0, start.right - minimumWidth);
      if (handle.includes('e')) next.right = limit(start.right + dx, start.left + minimumWidth, 1);
      if (handle.includes('n')) next.top = limit(start.top + dy, 0, start.bottom - minimumHeight);
      if (handle.includes('s')) next.bottom = limit(start.bottom + dy, start.top + minimumHeight, 1);
    }
    rectangle = next;
    render();
  }

  selection.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const target = event.target.closest('[data-crop-handle]') || selection;
    target.focus({ preventScroll: true });
    selection.setPointerCapture(event.pointerId);
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY,
      handle: target.dataset.cropHandle, start: { ...rectangle }, bounds: stage.getBoundingClientRect() };
  });
  selection.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    event.preventDefault();
    reshape(drag.start, drag.handle, (event.clientX - drag.x) / drag.bounds.width,
      (event.clientY - drag.y) / drag.bounds.height);
  });
  function stopDrag() { drag = undefined; }
  selection.addEventListener('pointerup', stopDrag);
  selection.addEventListener('pointercancel', stopDrag);
  selection.addEventListener('lostpointercapture', stopDrag);
  selection.addEventListener('keydown', (event) => {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.05 : 0.01;
    reshape(rectangle, event.target.dataset.cropHandle, direction[0] * step, direction[1] * step);
  });

  function finish(value) {
    const resolve = pending;
    pending = undefined;
    picture = undefined;
    drag = undefined;
    dialog.close();
    preview.removeAttribute('src');
    resolve?.(value);
  }

  function use(whole) {
    const area = whole ? { left: 0, top: 0, right: 1, bottom: 1 } : rectangle;
    const left = Math.round(area.left * picture.naturalWidth);
    const top = Math.round(area.top * picture.naturalHeight);
    const width = Math.max(1, Math.round(area.right * picture.naturalWidth) - left);
    const height = Math.max(1, Math.round(area.bottom * picture.naturalHeight) - top);
    const scale = Math.min(1, 1700 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    try {
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(picture, left, top, width, height, 0, 0, canvas.width, canvas.height);
      finish(canvas.toDataURL('image/jpeg', 0.87));
    } catch {
      status.textContent = '这次裁剪没有完成，请重新选一下范围。';
    }
  }

  document.getElementById('crop-confirm').addEventListener('click', () => use(false));
  document.getElementById('crop-whole').addEventListener('click', () => use(true));
  document.getElementById('crop-cancel').addEventListener('click', () => finish(null));
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finish(null);
  });
  dialog.addEventListener('close', () => {
    if (pending) finish(null);
  });
  window.addEventListener('resize', fit);

  return {
    choose(loadedPicture) {
      if (pending) finish(null);
      picture = loadedPicture;
      rectangle = { left: 0, top: 0, right: 1, bottom: 1 };
      preview.src = picture.src;
      status.textContent = '';
      dialog.showModal();
      fit();
      selection.focus({ preventScroll: true });
      return new Promise((resolve) => { pending = resolve; });
    },
  };
}
