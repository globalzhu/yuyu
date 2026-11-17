import { familyInfo, importLocalJournal, loadJournal, removeEntries, saveEntry, signIn, signOut } from './journal.js?v=7';
import { createVoice } from './voice.js?v=4';

const byId = (id) => document.getElementById(id);
const problem = byId('problem');
const start = byId('start');
const startButton = byId('start-button');
const lesson = byId('lesson');
const attempt = byId('attempt');
const attemptForm = byId('attempt-form');
const stepChoices = byId('step-choices');
const hintButton = byId('more-hint');
const photoInput = byId('photo');
const cameraInput = byId('camera');
const messages = byId('messages');
const status = byId('status');
const practice = [...document.querySelectorAll('[data-example]')];
const stages = [...document.querySelectorAll('[data-stage]')];
const navigation = [...document.querySelectorAll('[data-view]')];
const rewardLevels = [
  { goal: 1, icon: '🐠', name: '好奇小鱼', color: 'mint' },
  { goal: 3, icon: '⭐', name: '海星向导', color: 'peach' },
  { goal: 5, icon: '🐢', name: '耐心海龟', color: 'mint' },
  { goal: 8, icon: '🐙', name: '点子章鱼', color: 'lilac' },
  { goal: 12, icon: '🪸', name: '珊瑚花园', color: 'peach' },
  { goal: 20, icon: '🐬', name: '深海搭档', color: 'lilac' },
];
const inputFormats = {
  number: { title: '填一个数字', placeholder: '把算出的数字填在这里…' },
  equation: { title: '写一个算式', placeholder: '把算式写在这里…' },
  phrase: { title: '写几个字就好', placeholder: '把你找到的线索写在这里…' },
  sentence: { title: '写一句话', placeholder: '用自己的话说一说…' },
};
const feedbackTitles = {
  correct_step: '做对一步，继续',
  try_again: '再试一次',
  hint: '给你一点提示',
};
const dateLabel = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
let view = 'study';
let entry;
let image;
let photoVersion = 0;
let busy = false;
let photoLoading = false;
let confirming = false;
let shells = 0;
let historyFilter = 'all';
let deleteTarget;
let loadVersion = 0;
let latestUnfinished;
let reviewingSolution = false;
let familyMode = 'login';
let familyName = '';
let familyBusy = false;

const voice = createVoice({
  report,
  recordingChanged: updateControls,
  received(target, transcript) {
    const previous = target.value.trim();
    target.value = [previous, transcript].filter(Boolean).join('\n').slice(0, target.maxLength);
    if (target === attempt) updateChoiceSelection();
    report('已经填好了。看一看有没有听错，改好再提交。');
    target.setSelectionRange(target.value.length, target.value.length);
  },
});

function updateControls() {
  const mic = voice.recordingButton;
  const blocked = busy || Boolean(mic);
  startButton.disabled = blocked || photoLoading;
  photoInput.disabled = cameraInput.disabled = blocked;
  hintButton.disabled = blocked;
  byId('send-attempt').disabled = blocked;
  byId('new-problem').disabled = byId('restart-problem').disabled = busy;
  byId('next-problem').disabled = byId('review-solution').disabled = busy;
  byId('start-challenge').disabled = byId('review-challenge').disabled = busy;
  byId('speak-problem').disabled = busy || photoLoading || Boolean(mic && mic.id !== 'speak-problem') || voice.transcribing;
  byId('speak-attempt').disabled = busy || Boolean(mic && mic.id !== 'speak-attempt') || voice.transcribing;
  problem.readOnly = attempt.readOnly = blocked;
  for (const button of practice) button.disabled = blocked;
  for (const button of stepChoices.children) button.disabled = blocked;
  for (const button of navigation) button.disabled = busy;
  for (const button of byId('history-list').querySelectorAll('button')) button.disabled = busy;
  byId('family-open').disabled = busy;
}

