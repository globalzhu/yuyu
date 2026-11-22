function element(tag, className, content) {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (content) value.textContent = content;
  return value;
}

export function createPractice({ openQuestion, report }) {
  const mount = document.getElementById('practice-panel');
  let working = false;
  let currentActivity;
  let currentEntries = [];
  let currentSnapshot = {};
  let lastError = '';

  function render(activity, entries = [], snapshot = {}) {
    currentActivity = activity;
    currentEntries = entries;
    currentSnapshot = snapshot;
    mount.replaceChildren();
    if (!activity) return;
    const questions = activity.questions || [];
    const saved = new Map(entries.map((entry) => [entry.id, entry]));
    const completed = questions.filter((question) => saved.get(question.entryId)?.solved).length;
    const bonusAwarded = activity.bonusAwarded === true;
    const card = element('div', 'card practice-card');
    const heading = element('div', 'practice-heading');
    const title = element('h2', '', '三题小闯关');
    title.id = 'practice-title';
    title.tabIndex = -1;
    heading.append(title, element('span', 'practice-count', `${completed} / ${questions.length} 题完成`));
    card.append(heading, element('p', 'practice-reward-note', '每解开一题收 1 枚贝壳，全部完成再收 2 枚。'));
    const progress = element('progress', 'practice-progress');
    progress.max = Math.max(1, questions.length);
    progress.value = completed;
    progress.setAttribute('aria-label', `已完成 ${completed} 道，共 ${questions.length} 道`);
    card.append(progress);
    if (completed === questions.length && questions.length) {
      const celebration = element('div', 'practice-celebration');
      celebration.append(element('span', 'practice-celebration-art', '🏝️'), element('strong', '', '三个新题，都解开啦！'),
        element('p', '', bonusAwarded ? '额外的 2 枚贝壳已收好，去给小鱼挑件装扮吧。' : '闯关已完成，额外贝壳会在同步后到账。'));
      card.append(celebration);
    }
    const list = element('div', 'practice-questions');
    const firstOpen = questions.findIndex((question) => !saved.get(question.entryId)?.solved);
    for (const [index, question] of questions.entries()) {
      const entry = saved.get(question.entryId);
      const article = element('article', 'practice-question' + (entry?.solved ? ' is-complete' : ''));
      const top = element('div', 'practice-question-top');
      top.append(element('span', 'practice-number', String(index + 1)),
        element('span', 'practice-question-state', entry?.solved ? '✓ 已解开' : entry ? '接着上次的小步骤' : '新的小挑战'));
      const text = element('p', 'practice-problem', question.problem);
      const button = element('button', `button ${index === firstOpen ? 'primary' : 'secondary'}`,
        entry?.solved ? '回看解法' : entry ? '继续这道题 →' : `开始第 ${index + 1} 题 →`);
      button.type = 'button';
      button.disabled = working;
      button.addEventListener('click', async () => {
        if (working) return;
        lastError = '';
        working = true;
        render(currentActivity, currentEntries, currentSnapshot);
        try { await openQuestion(question, index); }
        catch (error) {
          const message = error.message || '这道题暂时没打开，请再试一次。';
          lastError = message;
          const local = document.getElementById('practice-status');
          if (local) local.textContent = message;
          report?.(message);
        } finally {
          working = false;
          if (!document.getElementById('practice').hidden) render(currentActivity, currentEntries, currentSnapshot);
        }
      });
      article.append(top, text, button);
      list.append(article);
    }
    const status = element('p', 'practice-status');
    status.id = 'practice-status';
    status.textContent = lastError;
    status.setAttribute('role', 'status');
    card.append(list, status);
    mount.append(card);
  }

  return { render };
}

export function createLeaderboard({ refresh, report }) {
  const mount = document.getElementById('leaderboard');
  let busy = false;
  let current = { leaders: [], you: null };
  const section = element('section', 'card leaderboard-card');
  section.setAttribute('aria-labelledby', 'leaderboard-title');
  const heading = element('div', 'row-heading');
  const title = element('h3', '', '小鱼学习榜');
  title.id = 'leaderboard-title';
  const reload = element('button', 'quiet', '刷新');
  reload.type = 'button';
  reload.setAttribute('aria-label', '刷新学习榜');
  heading.append(title, reload);
  const subtitle = element('p', 'leaderboard-note', '每个家庭一个小名，按解开的题数排行。');
  const table = element('div', 'leaderboard-table');
  const status = element('p', 'leaderboard-status');
  status.setAttribute('role', 'status');
  section.append(heading, subtitle, table, status);
  mount.append(section);

  function row(entry) {
    const result = element('div', 'leaderboard-row' + (entry.isYou ? ' is-you' : ''));
    const rank = Number.isSafeInteger(entry.rank) && entry.rank > 0 ? String(entry.rank) : '—';
    result.append(element('span', 'leaderboard-rank', rank),
      element('span', 'leaderboard-name', (entry.displayName || '海洋小伙伴') + (entry.isYou ? ' · 你们家' : '')),
      element('strong', 'leaderboard-score', `${Math.max(0, Number(entry.solvedCount) || 0)} 题`));
    return result;
  }

  function render(data) {
    current = data || current;
    table.replaceChildren();
    const labels = element('div', 'leaderboard-labels');
    labels.append(element('span', '', '名次'), element('span', '', '小伙伴'), element('span', '', '完成题目'));
    table.append(labels);
    for (const entry of current.leaders || []) table.append(row(entry));
    if (!(current.leaders || []).length) table.append(element('p', 'leaderboard-empty', '还没有上榜的小伙伴，解开一道题就能开始积累。'));
    if (current.you && !(current.leaders || []).some((entry) => entry.isYou)) {
      const own = row(current.you);
      own.classList.add('leaderboard-own');
      table.append(own);
    }
    reload.disabled = busy;
  }

  reload.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    reload.disabled = true;
    status.textContent = '正在更新学习榜…';
    try {
      render(await refresh());
      status.textContent = '';
    } catch (error) {
      const message = error.message || '学习榜暂时没打开，可以稍后刷新。';
      status.textContent = message;
      report?.(message);
    } finally {
      busy = false;
      reload.disabled = false;
    }
  });

  return {
    render,
    loading(value) {
      busy = value === true;
      reload.disabled = busy;
      status.textContent = busy ? '正在更新学习榜…' : '';
    },
  };
}
