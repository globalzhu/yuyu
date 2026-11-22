import { memberFetch, reloadAccount } from './member-fetch.js';
import { equipItem, verifyFamilySession, saveNickname, managePassword, familyInfo, restoreHistory, redeemGift, giftShop, loadJournal, purchaseItem, removeEntries, saveEntry, signOut } from './journal.js?v=12';
import { createVoice } from './voice.js?v=6';
import { createPhotoCropper } from './crop.js?v=1';
import { createWardrobe } from './wardrobe.js?v=3';
import { emptyWardrobe } from './wardrobe-catalog.mjs?v=2';
import { createLeaderboard, createPractice } from './practice.js?v=3';

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
let earnedShells = 0;
let giftSpent = 0;
let walletOwner = '家庭账号';
let currentWardrobe = emptyWardrobe();
let activeActivity;
let historyFilter = 'all';
let deleteTarget;
let loadVersion = 0;
let latestUnfinished;
let reviewingSolution = false;
let stepCursor = null;
let liveDraft = '';
let reviewHint;

function shownStep() {
  return stepCursor ?? ((entry?.turns.length ?? 0) - 1);
}

function answerSteps() {
  return (entry?.turns || []).flatMap((turn, index, turns) =>
    index === turns.length - 1 || turns[index + 1].attempt ? [index] : []);
}

function latestStep() {
  stepCursor = null;
  liveDraft = '';
  reviewHint = undefined;
}
let familyName = '';
let familyBusy = false;
const photoCropper = createPhotoCropper();

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

const wardrobeUI = createWardrobe({
  async purchase(itemId) {
    const data = await purchaseItem(itemId);
    updateEconomy(data);
    renderReef();
    refreshGifts();
    if (familyName) refreshLeaderboard();
    return data;
  },
  async equip(slot, itemId) {
    const data = await equipItem(slot, itemId);
    updateEconomy(data);
    if (familyName) refreshLeaderboard();
    return data;
  },
  report,
});

const practiceUI = createPractice({
  async openQuestion(question) {
    const data = await loadJournal();
    updateEconomy(data);
    const saved = data.entries.find((item) => item.id === question.entryId);
    if (!saved) throw new Error('这道题还没同步好，请重新打开闯关。');
    openEntry(saved);
  },
  report,
});
const leaderboardUI = createLeaderboard({ refresh: fetchLeaderboard, report });