function report(message, near) {
  if (!near) {
    near = byId(view);
    if (view === 'study') {
      near = !entry ? start : byId(entry.solved && !reviewingSolution ? 'completion-status' : 'lesson-status');
    }
  }
  near.append(status);
  status.textContent = message;
}

async function request(action, data) {
  const response = await fetch('api/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || (response.status === 413 ? '照片有点大。试试只拍题目那一块。' : '网有点慢，再试一次吧。'));
    error.status = response.status;
    throw error;
  }
  return result;
}

async function waitFor(near, message, task) {
  if (busy || voice.recordingButton) return;
  busy = true;
  updateControls();
  report(message, near);
  try {
    await task();
  } catch (error) {
    report(error instanceof TypeError ? '网络还没连上。等一小会儿再试试。' : error.message, near);
  } finally {
    busy = false;
    updateControls();
  }
}

function clearPhoto() {
  photoVersion++;
  photoLoading = false;
  image = null;
  photoInput.value = cameraInput.value = '';
  byId('photo-preview').hidden = true;
  byId('photo-thumb').removeAttribute('src');
  updateControls();
}

async function preparePhoto(file) {
  if (!file.type.startsWith('image/') || file.size > 35 * 1024 * 1024) {
    throw new Error('请选一张小于 35 MB 的题目照片。');
  }
  const url = URL.createObjectURL(file);
  try {
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    const scale = Math.min(1, 1700 / Math.max(picture.naturalWidth, picture.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    throw new Error('这张照片打不开。试试重新拍一张，或选 JPG / PNG 照片。');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function selectPhoto(event) {
  const file = event.currentTarget.files[0];
  if (!file) return;
  const version = ++photoVersion;
  photoLoading = true;
  confirming = false;
  startButton.textContent = '和鱼渔想一想 →';
  image = null;
  byId('photo-preview').hidden = true;
  byId('photo-thumb').removeAttribute('src');
  updateControls();
  report('正在准备照片…', start);
  try {
    const encoded = await preparePhoto(file);
    if (version !== photoVersion) return;
    image = encoded;
    byId('photo-thumb').src = encoded;
    byId('photo-preview').hidden = false;
    startButton.textContent = '读一读照片 →';
    report('', start);
  } catch (error) {
    if (version !== photoVersion) return;
    clearPhoto();
    report(error.message, start);
  } finally {
    if (version === photoVersion) {
      photoLoading = false;
      updateControls();
    }
  }
}

photoInput.addEventListener('change', selectPhoto);
cameraInput.addEventListener('change', selectPhoto);
byId('remove-photo').addEventListener('click', () => {
  if (busy) return;
  clearPhoto();
  startButton.textContent = '和鱼渔想一想 →';
  report('', start);
  photoInput.focus();
});

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content) element.textContent = content;
  return element;
}

function bubble(mine, content) {
  const article = node('article', mine ? 'bubble mine' : 'bubble');
  const header = node('div', 'row-heading');
  header.append(node('strong', '', mine ? '我的尝试' : '🐠 鱼渔'));
  if (!mine) {
    const listen = node('button', 'listen', '🔊 听这一步');
    listen.type = 'button';
    listen.addEventListener('click', () => voice.read(listen, content));
    header.append(listen);
  }
  article.append(header, node('p', '', content));
  messages.append(article);
}

function renderLesson(award) {
  if (!entry) return;
  const last = entry.turns.at(-1);
  byId('lesson-title').textContent = entry.solved ? '解法回顾' : '一起解题';
  byId('problem-view').textContent = entry.problem;
  byId('lesson-subtitle').textContent = entry.challenge ? '相似题挑战 · 试试刚学的办法'
    : entry.example ? '跟着鱼渔练一练' : '小学四年级 · 一次做一步';
  byId('review-challenge').hidden = !canStartChallenge(entry);
  for (const stage of stages) {
    const i = Number(stage.dataset.stage);
    stage.classList.toggle('done', entry.solved || i < entry.stage);
    if (!entry.solved && i === entry.stage) stage.setAttribute('aria-current', 'step');
    else stage.removeAttribute('aria-current');
  }
  byId('current-step').dataset.feedback = last.feedback || '';
  const hintTitle = last.feedback === 'hint' && last.hintLevel > 0
    ? `第 ${last.hintLevel} 个提示`
    : feedbackTitles[last.feedback];
  byId('step-title').textContent = entry.solved
    ? '这道题解开啦'
    : hintTitle || '现在做这一步';
  byId('step-note').textContent = last.note || '';
  byId('step-note').hidden = !last.note;
  byId('step-task').textContent = last.task || last.message || '';
  byId('step-task').hidden = !last.task && !!last.note;
  byId('listen-step').textContent = entry.solved ? '🔊 听总结' : '🔊 听提示';
  const format = inputFormats[last.format] || inputFormats.phrase;
  const hasChoices = renderStepChoices(last.choices);
  byId('attempt-label').textContent = hasChoices ? '也可以自己填' : format.title;
  attempt.placeholder = format.placeholder;
  attempt.rows = hasChoices ? 1 : 2;
  attempt.inputMode = last.format === 'number' ? 'decimal' : 'text';
  const recentAnswer = [...entry.turns].reverse().find((turn) => turn.attempt)?.attempt;
  byId('last-answer').hidden = !recentAnswer || entry.solved;
  byId('last-answer-text').textContent = recentAnswer || '';
  attemptForm.hidden = entry.solved || entry.expired;
  hintButton.disabled = busy || Boolean(voice.recordingButton);
  byId('resume-expired').hidden = !entry.expired;
  if (entry.solved) renderCompletion(award);
  renderTimeline();
}

function renderStepChoices(choices) {
  const valid = Array.isArray(choices)
    ? [...new Set(choices.filter((choice) => typeof choice === 'string')
      .map((choice) => choice.trim()).filter((choice) => choice.length > 0 && choice.length <= 24))]
    : [];
  stepChoices.replaceChildren();
  const visible = valid.length >= 2 && valid.length <= 5;
  byId('step-choice-group').hidden = !visible;
  if (!visible) return false;
  for (const choice of valid) {
    const button = node('button', 'step-option', choice);
    button.type = 'button';
    button.disabled = busy || Boolean(voice.recordingButton);
    button.addEventListener('click', () => {
      attempt.value = choice;
      updateChoiceSelection();
    });
    stepChoices.append(button);
  }
  updateChoiceSelection();
  return true;
}

function updateChoiceSelection() {
  for (const button of stepChoices.children) {
    button.setAttribute('aria-pressed', String(button.textContent === attempt.value.trim()));
  }
}
attempt.addEventListener('input', updateChoiceSelection);

function renderCompletion(award) {
  const reward = byId('completion-reward');
  const unlock = byId('completion-unlock');
  const offersChallenge = canStartChallenge(entry);
  byId('start-challenge').hidden = !offersChallenge;
  byId('next-problem').classList.toggle('primary', !offersChallenge);
  byId('next-problem').classList.toggle('secondary', offersChallenge);
  byId('completion-title').textContent = entry.challenge ? '相似题挑战完成！' : '这道题做完啦！';
  byId('completion-encouragement').textContent = entry.challenge
    ? '刚学的办法，你又用对了一次。'
    : '你一步一步把题解开了。';
  byId('completion').classList.toggle('just-earned', Boolean(award?.awarded));
  reward.hidden = !award?.awarded && !award?.pending;
  byId('completion-reward-text').textContent = !award?.awarded ? '贝壳会在同步后到账'
    : entry.challenge ? '再收到 1 枚贝壳' : '收到 1 枚贝壳';
  const unlocked = award?.awarded && rewardLevels.find((level) => level.goal === shells);
  unlock.hidden = !unlocked;
  unlock.textContent = unlocked ? `${unlocked.icon} 遇见了新伙伴「${unlocked.name}」` : '';
}

function renderTimeline() {
  messages.replaceChildren();
  for (const [index, turn] of entry.turns.entries()) {
    if (turn.attempt) bubble(true, turn.attempt);
    if (turn.message && index < entry.turns.length - 1) bubble(false, turn.message);
  }
  byId('conversation').hidden = !messages.childElementCount;
}

function lessonTurn(reply, answer = '') {
  return {
    attempt: answer, note: reply.note, task: reply.task, format: reply.format, choices: reply.choices,
    feedback: reply.feedback, message: reply.message, hintLevel: reply.hintLevel,
  };
}

function saveTurn(reply, action, answer) {
  const next = lessonTurn(reply, answer);
  const last = entry.turns.at(-1);
  const laterHint = Number.isSafeInteger(next.hintLevel) && Number.isSafeInteger(last?.hintLevel) &&
    next.hintLevel > last.hintLevel;
  if (action === 'hint' && last?.feedback === 'hint' && !last.attempt && next.feedback === 'hint' &&
      (laterHint || last.task === next.task)) {
    entry.turns[entry.turns.length - 1] = next;
  } else entry.turns.push(next);
}

function canStartChallenge(item) {
  return Boolean(item?.solved && !item.challenge && !item.parentId);
}

function updateShells(value) {
  shells = value;
  byId('shell-count').textContent = value;
}

async function persist() {
  try {
    const local = entry;
    const award = await saveEntry(entry);
    updateShells(award.shells);
    if (award.conflict) {
      entry = award.entry || local;
      if (!award.entry) entry.expired = true;
      if (!entry.solved && !entry.expired) attempt.value = local.turns.at(-1).attempt || attempt.value;
      report(award.entry
        ? '这题在另一台设备有新进度，已打开最新一步。'
        : '这题已在另一台设备删除。');
    } else if (award.entry) entry = award.entry;
    if (award.pending) {
      report(award.local ? '已暂存在这台设备，连上网络后会继续同步。' : '暂时保存不了，请稍后再试。');
    }
    return award;
  } catch {
    report('浏览器没有保存这道题。可以继续解题。');
    return null;
  }
}

async function begin(reply, prior) {
  const now = Date.now();
  entry = {
    id: prior?.id || reply.entryId || crypto.randomUUID(), createdAt: prior?.createdAt || now, updatedAt: now,
    problem: reply.problem, token: reply.token, stage: reply.stage, example: reply.example,
    solved: reply.solved, revision: prior?.revision, turns: [...(prior?.turns || []), lessonTurn(reply)],
    challenge: reply.challenge === true, parentId: reply.parentId, completionToken: reply.completionToken,
  };
  clearPhoto();
  confirming = false;
  attempt.value = '';
  reviewingSolution = false;
  byId('conversation').open = false;
  report('');
  renderLesson(await persist());
  openView('study', true, true);
}

function addListening(button, passage) {
  button.addEventListener('click', () => voice.read(button, passage()));
}
addListening(byId('listen-problem'), () => entry?.problem || '');
addListening(byId('listen-step'), () => entry?.turns.at(-1).message || '');
byId('speak-problem').addEventListener('click', (event) => voice.record(event.currentTarget, problem));
byId('speak-attempt').addEventListener('click', (event) => voice.record(event.currentTarget, attempt));

byId('problem-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (photoLoading || voice.recordingButton) return;
  if (image) {
    waitFor(start, '🐠 鱼渔正在读照片…', async () => {
      const reply = await request('transcribe', { image });
      clearPhoto();
      confirming = true;
      report('鱼渔读成了上面这样。请核对题目，有错可以直接改。', start);
      problem.value = reply.problem;
      startButton.textContent = '题目对了，开始想 →';
      problem.focus();
    });
    return;
  }
  if (!problem.value.trim()) {
    report('先拍一道题、说一说，或者把题目写下来。', start);
    problem.focus();
    return;
  }
  waitFor(start, confirming ? '🐠 题目确认了。鱼渔在准备第一步…' : '🐠 鱼渔在准备第一步…', async () => {
    await begin(await request('start', { problem: problem.value.trim() }));
  });
});

for (const button of practice) {
  button.addEventListener('click', () => {
    waitFor(start, '🐠 鱼渔来带路啦…', async () => begin(await request('start', { example: button.dataset.example })));
  });
}

function turn(action, answer = '') {
  const waiting = action === 'hint' ? '🐠 鱼渔正在找提示…' : '🐠 鱼渔正在想…';
  return waitFor(byId('lesson-status'), waiting, async () => {
    voice.stopReading();
    let reply;
    try {
      reply = await request(action, { token: entry.token, entryId: entry.id, attempt: answer });
    } catch (error) {
      if (error.status !== 409) throw error;
      entry.expired = true;
      report('');
      renderLesson();
      await persist();
      byId('restart-problem').focus({ preventScroll: true });
      return;
    }
    report('');
    if (answer) attempt.value = '';
    Object.assign(entry, { stage: reply.stage, solved: reply.solved, token: reply.token, updatedAt: Date.now() });
    if (reply.completionToken) entry.completionToken = reply.completionToken;
    saveTurn(reply, action, answer);
    const award = await persist();
    renderLesson(award);
    if (entry.solved) openView('study', true, true);
    else byId('current-step').scrollIntoView({ block: 'nearest' });
  });
}

hintButton.addEventListener('click', async () => {
  const hadFocus = document.activeElement === hintButton;
  await turn('hint');
  if (!hadFocus || lesson.hidden || attemptForm.hidden) return;
  if (document.activeElement !== document.body && document.activeElement !== hintButton) return;
  if (!hintButton.disabled) hintButton.focus({ preventScroll: true });
});
attemptForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const answer = attempt.value.trim();
  if (!answer) {
    report('照着上面的小任务写一点，也可以按麦克风说。');
    attempt.focus();
    return;
  }
  turn('attempt', answer);
});

