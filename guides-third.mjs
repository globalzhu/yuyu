function integerValue(value) {
  if (/^\d+$/u.test(value)) return Number(value);
  if (!/^[零〇一二两三四五六七八九十百千万]+$/u.test(value)) return NaN;
  const digits = '零一二三四五六七八九';
  const places = { 十: 10, 百: 100, 千: 1000 };
  let number = 0;
  let group = 0;
  let digit = 0;
  for (const character of value.replace(/两/gu, '二').replace(/〇/gu, '零')) {
    if (digits.includes(character)) digit = digits.indexOf(character);
    else if (character === '万') {
      number += (group + digit) * 10000;
      group = digit = 0;
    } else {
      group += (digit || 1) * places[character];
      digit = 0;
    }
  }
  return number + group + digit;
}

function answerValue(answer, unit, description) {
  if (typeof answer !== 'string') return NaN;
  let value = answer.normalize('NFKC').replace(/\s+/gu, '').replace(/等于/gu, '=')
    .replace(/^(?:答(?:案)?(?:是|为)?[：:]?|(?:得数|结果)(?:是|为)?|一共(?:是|有)?)/u, '')
    .replace(/[。！!]$/u, '');
  for (const suffix of [unit + description, unit]) {
    if (suffix && value.endsWith(suffix)) {
      value = value.slice(0, -suffix.length);
      break;
    }
  }
  const integer = integerValue(value);
  if (Number.isFinite(integer)) return integer;
  const converted = value.replace(/加上?/gu, '+').replace(/减去?/gu, '-')
    .replace(/[零〇一二两三四五六七八九十百千万]+/gu, (part) => String(integerValue(part)));
  const [expression, stated, ...extra] = converted.split('=');
  if (extra.length || !/^\d+(?:[+\-]\d+)+$/u.test(expression) ||
      (stated !== undefined && !/^\d+$/u.test(stated))) return NaN;
  const parts = expression.match(/[+\-]?\d+/gu);
  const result = parts.reduce((sum, part) => sum + Number(part), 0);
  return stated === undefined || Number(stated) === result ? result : NaN;
}

function parsePairs(problem) {
  if (typeof problem !== 'string') return null;
  const normalized = problem.normalize('NFKC').replace(/\s+/gu, '')
    .replace(/^(?:第\d+题[.、：:]?|\d+[.、：:])/u, '');
  const clauses = normalized.split(/[，,。；;？！!?]/u).filter(Boolean);
  const relation = /^(?:已知)?([\p{Script=Han}]{1,6}?)(?:和|与)([\p{Script=Han}]{1,6}?)(?:两人)?(?:一共|总共|合计|共)(?:剪了|制作了|折了|做了|收集了|采了|有|用了|买了|种了|画了)?(\d{1,6}|\(\)|多少)([幅张个本只颗枚朵件棵])([\p{Script=Han}]{0,10})$/u;
  const pairs = [];
  for (const clause of clauses) {
    const match = relation.exec(clause);
    if (!match) {
      // A caption or story setting may precede the four mathematical clauses.
      if (!pairs.length && !/[\d和与比倍多少相同一样每人]/u.test(clause)) continue;
      return null;
    }
    const [, first, second, quantity, unit, description] = match;
    if (first === second) return null;
    pairs.push({ names: [first, second], quantity: /^\d/u.test(quantity) ? Number(quantity) : null, unit, description });
  }
  if (pairs.length !== 4 || new Set(pairs.map(({ unit }) => unit)).size !== 1) return null;
  const descriptions = new Set(pairs.map(({ description }) => description).filter(Boolean));
  if (descriptions.size > 1 || new Set(pairs.flatMap(({ names }) => names)).size !== 4) return null;
  if (new Set(pairs.map(({ names }) => [...names].sort().join('|'))).size !== 4) return null;
  const known = pairs.filter(({ quantity }) => quantity !== null);
  const missing = pairs.filter(({ quantity }) => quantity === null);
  if (known.length !== 3 || missing.length !== 1) return null;
  const target = missing[0];
  const subtract = known.find(({ names }) => names.every((name) => !target.names.includes(name)));
  if (!subtract) return null;
  const addition = known.filter((pair) => pair !== subtract);
  if (new Set(addition.flatMap(({ names }) => names)).size !== 4) return null;
  const total = addition[0].quantity + addition[1].quantity;
  const result = total - subtract.quantity;
  if (result < 0) return null;
  // Check that all four children's quantities can be nonnegative. The first
  // child's count can vary within this interval without affecting the result.
  const first = addition[0];
  const connecting = subtract.names.find((name) => first.names.includes(name));
  if (!connecting) return null;
  const minimum = Math.max(0, subtract.quantity - addition[1].quantity);
  const maximum = Math.min(first.quantity, subtract.quantity);
  if (minimum > maximum) return null;
  return { addition, subtract, target, total, result, description: [...descriptions][0] || '' };
}

