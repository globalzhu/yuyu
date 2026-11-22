import { getFirstGuide } from './guides-first.mjs';
import { getSecondGuide } from './guides-second.mjs';
import { getThirdGuide } from './guides-third.mjs';
import { fallbackHint } from './tutor.mjs';

const digits = '零一二三四五六七八九';
const smallPlaces = { 千: 1000, 百: 100, 十: 10 };

function readGroup(group) {
  if (!group) return 0;
  const clean = group.replace(/^零+/, '');
  if (!/^(?:[一二三四五六七八九]千)?零?(?:[一二三四五六七八九]百)?零?(?:[一二三四五六七八九]?十)?零?[一二三四五六七八九]?$/.test(clean)) return null;
  let value = 0;
  for (const match of clean.matchAll(/([一二三四五六七八九])?([千百十])|([一二三四五六七八九])$/g)) {
    value += match[2] ? (match[1] ? digits.indexOf(match[1]) : 1) * smallPlaces[match[2]] : digits.indexOf(match[3]);
  }
  return value;
}

function readLargeNumber(number) {
  const match = /^(?:([零一二三四五六七八九十百千]+)亿)?(?:([零一二三四五六七八九十百千]+)万)?([零一二三四五六七八九十百千]*)$/.exec(number);
  if (!match) return null;
  const groups = match.slice(1).map(readGroup);
  return groups.some((group) => group === null) ? null : groups[0] * 100_000_000 + groups[1] * 10_000 + groups[2];
}

function zeroCountingGuide(problem) {
  const prompt = problem.normalize('NFKC').replace(/^\[按可见字形复原\]/, '').replace(/\s/g, '');
  const match = /^(?:\d+[.、])?([零一二三四五六七八九十百千万亿]+)(?:里有|写作)?\(\)个[0零][。?？]?$/.exec(prompt);
  if (!match) return null;
  const value = readLargeNumber(match[1]);
  if (value === null) return null;
  const written = String(value);
  const zeros = [...written].filter((digit) => digit === '0').length;
  const zeroWords = zeros < 10 ? digits[zeros] : '十' + (zeros === 10 ? '' : digits[zeros - 10]);
  return {
    steps: [
      {
        note: '大数从右往左四位一组。先找出题干里的亿级、万级和个级。',
        task: '把题干里的数写成一串数字。',
        hint: '从左边最高的一组开始写。右边每一组如果少于四位，就在这一组的前面补零。',
        hints: [
          '从题目最高的一级开始画框。其右边的每一级都留四格，再把这一组听到的数字写在框里最右边。',
          '把每个框左边剩下的空格补 0。再用手指从最左边的框走到最右边，把写好的数字连成一串。',
        ],
        format: 'number',
        check: (answer) => answer.normalize('NFKC').replace(/[,\s｜|]/g, '').replace(/[。！]$/, '') === written,
      },
      {
        note: '你把大数写出来了。',
        task: '在你写的数里数一数一共有几个 0。',
        hint: '可以从左往右把每个 0 圈起来，一个一个数。',
        hints: [
          '用手指一次只指一个数字。每碰到一个 0，就在下面画一笔。',
          '先把那串数字遮住。只数你刚画了多少笔，把笔画的个数填进去。',
        ],
        format: 'number',
        check: (answer) => new RegExp('^(?:' + zeros + '|' + zeroWords + ')(?:个(?:零|0)?)?[。！]?$')
          .test(answer.normalize('NFKC').trim()),
      },
    ],
    recap: '大数先按四位分组写，再逐个数零。',
  };
}

export function getGuide(problem, version) {
  return getFirstGuide(problem, version) || getSecondGuide(problem, version) || getThirdGuide(problem, version) || zeroCountingGuide(problem);
}

function smallerAction(task, choices) {
  const product = /(?:算|计算)\s*(\d+)\s*[×*]\s*(\d+)/.exec(task);
  if (product) {
    const [, left, multiplier] = product;
    const right = Number(multiplier);
    if (right > 0 && right <= 10) {
      return `在纸上写 ${right} 组，每组写 ${left}。再把这些组加起来。`;
    }
    const units = right % 10;
    if (units && right < 100) {
      return `在草稿纸上画两格。一格写 ${left} × ${right - units}，另一格写 ${left} × ${units}。算好后把两个得数加起来。`;
    }
  }
  if (/数位|万位|最高位|最低位|数的位数/.test(task)) {
    return '在纸上从最右边画一格，从个位往左指。用手指停在任务问的那一格，只先看这一格。';
  }
  if (choices?.length > 1 && /最大的一个|最小的一个|较大的那|较小的那|比较.{0,12}(?:大小|大|小)/.test(task)) {
    return '把要比的数上下对齐。用纸挡住右边，只露出最左一位。看不出大小，再往右露出一位。';
  }
  return '';
}

export function guidedHintLadder(step, accepted, initial, task, choices) {
  const hints = [];
  const key = (value) => value.normalize('NFKC').replace(/[\s。！!]/g, '');
  const shown = new Set([key(initial)]);
  function add(value) {
    if (typeof value !== 'string' || !value.trim() || shown.has(key(value))) return;
    hints.push(value.trim());
    shown.add(key(value));
  }
  for (const writer of [step.hint, ...(step.hints || [])]) {
    add(typeof writer === 'function' ? writer(accepted) : writer);
  }
  const simpler = [smallerAction(task, choices), ...[1, 2, 3].map((level) => fallbackHint(step.format, level))];
  for (const easier of simpler) {
    if (hints.length >= 3) break;
    const previous = hints.at(-1);
    if (easier && !shown.has(key(easier)) && !previous?.includes(easier)) {
      const combined = previous ? `${previous}\n${easier}` : easier;
      // The journal stores each note in 300 characters. For unusually long
      // clues, show the smaller action separately.
      add(combined.length <= 300 ? combined : easier);
      shown.add(key(easier));
    }
  }
  return hints;
}

const checkForms = {
  number: '再看一眼这一步要填的是哪个数。数好或算好后，只填这个数。',
  equation: '再看一眼算式里的两个数和中间的运算符号。按这一步的要求把算式写完整。',
  phrase: '再读一遍上面的小任务，只填它要找的那个词或短句。',
  sentence: '再读一遍上面的小任务。只写一句完整的话，让别人读得懂。',
};

export function guidedCheckForm(format, choices) {
  return choices?.length ? '再读一读这一步的要求，按要求点一个选项。' : checkForms[format];
}