byId('restart-problem').addEventListener('click', () => {
  waitFor(byId('lesson-status'), '🐠 鱼渔正在准备第一步…', async () => {
    const prior = entry;
    if (!prior.challenge) {
      await begin(await request('start', { problem: prior.problem, entryId: prior.id }), prior);
      return;
    }
    const { entries } = await loadJournal();
    const original = entries.find((item) => item.id === prior.parentId);
    if (!canStartChallenge(original)) throw new Error('题目本里找不到原题，可以先做一道新题。');
    await begin(await requestChallenge(original), prior);
  });
});

async function requestChallenge(original) {
  const reply = await request('challenge', {
    token: original.completionToken,
    parentId: original.id,
    legacyProblem: original.completionToken ? undefined : original.problem,
  });
  if (reply.challenge !== true || reply.parentId !== original.id || !reply.entryId) {
    throw new Error('这道相似题没准备好，请再试一次。');
  }
  return reply;
}

function startChallenge(original, statusContainer) {
  if (busy || !canStartChallenge(original)) return;
  waitFor(statusContainer, '🐠 鱼渔正在找一道相似题…', async () => {
    const { entries } = await loadJournal();
    const saved = entries.find((item) => item.parentId === original.id);
    if (saved) openEntry(saved);
    else await begin(await requestChallenge(original));
  });
}