function updateControls() {
  const mic = voice.recordingButton;
  const blocked = busy || Boolean(mic);
  startButton.disabled = blocked || photoLoading;
  photoInput.disabled = cameraInput.disabled = byId('paste-photo').disabled = blocked || photoLoading;
  byId('prev-step').disabled = blocked || answerSteps().indexOf(shownStep()) <= 0;
  byId('forward-step').disabled = blocked;
  hintButton.disabled = blocked;
  byId('send-attempt').disabled = blocked;
  byId('new-problem').disabled = byId('restart-problem').disabled = busy;
  byId('next-problem').disabled = byId('review-solution').disabled = busy;
  byId('start-challenge').disabled = byId('review-challenge').disabled = busy;
  byId('start-practice').disabled = byId('review-practice').disabled = busy;
  byId('speak-problem').disabled = busy || photoLoading || Boolean(mic && mic.id !== 'speak-problem') || voice.transcribing;
  byId('speak-attempt').disabled = busy || Boolean(mic && mic.id !== 'speak-attempt') || voice.transcribing;
  problem.readOnly = attempt.readOnly = blocked;
  for (const button of practice) button.disabled = blocked || photoLoading;
  for (const button of stepChoices.children) button.disabled = blocked;
  for (const button of navigation) button.disabled = busy || photoLoading;
  for (const button of byId('history-list').querySelectorAll('button')) button.disabled = busy;
  byId('family-open').disabled = busy || photoLoading;
  byId('continue-button').disabled = busy || photoLoading;
  byId('remove-photo').disabled = busy || photoLoading;
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
  const response = await memberFetch('api/' + action, {
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
    return await photoCropper.choose(picture);
  } catch {
    throw new Error('这张照片打不开。试试重新拍一张，或选 JPG / PNG 照片。');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function selectPhoto(file) {
  if (!file || busy || photoLoading || voice.recordingButton || start.hidden) return;
  const version = ++photoVersion;
  const previous = { image, confirming, buttonText: startButton.textContent };
  photoLoading = true;
  updateControls();
  report('正在准备照片…', start);
  try {
    const encoded = await preparePhoto(file);
    if (version !== photoVersion) return;
    if (!encoded) {
      image = previous.image;
      confirming = previous.confirming;
      startButton.textContent = previous.buttonText;
      report('', start);
      return;
    }
    confirming = false;
    image = encoded;
    byId('photo-thumb').src = encoded;
    byId('photo-preview').hidden = false;
    startButton.textContent = '读一读照片 →';
    report('', start);
  } catch (error) {
    if (version !== photoVersion) return;
    report(error.message, start);
  } finally {
    if (version === photoVersion) {
      photoLoading = false;
      photoInput.value = cameraInput.value = '';
      updateControls();
    }
  }
}

for (const input of [photoInput, cameraInput]) {
  input.addEventListener('change', () => selectPhoto(input.files[0]));
}

function embeddedPhoto(html) {
  if (!html || !html.includes('data:image/') || html.length > 49_000_000) return;
  // Template contents stay inert; only decode embedded raster data copied with the image.
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const img of template.content.querySelectorAll('img[src]')) {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\s]+)$/i.exec(img.getAttribute('src'));
    if (!match) continue;
    try {
      const binary = atob(match[2]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: match[1] });
    } catch { continue; }
  }
}

function transferredImage(data) {
  const files = [...(data?.files || [])];
  for (const item of data?.items || []) {
    if (item.kind === 'file') files.push(item.getAsFile());
  }
  return files.find(file => file?.type.startsWith('image/')) || embeddedPhoto(data?.getData('text/html'));
}

problem.addEventListener('paste', event => {
  const file = transferredImage(event.clipboardData);
  if (!file) return;
  event.preventDefault();
  selectPhoto(file);
});

const problemForm = byId('problem-form');
problemForm.addEventListener('dragover', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  problemForm.classList.add('image-over');
});
problemForm.addEventListener('dragleave', event => {
  if (!problemForm.contains(event.relatedTarget)) problemForm.classList.remove('image-over');
});
problemForm.addEventListener('drop', event => {
  problemForm.classList.remove('image-over');
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  const file = transferredImage(event.dataTransfer);
  if (file) selectPhoto(file);
  else report('请拖一张题目照片进来。', start);
});

byId('paste-photo').addEventListener('click', async () => {
  const version = photoVersion;
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find(type => type.startsWith('image/'));
        const file = type ? await item.getType(type) : item.types.includes('text/html')
          ? embeddedPhoto(await (await item.getType('text/html')).text()) : undefined;
        if (file) {
          if (version === photoVersion) await selectPhoto(file);
          return;
        }
      }
    }
  } catch { /* The system paste menu can still supply the image. */ }
  if (start.hidden || version !== photoVersion) return;
  problem.focus();
  report('先复制一张照片，再长按输入框选“粘贴”。有键盘也可以按 ⌘V 或 Ctrl+V。', start);
});

