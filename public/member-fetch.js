let leaving = false;

export function reloadAccount() {
  if (leaving) return;
  leaving = true;
  document.documentElement.hidden = true;
  location.replace('./');
}

export async function memberFetch(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    reloadAccount();
    throw Object.assign(new Error('请先登录家庭账号。'), { status: 401 });
  }
  return response;
}