byId('start-challenge').addEventListener('click', () => startChallenge(entry, byId('completion-status')));
byId('review-challenge').addEventListener('click', () => startChallenge(entry, byId('lesson-status')));

function nextProblem() {
  entry = null;
  reviewingSolution = false;
  messages.replaceChildren();
  byId('problem-view').textContent = problem.value = attempt.value = '';
  clearPhoto();
  confirming = false;
  startButton.textContent = '和鱼渔想一想 →';
  openView('study');
}
byId('new-problem').addEventListener('click', nextProblem);
byId('next-problem').addEventListener('click', nextProblem);
byId('review-solution').addEventListener('click', () => {
  reviewingSolution = true;
  byId('conversation').open = true;
  openView('study');
});
byId('completion').addEventListener('animationend', (event) => {
  if (event.animationName === 'completion-bob') byId('completion').classList.remove('just-earned');
});

function openView(next, focus = true, keepStatus = false) {
  if (next !== view || next !== 'study' || !entry) {
    voice.stopReading();
    voice.cancelRecord();
  }
  view = next;
  byId('hero').hidden = start.hidden = next !== 'study' || !!entry;
  byId('continue-card').hidden = next !== 'study' || !latestUnfinished || !!entry;
  const completion = next === 'study' && entry?.solved && !reviewingSolution;
  lesson.hidden = next !== 'study' || !entry || completion;
  byId('completion').hidden = !completion;
  byId('history').hidden = next !== 'history';
  byId('reef').hidden = next !== 'reef';
  for (const tab of document.querySelectorAll('[data-tab]')) {
    if (tab.dataset.view === next) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  report(keepStatus ? status.textContent : '');
  if (next === 'history') refreshHistory();
  if (next === 'reef') refreshReef();
  if (next === 'study' && !entry) refreshHome();
  if (focus) {
    window.scrollTo({ top: 0 });
    if (completion) byId('completion-title').focus();
    else byId(next === 'study' ? (entry ? 'lesson-title' : 'start-title') : next + '-title').focus({ preventScroll: true });
  }
}

for (const item of navigation) item.addEventListener('click', () => openView(item.dataset.view));

function openEntry(item) {
  entry = item;
  attempt.value = item.carriedAttempt || '';
  reviewingSolution = Boolean(item.solved);
  byId('conversation').open = reviewingSolution;
  renderLesson();
  openView('study');
}

async function refreshHome() {
  try {
    const data = await loadJournal();
    updateShells(data.shells);
    latestUnfinished = data.entries.filter((item) => !item.solved).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    byId('continue-card').hidden = view !== 'study' || !!entry || !latestUnfinished;
    if (latestUnfinished) byId('continue-problem').textContent = latestUnfinished.problem;
  } catch {
    byId('continue-card').hidden = true;
  }
}

byId('continue-button').addEventListener('click', () => {
  if (!busy && latestUnfinished) openEntry(latestUnfinished);
});

async function refreshHistory(refresh = true) {
  const version = ++loadVersion;
  const list = byId('history-list');
  const empty = byId('history-empty');
  try {
    const { entries, shells: count, local, family } = await loadJournal({ refresh });
    if (version !== loadVersion || view !== 'history') return;
    updateShells(count);
    byId('history-storage').textContent = family
      ? '题目本会跟着家庭账号同步。'
      : '访客记录存在当前浏览器，登录家庭账号后可以带到其他设备。';
    list.replaceChildren();
    const query = byId('history-search').value.trim().toLowerCase();
    const filtered = entries.filter((item) => {
      const statusMatches = historyFilter === 'all' || (historyFilter === 'done') === item.solved;
      return statusMatches && item.problem.toLowerCase().includes(query);
    });
    empty.hidden = !!filtered.length;
    empty.textContent = entries.length ? '这里没有符合的题，换个词或筛选试试看。' : '还没有题目。第一次和鱼渔解题后，就会出现在这里。';
    if (!local) report('这个浏览器只允许临时记录，关闭页面后会消失。');
    for (const item of filtered.sort((a, b) => b.updatedAt - a.updatedAt)) {
      const article = node('article', 'history-item');
      const meta = node('div', 'history-meta');
      meta.append(node('span', item.solved ? 'flag solved' : 'flag', item.solved ? '✓ 已解开' : '还在想'),
        node('time', '', dateLabel.format(item.updatedAt)));
      const title = node('p', 'history-problem', item.problem);
      const actions = node('div', 'history-actions');
      const open = node('button', 'button secondary', item.solved ? '看解题记录' : '接着做');
      open.type = 'button';
      open.disabled = busy;
      open.addEventListener('click', () => openEntry(item));
      actions.append(open);
      if (canStartChallenge(item)) {
        const challenge = node('button', 'button secondary history-challenge', '挑战相似题');
        challenge.type = 'button';
        challenge.disabled = busy;
        challenge.setAttribute('aria-controls', 'history-status');
        challenge.addEventListener('click', () => startChallenge(item, byId('history-status')));
        actions.append(challenge);
      }
      const remove = node('button', 'quiet', '删除');
      remove.type = 'button';
      remove.disabled = busy;
      remove.addEventListener('click', () => askToDelete(item.id));
      actions.append(remove);
      article.append(meta, title, actions);
      list.append(article);
    }
  } catch {
    if (view === 'history') report('题目本没能打开，可以稍后再试。');
  }
}

byId('history-search').addEventListener('input', () => refreshHistory(false));
for (const filter of document.querySelectorAll('[data-filter]')) {
  filter.addEventListener('click', () => {
    historyFilter = filter.dataset.filter;
    for (const button of document.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button === filter));
    refreshHistory(false);
  });
}