for (const input of [problem, attempt]) {
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.isComposing) return;
    event.preventDefault();
    if (!input.readOnly && !photoLoading) input.form.requestSubmit();
  });
}

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
  const index = shownStep();
  const last = reviewHint || entry.turns[index];
  const steps = answerSteps();
  const position = steps.indexOf(index) + 1;
  const reviewing = stepCursor !== null;
  const stageNumber = last.stage ?? entry.stage;
  byId('step-nav').hidden = steps.length < 2;
  byId('prev-step').disabled = busy || position <= 1;
  byId('forward-step').hidden = !reviewing;
  byId('step-position').textContent = (reviewing ? '回看第 ' : '第 ') + position + ' 步';
  byId('send-attempt').textContent = reviewing ? '从这一步继续 →' : '检查这一步 →';
  byId('lesson-title').textContent = entry.solved ? '解法回顾' : '一起解题';
  byId('problem-view').textContent = entry.problem;
  byId('lesson-subtitle').textContent = entry.activityId ? `三题闯关 · 第 ${entry.activityIndex + 1} 题`
    : entry.challenge ? '相似题挑战 · 试试刚学的办法'
    : entry.example ? '跟着鱼渔练一练' : '小学四年级 · 一次做一步';
  byId('review-challenge').hidden = !canStartChallenge(entry);
  byId('review-practice').hidden = !canStartPractice(entry) && !entry.activityId;
  for (const stage of stages) {
    const i = Number(stage.dataset.stage);
    stage.classList.toggle('done', entry.solved || i < stageNumber);
    if (!entry.solved && i === stageNumber) stage.setAttribute('aria-current', 'step');
    else stage.removeAttribute('aria-current');
  }
  byId('current-step').dataset.feedback = last.feedback || '';
  const hintTitle = last.feedback === 'hint' && last.hintLevel > 0
    ? `第 ${last.hintLevel} 个提示`
    : feedbackTitles[last.feedback];
  byId('step-title').textContent = entry.solved && !reviewing
    ? '这道题解开啦'
    : hintTitle || '现在做这一步';
  byId('step-note').textContent = last.note || '';
  byId('step-note').hidden = !last.note;
  byId('step-task').textContent = last.task || last.message || '';
  byId('step-task').hidden = !last.task && !!last.note;
  byId('listen-step').textContent = entry.solved && !reviewing ? '🔊 听总结' : '🔊 听提示';
  const format = inputFormats[last.format] || inputFormats.phrase;
  const hasChoices = renderStepChoices(last.choices);
  byId('attempt-label').textContent = hasChoices ? '也可以自己填' : format.title;
  attempt.placeholder = format.placeholder;
  attempt.rows = hasChoices ? 1 : 2;
  attempt.inputMode = last.format === 'number' ? 'decimal' : 'text';
  const recentAnswer = entry.turns.slice(0, index + 1).reverse().find((turn) => turn.attempt)?.attempt;
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
  const offersPractice = canStartPractice(entry) || Boolean(entry.activityId);
  byId('start-practice').hidden = !offersPractice;
  byId('start-practice').textContent = entry.activityId ? '查看闯关进度 →' : '三题闯关 →';
  byId('next-problem').classList.toggle('primary', !offersPractice && !offersChallenge);
  byId('next-problem').classList.toggle('secondary', offersPractice || offersChallenge);
  byId('completion-title').textContent = entry.activityId ? '这一关解开啦！' : entry.challenge ? '相似题挑战完成！' : '这道题做完啦！';
  byId('completion-encouragement').textContent = entry.challenge
    ? '刚学的办法，你又用对了一次。'
    : '你一步一步把题解开了。';
  byId('completion').classList.toggle('just-earned', Boolean(award?.awarded));
  reward.hidden = !award?.awarded && !award?.pending;
  byId('completion-reward-text').textContent = award?.activityBonusAwarded?.includes(entry.parentId)
    ? '本题 1 枚，闯关奖励再得 2 枚贝壳！'
    : !award?.awarded ? '贝壳会在同步后到账' : entry.challenge ? '再收到 1 枚贝壳' : '收到 1 枚贝壳';
  const unlocked = award?.awarded && rewardLevels.find((level) => level.goal === earnedShells);
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
    stage: reply.stage, attempt: answer, note: reply.note, task: reply.task, format: reply.format, choices: reply.choices,
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

function canStartPractice(item) {
  return Boolean(item && !item.challenge && !item.parentId && (item.token || item.completionToken || item.solved));
}