export function getThirdGuide(problem, version) {
  if (version < 4) return null;
  const pairs = parsePairs(problem);
  if (!pairs) return null;
  const { addition, subtract, target, total, result, description } = pairs;
  const unit = target.unit;
  const firstGroup = addition[0].names.join('和');
  const secondGroup = addition[1].names.join('和');
  const knownGroup = subtract.names.join('和');
  const wantedGroup = target.names.join('和');
  const sum = `${addition[0].quantity}＋${addition[1].quantity}`;
  const check = (expected) => (answer) => answerValue(answer, unit, description) === expected;
  const finalCheck = (answer) => {
    if (check(result)(answer)) return true;
    if (typeof answer !== 'string') return false;
    const written = answer.normalize('NFKC').replace(/\s+/gu, '');
    for (const names of [target.names, [...target.names].reverse()]) {
      const prefix = new RegExp(`^${names.join('(?:和|与)')}(?:两人)?(?:一共|总共|合计|共)(?:剪了|制作了|折了|做了|收集了|采了|有|用了|买了|种了|画了)?`, 'u');
      const rest = written.replace(prefix, '');
      if (rest !== written && check(result)(rest)) return true;
    }
    return false;
  };
  return {
    steps: [
      {
        stage: 1,
        note: `${firstGroup}、${secondGroup}正好是四个人，每人算一次。`,
        task: `算 ${sum}，填四个人的总数。`,
        format: 'number',
        hint: '这两组没有重复的人。把两组的数量加起来，就是四个人合起来的数量。',
        hints: [
          '画两个大框，把这两组的名字分别放进去。每个框下写它们一共做了多少，再相加。',
          `把 ${addition[0].quantity} 和 ${addition[1].quantity} 上下对齐，先加个位，再加十位。`,
        ],
        check: check(total),
        feedbackOnError: () => `这一步先算四个人的总数。检查 ${sum} 的加法得数。`,
      },
      {
        stage: 2,
        note: `四个人合起来有 ${total}${unit}。拿走${knownGroup}的，剩下${wantedGroup}的。`,
        task: `算 ${total}－${subtract.quantity}，填${wantedGroup}的数量。`,
        format: 'number',
        hint: `四个人的总数里有${knownGroup}的 ${subtract.quantity}${unit}，先把这一组减掉。`,
        hints: [
          `在纸上写 ${total}，减号后面填${knownGroup}的数量。算留下多少。`,
          total % 10 < subtract.quantity % 10
            ? `把 ${total}－${subtract.quantity} 列成竖式。个位不够减，从十位借 1 再减。`
            : `把 ${total}－${subtract.quantity} 列成竖式，个位减个位，十位减十位。`,
        ],
        check: finalCheck,
        feedbackOnError: () => `这一步要减去${knownGroup}的数量。检查减号右边是不是 ${subtract.quantity}。`,
      },
    ],
    finalCheck,
    recap: `先把不重复的两组相加，再减去已知的一组。${sum}－${subtract.quantity}＝${result}。`,
  };
}
