const byId = id => document.getElementById(id);
let familyMode = 'login';
let submitting = false;
function selectFamilyMode(mode) {
  familyMode = mode;
  document.querySelector('h1').textContent = mode === 'recover' ? '找回家庭账号' : mode === 'register' ? '注册家庭账号' : '登录家庭账号';
  const login = mode === 'login';
  const recover = mode === 'recover';
  byId('family-login').setAttribute('aria-pressed', String(login));
  byId('family-create').setAttribute('aria-pressed', String(mode === 'register'));
  byId('name-help').hidden = mode !== 'register';
  byId('recovery-entry').hidden = !recover;
  byId('reset-code').required = recover;
  byId('confirm-entry').hidden = login;
  byId('confirm-password').required = !login;
  byId('family-password').autocomplete = login ? 'current-password' : 'new-password';
  byId('family-password').value = byId('confirm-password').value = byId('reset-code').value = '';
  byId('password-label').textContent = login ? '密码' : '设置新密码（8–64 个字符）';
  byId('family-submit').textContent = login ? '登录' : recover ? '重设密码并登录' : '注册并登录';
  byId('forgot-password').textContent = login ? '忘记密码？' : '返回登录';
  byId('family-error').textContent = recover ? '请输入家长预先保存的找回码。找回码需要事先设置；如果没有保存，可以请家长查看浏览器保存的密码。' : '';
}

byId('family-login').onclick = () => selectFamilyMode('login');
byId('family-create').onclick = () => selectFamilyMode('register');
byId('forgot-password').onclick = () => selectFamilyMode(familyMode === 'login' ? 'recover' : 'login');
byId('family-form').onsubmit = async event => {
  event.preventDefault();
  if (submitting) return;
  const name = byId('family-name').value.trim().toLowerCase();
  const password = byId('family-password').value;
  if (familyMode !== 'login' && password !== byId('confirm-password').value) {
    byId('family-error').textContent = '两次输入的密码不同，请再确认一次。';
    return;
  }
  submitting = true;
  const controls = document.querySelectorAll('button, input');
  controls.forEach(control => control.disabled = true);
  try {
    byId('family-error').textContent = '正在打开家庭账号…';
    const fields = familyMode === 'recover' ? { name, newPassword: password, code: byId('reset-code').value } : { name, password };
    const response = await fetch('api/family/' + familyMode, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Yuyu-Family': '1' }, body: JSON.stringify(fields) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '请稍后再试。');
    const session = await fetch('api/family/session', { cache: 'no-store' });
    if ((await session.json()).family?.name !== name) throw new Error('请允许浏览器保存 Cookie，再登录家庭账号。');
    try { localStorage.setItem('yuyu-account-change', crypto.randomUUID()); } catch {}
    location.replace('./');
  } catch (error) {
    byId('family-error').textContent = error instanceof TypeError ? '网络暂时连不上，请再试一次。' : error.message;
  } finally {
    submitting = false;
    controls.forEach(control => control.disabled = false);
  }
};
window.addEventListener('storage', event => {
  if (event.key === 'yuyu-account-change') location.reload();
});