function askToDelete(id) {
  deleteTarget = id;
  byId('delete-title').textContent = id ? '删除这道题？' : '清空题目本？';
  const location = familyName ? '家庭账号' : '当前浏览器';
  byId('delete-copy').textContent = id
    ? `这道题会从${location}删除，已经拿到的贝壳会留下。`
    : `${location}里的题目会被删除，已经拿到的贝壳会留下。`;
  const dialog = byId('delete-history');
  dialog.returnValue = '';
  dialog.showModal();
}

byId('delete-history').addEventListener('close', async (event) => {
  if (event.currentTarget.returnValue !== 'delete') return;
  try {
    await removeEntries(deleteTarget);
    if (!deleteTarget || entry?.id === deleteTarget) entry = null;
    openView(view, false);
  } catch (error) {
    report(error.message || '记录暂时没能删除，请再试一次。');
  }
});

function renderReef() {
  byId('reef-count').textContent = '🐚 ' + shells + ' 枚贝壳';
  const next = rewardLevels.find((level) => level.goal > shells);
  byId('reef-progress-label').textContent = next
    ? `再收集 ${next.goal - shells} 枚，就能遇见「${next.name}」。`
    : '图鉴里的海洋伙伴都到齐啦！';
  const progress = byId('reef-progress');
  progress.max = next?.goal || rewardLevels.at(-1).goal;
  progress.value = Math.min(shells, progress.max);
  const stickers = byId('stickers');
  stickers.replaceChildren();
  for (const level of rewardLevels) {
    const collected = shells >= level.goal;
    const card = node('article', 'sticker ' + (collected ? level.color : 'locked'));
    const icon = node('span', 'sticker-icon', collected ? level.icon : '✧');
    icon.setAttribute('aria-hidden', 'true');
    card.append(icon, node('strong', '', level.name),
      node('span', 'sticker-caption', collected ? '已遇见' : `${level.goal} 枚贝壳`));
    stickers.append(card);
  }
}