function updateEconomy(data) {
  shells = data.shells;
  giftSpent = data.giftSpent ?? giftSpent;
  earnedShells = data.earnedShells ?? data.shells;
  currentWardrobe = data.wardrobe || currentWardrobe;
  byId('shell-count').textContent = shells;
  wardrobeUI.render({ shells, earnedShells, wardrobe: currentWardrobe });
}

async function persist() {
  try {
    const local = entry;
    const award = await saveEntry(entry);
    updateEconomy(award);
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

function entryFromReply(reply, prior) {
  const now = Date.now();
  return {
    id: prior?.id || reply.entryId || crypto.randomUUID(), createdAt: prior?.createdAt || now, updatedAt: now,
    problem: reply.problem, token: reply.token, stage: reply.stage, example: reply.example,
    solved: reply.solved, revision: prior?.revision, turns: [...(prior?.turns || []), lessonTurn(reply)],
    challenge: reply.challenge === true, parentId: reply.parentId, completionToken: reply.completionToken,
    activityId: reply.activityId, activityIndex: reply.activityIndex,
  };
}

async function begin(reply, prior) {
  latestStep();
  entry = entryFromReply(reply, prior);
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
addListening(byId('listen-step'), () => reviewHint?.message || entry?.turns[shownStep()]?.message || '');
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

function goToStep(direction) {
  const steps = answerSteps();
  const index = steps[steps.indexOf(shownStep()) + direction];
  if (busy || voice.recordingButton || index === undefined) return;
  reviewHint = undefined;
  voice.stopReading();
  if (stepCursor === null) liveDraft = attempt.value;
  stepCursor = index === entry.turns.length - 1 ? null : index;
  attempt.value = stepCursor === null ? liveDraft : entry.turns[index + 1]?.attempt || '';
  report('');
  renderLesson();
  updateChoiceSelection();
}

byId('prev-step').addEventListener('click', () => goToStep(-1));
byId('forward-step').addEventListener('click', () => goToStep(1));

function turn(action, answer = '') {
  const waiting = action === 'hint' ? '🐠 鱼渔正在找提示…' : '🐠 鱼渔正在想…';
  return waitFor(byId('lesson-status'), waiting, async () => {
    voice.stopReading();
    let reply;
    let token = entry.token;
    const index = shownStep();
    const previous = entry.turns[index];
    if (reviewHint) token = reviewHint.token;
    else if (stepCursor !== null) {
      const later = entry.turns.slice(index + 1);
      const restored = await request('rewind', { token, checkpoint: previous.resumeToken, task: previous.task,
        accepted: later.filter(turn => turn.feedback === 'correct_step').length,
        answers: later.filter(turn => turn.attempt).length });
      token = restored.token;
    }
    try {
      reply = await request(action, { token, entryId: entry.id, attempt: answer });
    } catch (error) {
      if (error.status !== 409 || stepCursor !== null) throw error;
      entry.expired = true;
      report('');
      renderLesson();
      await persist();
      byId('restart-problem').focus({ preventScroll: true });
      return;
    }
    report('');
    if (stepCursor !== null && action === 'hint') {
      reviewHint = reply;
      renderLesson();
      updateChoiceSelection();
      return;
    }
    if (answer) attempt.value = '';
    entry.turns = entry.turns.slice(0, index + 1);
    if (reviewHint) {
      entry.turns.push(lessonTurn(reviewHint));
    }
    if (action === 'attempt') {
      const from = entry.turns.at(-1);
      from.resumeToken = token;
      if (stepCursor === null) from.stage ??= entry.stage;
    }
    latestStep();
    Object.assign(entry, { stage: reply.stage, solved: reply.solved, token: reply.token, updatedAt: Date.now() });
    if (reply.completionToken) entry.completionToken = reply.completionToken;
    saveTurn(reply, action, answer);
    // Completed lessons only need the readable history. Limit large AI contexts in unfinished journals.
    let remaining = entry.solved ? 0 : 128_000;
    for (let i = entry.turns.length - 1; i >= 0; i--) {
      const turn = entry.turns[i];
      if (!turn.resumeToken) continue;
      if (turn.resumeToken.length > remaining) delete turn.resumeToken;
      else remaining -= turn.resumeToken.length;
    }
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

async function loadActivity(original, data) {
  let saved = data.entries.filter((item) => item.parentId === original.id && item.activityId);
  if (saved.length < 3) {
    const group = await request('activity', {
      parentId: original.id, token: original.completionToken || original.token,
      legacyProblem: original.completionToken || original.token ? undefined : original.problem,
    });
    for (const reply of group.questions) {
      if (data.entries.some((item) => item.id === reply.entryId)) continue;
      await saveEntry(entryFromReply(reply));
    }
    data = await loadJournal();
    saved = data.entries.filter((item) => item.activityId === group.activityId);
  }
  saved.sort((a, b) => a.activityIndex - b.activityIndex);
  if (saved.length !== 3) throw new Error('三道题还没同步完整，请联网后再试。');
  updateEconomy(data);
  activeActivity = {
    activityId: saved[0].activityId, parentId: original.id,
    questions: saved.map((item) => ({ entryId: item.id, problem: item.problem })),
    bonusAwarded: data.awardedActivityIds?.includes(saved[0].activityId),
  };
  practiceUI.render(activeActivity, data.entries, data);
}

function startPractice(original = entry, near) {
  const area = near || byId(view === 'history' ? 'history-status' : entry?.solved ? 'completion-status' : 'lesson-status');
  waitFor(area, '🐠 鱼渔在准备三道同类题…', async () => {
    const data = await loadJournal();
    const source = original.activityId ? data.entries.find((item) => item.id === original.parentId) : original;
    if (!canStartPractice(source)) throw new Error('先打开原题，再来三题闯关吧。');
    await loadActivity(source, data);
    report('');
    openView('practice');
  });
}

byId('start-practice').addEventListener('click', () => startPractice());
byId('review-practice').addEventListener('click', () => startPractice());
byId('visit-shells').addEventListener('click', () => wardrobeUI.showShells());
byId('jump-leaderboard').addEventListener('click', () => {
  const title = byId('leaderboard-title');
  title.tabIndex = -1;
  title.focus({ preventScroll: true });
  byId('leaderboard').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});

async function refreshPractice() {
  if (!activeActivity) return;
  const data = await loadJournal();
  updateEconomy(data);
  activeActivity.bonusAwarded = data.awardedActivityIds?.includes(activeActivity.activityId);
  practiceUI.render(activeActivity, data.entries, data);
}

async function fetchLeaderboard() {
  const response = await memberFetch('api/leaderboard', { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '学习榜暂时没打开，稍后再刷新吧。');
  return result;
}

async function refreshLeaderboard() {
  leaderboardUI.loading(true);
  try { leaderboardUI.render(await fetchLeaderboard()); }
  catch { report('学习榜暂时没打开，稍后可以再刷新。', byId('leaderboard')); }
  finally { leaderboardUI.loading(false); }
}

function nextProblem() {
  latestStep();
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
  byId('study-desk').hidden = byId('hero').hidden = start.hidden = next !== 'study' || !!entry;
  byId('continue-card').hidden = next !== 'study' || !latestUnfinished || !!entry;
  const completion = next === 'study' && entry?.solved && !reviewingSolution;
  lesson.hidden = next !== 'study' || !entry || completion;
  byId('completion').hidden = !completion;
  byId('history').hidden = next !== 'history';
  byId('reef').hidden = next !== 'reef';
  byId('practice').hidden = next !== 'practice';
  for (const tab of document.querySelectorAll('[data-tab]')) {
    if (tab.dataset.view === next) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  report(keepStatus ? status.textContent : '');
  if (next === 'history') refreshHistory();
  if (next === 'reef') refreshReef();
  if (next === 'practice') refreshPractice();
  if (next === 'study' && !entry) refreshHome();
  if (focus) {
    window.scrollTo({ top: 0 });
    if (completion) byId('completion-title').focus();
    else byId(next === 'study' ? (entry ? 'lesson-title' : 'start-title') : next + '-title').focus({ preventScroll: true });
  }
}

for (const item of navigation) item.addEventListener('click', () => openView(item.dataset.view));

function openEntry(item) {
  latestStep();
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
    updateEconomy(data);
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
    const data = await loadJournal({ refresh });
    const { entries, local } = data;
    if (version !== loadVersion || view !== 'history') return;
    updateEconomy(data);
    byId('history-storage').textContent = '题目本会跟着家庭账号同步。';
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
      if (item.activityId) meta.append(node('span', 'flag', `闯关 ${item.activityIndex + 1} / 3`));
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
      if (canStartPractice(item) || item.activityId) {
        const activity = node('button', 'button secondary', item.activityId ? '查看闯关' : '三题闯关');
        activity.type = 'button';
        activity.disabled = busy;
        activity.addEventListener('click', () => startPractice(item, byId('history-status')));
        actions.append(activity);
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
  byId('wallet-source').textContent = walletOwner + '累计获得 ' + earnedShells + ' 枚贝壳，装扮用了 ' + (earnedShells - shells - giftSpent) + ' 枚，礼物用了 ' + giftSpent + ' 枚。';
  byId('reef-count').textContent = '累计获得 ' + earnedShells + ' 枚';
  const next = rewardLevels.find((level) => level.goal > earnedShells);
  byId('reef-progress-label').textContent = next
    ? `再收集 ${next.goal - earnedShells} 枚，就能遇见「${next.name}」。`
    : '图鉴里的海洋伙伴都到齐啦！';
  const progress = byId('reef-progress');
  progress.max = next?.goal || rewardLevels.at(-1).goal;
  progress.value = Math.min(earnedShells, progress.max);
  const stickers = byId('stickers');
  stickers.replaceChildren();
  for (const level of rewardLevels) {
    const collected = earnedShells >= level.goal;
    const card = node('article', 'sticker ' + (collected ? level.color : 'locked'));
    const icon = node('span', 'sticker-icon', collected ? level.icon : '✧');
    icon.setAttribute('aria-hidden', 'true');
    card.append(icon, node('strong', '', level.name),
      node('span', 'sticker-caption', collected ? '已遇见' : `${level.goal} 枚贝壳`));
    stickers.append(card);
  }
}

let selectedGift;
let ordering = false;
const giftRequests = new Map();
async function refreshGifts() {
  try {
    const data = await giftShop();
    const list = byId('gift-list');
    list.replaceChildren();
    if (!data.gifts.length) list.append(node('p', 'small', '还没有上架的礼物。'));
    for (const gift of data.gifts) {
      const row = node('div', 'account-row');
      const title = node('div', '');
      title.append(node('b', '', gift.title), node('small', '', gift.price + ' 枚贝壳'));
      const btn = node('button', 'account-action', shells < gift.price ? '还差 ' + (gift.price - shells) + ' 枚' : '兑换礼物');
      btn.disabled = ordering || shells < gift.price;
      btn.onclick = () => {
        selectedGift = gift;
        byId('gift-confirm-text').textContent = '用 ' + gift.price + ' 枚贝壳兑换「' + gift.title + '」，还会剩下 ' + (shells - gift.price) + ' 枚。';
        byId('gift-confirm').returnValue = '';
        byId('gift-confirm').showModal();
      };
      row.append(title, btn); list.append(row);
    }
    const history = byId('gift-history');
    history.replaceChildren();
    const labels = { pending: '等候发放', delivered: '已发放', refunded: '已退回贝壳' };
    const lines = [...data.orders.map(o => ({ at:o.at, text:o.title + ' · ' + o.price + ' 枚 · ' + labels[o.status] })),
      ...data.grants.map(g => ({ at:g.at, text:'收到 ' + g.amount + ' 枚贝壳 · ' + g.reason }))];
    for (const line of lines.sort((a,b) => b.at-a.at)) history.append(node('p', '', dateLabel.format(line.at) + ' · ' + line.text));
    if (!lines.length) history.textContent = '还没有记录。';
    for (const o of data.orders) if (giftRequests.get(o.giftId) === o.id) giftRequests.delete(o.giftId);
  } catch (error) { byId('gift-status').textContent = error.message; }
}

byId('gift-confirm').addEventListener('close', async () => {
  const gift = selectedGift;
  if (byId('gift-confirm').returnValue !== 'yes' || !gift || ordering) return;
  ordering = true;
  const requestId = giftRequests.get(gift.id) || crypto.randomUUID();
  giftRequests.set(gift.id, requestId);
  try {
    const data = await redeemGift({ giftId: gift.id, price: gift.price, requestId });
    updateEconomy(data);
    renderReef();
    byId('gift-status').textContent = '兑换成功！可以在兑换记录里看发放进度。';
  } catch (error) { byId('gift-status').textContent = error.message; }
  finally { ordering = false; await refreshGifts(); }
});

async function refreshReef() {
  try {
    const data = await loadJournal();
    updateEconomy(data);
    walletOwner = '家庭账号 ' + data.family.name;
  } catch {}
  renderReef();
  refreshGifts();
  refreshLeaderboard();
}

byId('about-button').addEventListener('click', () => byId('about').showModal());
byId('clear-history').addEventListener('click', () => {
  byId('about').close();
  askToDelete(null);
});

function closeSecurity() {
  byId('nickname-form').hidden = true;
  byId('nickname-form').reset();
  byId('security-form').reset();
  byId('security-form').hidden = byId('issued-code').hidden = true;
  byId('code-value').textContent = '';
}

async function renderFamily() {
  const { family, syncState, hasArchive } = await familyInfo();
  familyName = family?.name || '';
  if (!family || syncState === 'expired') {
    if (syncState !== 'unknown') reloadAccount();
    return;
  }
  byId('family-nav-text').textContent = familyName;
  byId('family-open').setAttribute('aria-label', '用户中心，' + familyName);
  byId('family-open').title = '用户中心 · ' + familyName;
  byId('account-state').textContent = '已登录的家庭账号';
  byId('family-signed-name').textContent = familyName;
  byId('family-signed-in').hidden = false;
  byId('archive-area').hidden = !hasArchive;
  byId('family-sync-status').textContent = syncState === 'synced' ? '题目、贝壳和装扮已同步' : '等待联网同步';
  byId('public-nickname').textContent = family?.nickname || '';
  byId('recovery-state').textContent = family?.hasRecovery ? '已设置，由家长保管' : '尚未设置，忘记密码时可用';
  byId('open-code').textContent = family?.hasRecovery ? '更换找回码' : '设置找回码';

}

function announceAccountChange() {
  try { localStorage.setItem('yuyu-account-change', crypto.randomUUID()); } catch {}
}

async function checkAccount() {
  const changed = await verifyFamilySession();
  if (changed) return reloadAccount();
  await renderFamily();
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

byId('family-open').addEventListener('click', () => {
  byId('family-error').textContent = '';
  byId('family-dialog').showModal();
  withFamilyAction(async () => { await checkAccount(); });
});
byId('family-dialog').addEventListener('close', () => {
  closeSecurity();
});
byId('family-dialog').addEventListener('cancel', (event) => {
  if (familyBusy) event.preventDefault();
});
byId('edit-nickname').addEventListener('click', () => {
  closeSecurity();
  byId('nickname-form').hidden = false;
  byId('nickname').value = byId('public-nickname').textContent;
  byId('nickname').focus();
  byId('nickname').select();
});
byId('cancel-nickname').addEventListener('click', closeSecurity);
byId('nickname-form').addEventListener('submit', event => {
  event.preventDefault();
  withFamilyAction(async () => {
    await saveNickname(byId('nickname').value);
    closeSecurity();
    if (view === 'reef') await refreshLeaderboard();
    return '昵称已保存，学习榜也更新了。';
  });
});

function openSecurity(action) {
  closeSecurity();
  const changing = action === 'password';
  byId('security-form').dataset.action = action;
  byId('security-form').hidden = false;
  byId('change-fields').hidden = !changing;
  byId('new-password').required = byId('repeat-new').required = changing;
  byId('security-title').textContent = changing ? '修改登录密码' : byId('open-code').textContent;
  byId('security-help').textContent = changing ? '保存后，这台设备继续使用，其他设备需要用新密码登录。' : '请先验证当前密码。每次生成新码，之前的找回码就会失效。';
  byId('security-submit').textContent = changing ? '保存新密码' : '生成找回码';
  byId('family-error').textContent = '';
  byId('current-password').focus();
}
byId('open-password').addEventListener('click', () => openSecurity('password'));
byId('open-code').addEventListener('click', () => openSecurity('recovery-code'));
byId('security-cancel').addEventListener('click', closeSecurity);
byId('security-form').addEventListener('submit', (event) => {
  event.preventDefault();
  withFamilyAction(async () => {
    const action = byId('security-form').dataset.action;
    const fields = { currentPassword: byId('current-password').value };
    if (action === 'password') {
      fields.newPassword = byId('new-password').value;
      if (fields.newPassword !== byId('repeat-new').value) throw new Error('两次输入的新密码不同。');
    }
    const result = await managePassword(action, fields);
    closeSecurity();
    if (action === 'password') return '新密码已保存。';
    byId('code-value').textContent = result.code;
    byId('issued-code').hidden = false;
    byId('issued-code').scrollIntoView({ block: 'nearest' });
    return '找回码已生成。';
  });
});
byId('code-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText('鱼渔家庭账号 ' + familyName + '\n找回码 ' + byId('code-value').textContent);
    byId('family-error').textContent = '已复制，请家长妥善保存。';
  } catch {
    byId('family-error').textContent = '请长按或选中找回码，手动复制。';
  }
});
byId('restore-history').addEventListener('click', () => withFamilyAction(async () => {
  const count = await restoreHistory();
  await refreshCurrentView();
  return '已导入 ' + count + ' 道旧题。';
}));
byId('family-refresh').addEventListener('click', () => withFamilyAction(async () => {
  const data = await loadJournal();
  updateEconomy(data);
  refreshCurrentView(false);
}));
byId('family-logout').addEventListener('click', () => withFamilyAction(async () => {
  await signOut();
  announceAccountChange();
  reloadAccount();
}));

async function refreshCurrentView(refresh = true) {
  if (view === 'history') return refreshHistory(refresh);
  if (view === 'reef') return refreshReef();
  if (view === 'practice') return refreshPractice();
  if (!entry) return refreshHome();
  try {
    const data = await loadJournal({ refresh });
    updateEconomy(data);
    if (!data.family || busy || voice.recordingButton) return;
    const fresh = data.entries.find((item) => item.id === entry?.id);
    if (!fresh || fresh.revision === entry.revision) return;
    const draft = stepCursor === null ? attempt.value : liveDraft;
    const justCompleted = !entry.solved && fresh.solved;
    voice.stopReading();
    latestStep();
    entry = fresh;
    attempt.value = draft || fresh.carriedAttempt || '';
    renderLesson();
    if (justCompleted) openView('study');
    report('已接上另一台设备的最新进度。');
  } catch {}
}

async function refreshAccountAndView() {
  if (busy || familyBusy || document.hidden) return;
  try {
    await checkAccount();
    await refreshCurrentView();
    await renderFamily();
  } catch {}
}
document.addEventListener('visibilitychange', refreshAccountAndView);
window.addEventListener('online', refreshAccountAndView);
window.addEventListener('storage', (event) => {
  if (event.key === 'yuyu-account-change') reloadAccount();
});
window.addEventListener('pageshow', event => { if (event.persisted) reloadAccount(); });
window.addEventListener('pagehide', () => {
  voice.cancelRecord();
  voice.stopReading();
});
renderFamily().catch(() => {});
refreshHome().then(renderFamily).catch(() => {});