async function refreshReef() {
  try {
    const data = await loadJournal();
    updateShells(data.shells);
  } catch {}
  renderReef();
}

byId('about-button').addEventListener('click', () => byId('about').showModal());
byId('clear-history').addEventListener('click', () => {
  byId('about').close();
  askToDelete(null);
});

function selectFamilyMode(mode) {
  familyMode = mode;
  byId('family-login').setAttribute('aria-pressed', String(mode === 'login'));
  byId('family-create').setAttribute('aria-pressed', String(mode === 'register'));
  byId('family-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  byId('family-submit').textContent = mode === 'login' ? '登录' : '创建家庭账号';
  byId('family-error').textContent = '';
}

async function renderFamily() {
  const { family, syncState, canImport } = await familyInfo();
  familyName = family?.name || '';
  const signedIn = Boolean(family && syncState !== 'expired');
  byId('family-nav-text').textContent = family ? '我的家庭' : '家庭账号';
  byId('family-auth').hidden = signedIn;
  byId('family-signed-in').hidden = !signedIn;
  byId('family-import-area').hidden = !canImport;
  byId('family-signed-name').textContent = familyName;
  byId('family-sync-status').textContent = syncState === 'synced'
    ? '题目和贝壳已同步'
    : '正在等待同步。联网后可再试一次。';
  if (syncState === 'expired') {
    byId('family-name').value = familyName;
    byId('family-error').textContent = '登录已过期，请重新登录。';
  }
}

async function withFamilyAction(task) {
  if (familyBusy) return;
  familyBusy = true;
  const buttons = [...byId('family-dialog').querySelectorAll('button')];
  for (const button of buttons) button.disabled = true;
  byId('family-error').textContent = '正在处理…';
  try {
    const message = await task();
    byId('family-error').textContent = message || '';
    await renderFamily();
  } catch (error) {
    byId('family-error').textContent = error instanceof TypeError ? '网络暂时连不上，请再试一次。' : error.message;
  } finally {
    familyBusy = false;
    for (const button of buttons) button.disabled = false;
  }
}

byId('family-open').addEventListener('click', async () => {
  byId('family-error').textContent = '';
  byId('family-password').value = '';
  byId('family-dialog').showModal();
  await renderFamily();
});
byId('family-dialog').addEventListener('cancel', (event) => {
  if (familyBusy) event.preventDefault();
});
byId('family-login').addEventListener('click', () => selectFamilyMode('login'));
byId('family-create').addEventListener('click', () => selectFamilyMode('register'));
byId('family-form').addEventListener('submit', (event) => {
  event.preventDefault();
  withFamilyAction(async () => {
    const previousFamily = familyName;
    const family = await signIn(familyMode, {
      name: byId('family-name').value.trim().toLowerCase(),
      password: byId('family-password').value,
    });
    byId('family-password').value = '';
    if (family.name !== previousFamily) nextProblem();
    else refreshCurrentView();
    return familyMode === 'register' ? '账号已创建。其他设备可以用同一个账号登录。' : '已登录。';
  });
});
byId('family-refresh').addEventListener('click', () => withFamilyAction(async () => {
  const data = await loadJournal();
  updateShells(data.shells);
  refreshCurrentView(false);
}));
byId('family-import').addEventListener('click', () => withFamilyAction(async () => {
  const data = await importLocalJournal();
  updateShells(data.shells);
  refreshCurrentView(false);
  return '这台设备的题目和贝壳已加入家庭账号。';
}));
byId('family-logout').addEventListener('click', () => withFamilyAction(async () => {
  await signOut();
  byId('family-name').value = '';
  selectFamilyMode('login');
  nextProblem();
  return '已退出家庭账号。';
}));

async function refreshCurrentView(refresh = true) {
  if (view === 'history') return refreshHistory(refresh);
  if (view === 'reef') return refreshReef();
  if (!entry) return refreshHome();
  try {
    const data = await loadJournal({ refresh });
    updateShells(data.shells);
    if (!data.family || busy || voice.recordingButton) return;
    const fresh = data.entries.find((item) => item.id === entry?.id);
    if (!fresh || fresh.revision === entry.revision) return;
    const draft = attempt.value;
    const justCompleted = !entry.solved && fresh.solved;
    voice.stopReading();
    entry = fresh;
    attempt.value = draft || fresh.carriedAttempt || '';
    renderLesson();
    if (justCompleted) openView('study');
    report('已接上另一台设备的最新进度。');
  } catch {}
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !busy) refreshCurrentView();
});
window.addEventListener('online', () => refreshCurrentView());
window.addEventListener('pagehide', () => {
  voice.cancelRecord();
  voice.stopReading();
});
refreshHome().then(renderFamily).catch(() => {});
