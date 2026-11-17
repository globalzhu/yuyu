const digits = '零一二三四五六七八九';
const smallUnits = { 十: 10, 百: 100, 千: 1000 };

function chineseNumber(text) {
  let total = 0;
  let group = 0;
  let digit = 0;
  for (const character of text.replace(/两/g, '二').replace(/〇/g, '零')) {
    if (digits.includes(character)) {
      digit = digit * 10 + digits.indexOf(character);
    } else if (character === '万' || character === '亿') {
      total += (group + digit) * (character === '万' ? 10_000 : 100_000_000);
      group = digit = 0;
    } else if (smallUnits[character]) {
      group += (digit || 1) * smallUnits[character];
      digit = 0;
    }
  }
  return total + group + digit;
}

function numbers(answer) {
  const text = answer.normalize('NFKC').replace(/\d{1,3}(?:,\d{3})+/g, (part) => part.replace(/,/g, ''));
  const tokens = text.match(/\d+(?:\.\d+)?\s*[万亿]?|[零〇一二两三四五六七八九十百千万亿]+/g) || [];
  return tokens.map((part) => {
    if (!/^\d/.test(part)) return chineseNumber(part);
    const scale = part.endsWith('万') ? 10_000 : part.endsWith('亿') ? 100_000_000 : 1;
    return parseFloat(part) * scale;
  });
}

const numberIs = (target) => (answer) => numbers(answer).at(-1) === target;

function equationIs(answer, left, operator, right, result) {
  const normalized = answer.normalize('NFKC').replace(/[\s,，]/g, '').replace(/乘以?|[*✕xX]/g, '×')
    .replace(/除以?|\//g, '÷').replace(/等于/g, '=');
  const equations = normalized.matchAll(/(\d+)([×÷])(\d+)(?:=(\d+))?/g);
  for (const match of equations) {
    const a = Number(match[1]);
    const b = Number(match[3]);
    const operands = (a === left && b === right) || (operator === '×' && a === right && b === left);
    if (match[2] === operator && operands && (result === undefined ? match[4] === undefined ||
      Number(match[4]) === (operator === '×' ? left * right : left / right) : Number(match[4]) === result)) return true;
  }
  return false;
}

function step(note, task, hints, check, format = 'number', feedbackOnError) {
  const [hint, ...more] = Array.isArray(hints) ? hints : [hints];
  return { note, task, hint, ...(more.length ? { hints: more } : {}), check, format, feedbackOnError };
}

function compareDigits(problem) {
  const fields = /甲数([A-Z])(\d{5})([A-Z])与乙数([A-Z])(\d{5})([A-Z])都是七位数/.exec(problem);
  const gaps = /已知([A-Z])比([A-Z])大([一二三四五六七八九\d])[,，]([A-Z])比([A-Z])大([一二三四五六七八九\d])/.exec(problem);
  if (!fields || !gaps || gaps[1] !== fields[4] || gaps[2] !== fields[1] ||
      gaps[4] !== fields[3] || gaps[5] !== fields[6]) return null;
  const headGap = numbers(gaps[3])[0] * 1_000_000;
  const tailGap = numbers(gaps[6])[0];
  if (!headGap || !tailGap || headGap > 8_000_000 || tailGap > 9) return null;
  const headDigit = headGap / 1_000_000;
  const center = (Number(fields[5]) - Number(fields[2])) * 10;
  const beforeOnes = headGap + center;
  const difference = headGap + center - tailGap;
  return {
    steps: [
      step('比两个七位数，从左边第一格开始。', '写下比较大的数是甲还是乙。',
        ['圈出甲和乙开头的字母。题目说哪一个大？',
          `把甲、乙两个数上下写齐。甲第一格是 ${fields[1]}，乙第一格是 ${fields[4]}。只对照题目，先比较这两个字母表示的数字。`],
        (answer) => /乙/.test(answer) && !/甲(?:更|较)?大/.test(answer), 'phrase'),
      step('百万｜十万｜万｜千｜百｜十｜个。百万位右边还有六格。', '只看百万位，在它那格写差，右边六格写 0。把这个数写出来。',
        [`把 ${headDigit} 写在百万位，不要放在十万位。手指从百万往右一格格移，每格都补一个 0。`,
          `画七个数位格，把 ${headDigit} 放到第一格。只数第一格右边还有几格，每一格填一个 0，然后把七格连起来读。`], numberIs(headGap)),
      step('先只看两个数中间的五个数字。', `算 ${fields[2]} 和 ${fields[5]} 相差多少。`,
        ['把这两个五位数上下对齐。用大的减小的，从最右一格开始算。',
          `在草稿写 ${Math.max(Number(fields[2]), Number(fields[5]))}－${Math.min(Number(fields[2]), Number(fields[5]))}＝□。把每列都对齐，从最后一位开始减。`],
        numberIs(Math.abs(center) / 10)),
      step('在完整的七位数里，中间五格最右边是十位。这里每差 1，就相差一个十。', '把刚才算出的差乘 10，写下中间五格真正相差多少。',
        ['手指在纸上找到十位，再找它右边的个位。把刚才的差写下来，给右边补一个 0。',
          `写 ${Math.abs(center) / 10} × 10＝□。把刚才的差整体向左挪一格，最右边的个位用 0 补上。`], numberIs(Math.abs(center))),
      step(`先拿出你算的百万位相差数。中间五格${center < 0 ? '甲更多，要减去你刚算的差' : center > 0 ? '乙更多，要加上你刚算的差' : '一样大，不用加减'}。`,
        `甲的个位还多 ${tailGap}。从乙领先的数里减去它，写出最后相差多少。`,
        [`先算 ${headGap} ${center < 0 ? '减' : '加'} ${Math.abs(center)}，再从得数减 ${tailGap}。`,
          `把头两部分合好后，单独写一行 ${beforeOnes}－${tailGap}＝□。从个位减起，个位不够就向左借 1 个十。`],
        numberIs(difference), 'number', (answer) => numberIs(beforeOnes)(answer)
          ? `你算出了前两部分的差。用你刚算的 ${beforeOnes} 减 ${tailGap}，再填最后的得数。` : undefined),
    ],
    recap: '先从左往右比出谁大，再把各个数位上的差记清楚。',
  };
}

const beadCost = (digit) => digit > 4 ? digit - 4 : digit;

function beadNumber(count, slots, largest) {
  const order = largest ? '9876543210' : '0123456789';
  let remaining = count;
  let result = '';
  for (let position = 0; position < slots; position++) {
    for (const digit of order) {
      if (position === 0 && digit === '0') continue;
      const cost = beadCost(Number(digit));
      if (cost > remaining || remaining - cost > 5 * (slots - position - 1)) continue;
      result += digit;
      remaining -= cost;
      break;
    }
  }
  return Number(result);
}

function abacusLevels(problem) {
  const countText = /算盘上用(\d+|[一二两三四五六七八九十])颗(?:算)?珠(?:子)?.{0,8}(?:含有|含|包含)(?:两个|2个)数级/.exec(problem)?.[1];
  if (!countText || !/最大.*最小/.test(problem)) return null;
  const count = numbers(countText)[0];
  if (count < 1 || count > 14) return null;
  const biggest = beadNumber(count, 8, true);
  const smallest = beadNumber(count, 5, false);
  const firstUsed = beadCost(Number(String(biggest)[0]));
  const remaining = count - firstUsed;
  const smallestLast = Number(String(smallest).at(-1));
  const minLastUsesUpper = count > 5;
  return {
    steps: [
      step('右边个级有四格。只在万级最靠右的一格拨珠，就用到了两个数级。', '数一数这个最短的数用了几格，写下位数。',
        ['在个位到千位后面，再画一格万位。数一数这时共有几格。',
          '在纸上写 □｜□□□□。右边四格是个级，左边那一格是万位。从左往右点着数框。'], numberIs(5)),
      step('还可以继续往左用万级的格子。', '写下只用个级和万级，最多能写几位。',
        ['万级也有四格。把两个数级的格子加起来。',
          '画 □□□□｜□□□□，左边是万级，右边是个级。用手指点着数两组的格子。'], numberIs(8)),
      step(`要求最大数，先画八格。你手里一共只有 ${count} 颗珠子。先让最左一档表示的数字尽量大。`,
        count >= 5 ? '把最左一档的一颗上珠和四颗下珠合起来，写下一共用了几颗。'
          : '最左一档用一颗上珠。再试把剩下的珠靠在下边。数一数用掉几颗。',
        count >= 5 ? ['一颗上珠数作一颗。再数下面那四颗，把上下两边的颗数加起来。',
          '画一个上珠和四个下珠，每点过一颗画一个勾。填一共画了几个勾。']
          : ['用手指一颗一颗点过去，上面的珠和下面的珠都数。',
            `从纸上的 ${count} 个珠圈里拨出一颗当上珠。把余下的都移到横梁下面，再把两边总数点一遍。`],
        numberIs(firstUsed), 'number', (answer) => count >= 5 && numberIs(1)(answer)
          ? '你数了上面那一颗。下面还有四颗，也要一起数进去。' : undefined),
      step(`第一档用掉 ${firstUsed} 颗。一共 ${count} 颗，现在手里只剩 ${remaining} 颗${remaining < 5 ? '，不能再拨满一档' : ''}。`,
        '把剩下的珠从下一档往右放。写出能拨出的最大八位数。',
        remaining === 1
          ? ['下一档只能放一颗。想想同样一颗珠，上珠还是下珠表示得大。后面的空档都记成 0。',
            `在 ${String(biggest)[0]}□00｜0000 里只补第二格。上珠表示 5，下珠表示 1，试着选更大的数字。`]
          : ['先在下一档用现有的珠尽量拨大。只把这里没用掉的珠往右放，别忘了逐档数总珠数。',
            '画八个数位格，从左向右。每拨完一档，先从手里减掉刚用的珠，才拿还没用的珠去拨下一档。'], numberIs(biggest),
        'number', (answer) => remaining === 1 && /^96\d{6}$/.test(String(numbers(answer).at(-1)))
          ? '第二档的 6 要一颗上珠再加一颗下珠。一共两颗，可是手里只剩一颗了。只选一种珠，再重读这个数。'
          : undefined),
      step(`求最小数时，只画五格。给最左的万位用一颗下珠，手里还剩 ${count - 1} 颗。`,
        minLastUsesUpper ? '先在个位拨一颗上珠和四颗下珠。算个位显示几。' : '先把剩下的珠子当下珠放在个位。算个位显示几。',
        minLastUsesUpper ? ['上珠表示 5。四颗下珠每颗表示 1。把它们表示的数加起来。',
          '只看个位，先记上珠的 5，再点四颗下珠，每点一次从 5 往后数一步。']
          : ['一颗下珠表示 1。数有几颗下珠，用掉的万位珠另算。',
            '先把万位用的那颗珠子放在一边。剩下的做个位下珠，点着数这些下珠。'],
        numberIs(smallestLast)),
      step('个位的数字已经算好了。看看个位放完后手里还有没有珠。', '从右到左逐格写，最后读出整个最小的五位数。',
        ['最左格记下万位。个位写你刚算出的数字。多出来的珠再往十位放，空格写 0。',
          '从 1｜□□□□ 开始，最右格写已经算对的个位数。再按剩下的珠子往左补，没珠的档写 0。'], numberIs(smallest)),
    ],
    recap: '先看数能有几位，再按数位从左往右比较。',
  };
}

function mangoType(answer) {
  if (!/多少|几(?:箱|块|元)|\?|？/.test(answer)) return '';
  const boxes = /多少箱|几箱|箱数/.test(answer);
  const money = /多少钱|多少元|多少块|几元|几块钱/.test(answer);
  if (boxes === money) return '';
  return boxes ? 'boxes' : 'money';
}

function mangoQuestion(answer) {
  const type = mangoType(answer);
  if (!type || !/卖|这批|总共|一共|全部|48|这种/.test(answer)) return false;
  if (/(?:每|一)(?:小|大)?箱(?:的)?芒果.{0,4}(?:多少|几)|(?:每|一)盒.{0,4}(?:多少|几)/.test(answer)) return false;
  const numbered = answer.match(/[①②③④]/g) || [];
  const selected = answer.match(/(?:选择?|我选了|信息是)[:：\s]*([1-4](?:[、,，\s]*[1-4]){1,3})/)?.[1];
  const options = new Set(numbered.length
    ? numbered.map((choice) => '①②③④'.indexOf(choice) + 1)
    : selected?.match(/[1-4]/g).map(Number) || []);
  return !options.size || (options.size === 3 && options.has(1) && options.has(4) && options.has(type === 'boxes' ? 2 : 3));
}

function twoStepQuestion(problem) {
  if (!/需要用两步计算解决的问题并解答/.test(problem) || !/芒果/.test(problem)) return null;
  const perBox = Number(/每盒(?:里)?(?:有|装)(\d+)个(?:芒果)?/.exec(problem)?.[1]);
  const perCase = Number(/每箱(?:里)?(?:有|装)(\d+)盒/.exec(problem)?.[1]);
  const unitPrice = Number(/每盒(?:芒果)?(?:售价|要|卖)?(\d+)元/.exec(problem)?.[1]);
  const total = Number(/(?:共|一共)卖了(\d+)个(?:芒果)?/.exec(problem)?.[1]);
  const boxes = total / perBox;
  const pricePerMango = unitPrice / perBox;
  if (![perBox, perCase, unitPrice, total, boxes, boxes / perCase].every(Number.isSafeInteger) ||
      perBox < 2 || perCase < 2 || unitPrice < 2 || total <= perBox) return null;
  return {
    steps: [
      step('先挑一种想求的东西。题目给了盒和箱，也给了每盒的价格。', '写出你想问的一个问题，也可以一起写上信息编号。',
        ['你可以用「这批芒果一共……」来开头。挑一个要先把芒果个数换成盒数的问题。',
          '把你想求的东西填进这句「这批芒果一共卖了多少____？」试试选箱数或价钱，再写成一个完整问题。'], mangoQuestion, 'sentence'),
      step((accepted) => mangoType(accepted[0]) === 'boxes'
        ? '要知道装了几箱，先算一共卖了几盒。'
        : '一种办法是先算卖了几盒。你也可以先算每个芒果多少钱。',
      '把你先算的一步写成带得数的算式。',
      ['如果求盒数，画一个盒子写上每盒的个数，再想总数里有几个这样的盒子。',
        `先试从盒数开始。在纸上写 ${total} ÷ ${perBox}＝□ 盒，再把得数填进去。`],
      (answer, accepted) => equationIs(answer, total, '÷', perBox, boxes) ||
        (mangoType(accepted[0]) === 'money' && Number.isInteger(pricePerMango) &&
          equationIs(answer, unitPrice, '÷', perBox, pricePerMango)), 'equation'),
      step((accepted) => {
        if (mangoType(accepted[0]) === 'boxes') return '现在知道了卖出的盒数。看看每箱能放几盒。';
        if (equationIs(accepted[1], total, '÷', perBox, boxes)) return '现在知道了卖出的盒数。看看一盒卖多少钱。';
        return '现在知道了一个芒果的价钱。看看一共卖出了几个。';
      }, '把第二个算式和得数写出来，回答你刚提出的问题。',
      [
        '试着在得数后面加上单位。想想你数的是一大箱，还是一共卖了多少钱。',
        (accepted) => {
          if (mangoType(accepted[0]) === 'boxes') return `把一共 ${boxes} 盒按每 ${perCase} 盒装一箱。写 ${boxes} ÷ ${perCase}＝□ 箱。`;
          if (equationIs(accepted[1], total, '÷', perBox, boxes)) return `一共 ${boxes} 盒，每盒 ${unitPrice} 元。写 ${boxes} × ${unitPrice}＝□ 元。`;
          return `每个芒果 ${pricePerMango} 元，一共卖了 ${total} 个。写 ${pricePerMango} × ${total}＝□ 元。`;
        },
      ],
      (answer, accepted) => {
        if (mangoType(accepted[0]) === 'boxes') return equationIs(answer, boxes, '÷', perCase, boxes / perCase);
        if (equationIs(accepted[1], total, '÷', perBox, boxes)) return equationIs(answer, boxes, '×', unitPrice, boxes * unitPrice);
        return equationIs(answer, pricePerMango, '×', total, boxes * unitPrice);
      }, 'equation'),
    ],
    recap: '自己提问时，找出第一步要知道的数，再用它算出问题所求。',
  };
}

const placeUnits = { 万: 10_000, 十万: 100_000, 百万: 1_000_000, 千万: 10_000_000, 亿: 100_000_000 };

function placeBlanks(problem) {
  const unitsA = /\(\)个(万|十万|百万|千万)是(?:一)?(十万|百万|千万|亿)/.exec(problem);
  const unitsB = /(?:一)?(百万|千万|亿)里面?有\(\)个(万|十万|百万|千万)/.exec(problem);
  const upper = /比最大(?:的)?([一二三四五六七八九]|[1-9])位数多([一二三四五六七八九]|[1-9])的数是/.exec(problem);
  const lower = /比最小(?:的)?([一二三四五六七八九]|[1-9])位数小([一二三四五六七八九]|[1-9])的数是/.exec(problem);
  if (!unitsA || !unitsB || !upper || !lower) return null;
  const first = placeUnits[unitsA[2]] / placeUnits[unitsA[1]];
  const second = placeUnits[unitsB[1]] / placeUnits[unitsB[2]];
  const maxVal = 10 ** numbers(upper[1])[0] - 1;
  const minVal = 10 ** (numbers(lower[1])[0] - 1);
  const more = numbers(upper[2])[0];
  const less = numbers(lower[2])[0];
  if (!Number.isInteger(first) || !Number.isInteger(second) || minVal < less) return null;
  return {
    steps: [
      step(`写出数位表，从${unitsA[1]}往左找到${unitsA[2]}。`, '算第一个空，写下要几个较小的单位。',
        ['往左移动一格，相当于把原先的小单位凑成一组。用大的计数单位除以小的计数单位。',
          `先把两个单位换成数字，写出 ${placeUnits[unitsA[2]]} ÷ ${placeUnits[unitsA[1]]}＝□。`], numberIs(first)),
      step(`用数字分别写出${unitsB[1]}和${unitsB[2]}。`, '算第二个空，写下大的单位里面有几个小的单位。',
        ['这两个数都是 1 后面跟着 0。用大的数除以小的数，看看还剩几个 0。',
          `写出 ${placeUnits[unitsB[1]]} ÷ ${placeUnits[unitsB[2]]}＝□。从除数的右边每划掉一个 0，被除数右边也同时划掉一个 0。`], numberIs(second)),
      step(`找一个最大的${upper[1]}位数，每一格都填最大的数字。`, `给它加 ${more}，写下第三个空的数。`,
        ['从个位开始加。满十要往左进一，留心这可能需要一格新数位。',
          `在草稿上写 ${maxVal}＋${more}＝□。先把 ${more} 对齐个位，再从右往左算。`], numberIs(maxVal + more)),
      step(`找一个最小的${lower[1]}位数。最左一格不能写零。`, `从这个数减去 ${less}，写下第四个空。`,
        ['个位不够减时，从左边借一个十。中间有零时，要继续往左借。',
          `在草稿上写 ${minVal}－${less}＝□。想一想，方框里的数再加上 ${less} 应该能回到 ${minVal}。`], numberIs(minVal - less)),
    ],
    recap: '用数位表数格，再检查加法进位和减法退位。',
  };
}

function multiplicationAndDivision(problem) {
  const normalized = problem.replace(/\*/g, '×').replace(/\//g, '÷');
  const equation = /^((?:\d{1,7}[×÷]){2,7}\d{1,7})(?:=\(?\)?|\(?\)?)?[。?？]?$/.exec(normalized)?.[1];
  if (!equation) return null;
  const [first, ...operations] = equation.match(/\d+|[×÷]/g);
  let current = Number(first);
  const steps = [];
  for (let index = 0; index < operations.length; index += 2) {
    const operator = operations[index];
    const amount = Number(operations[index + 1]);
    if (operator === '÷' && amount === 0) return null;
    const result = operator === '×' ? current * amount : current / amount;
    if (!Number.isSafeInteger(result) || result > 1_000_000_000) return null;
    const last = index === operations.length - 2;
    const largerFactor = Math.max(current, amount);
    const smallerFactor = Math.min(current, amount);
    const leading = largerFactor - largerFactor % 10;
    steps.push(step(index === 0
      ? '只有乘法和除法，又没有括号。像读句子一样从左往右算。'
      : '把你刚才的得数放回式子的左边。右边还有运算。',
    `算 ${current} ${operator} ${amount}${last ? '，写出整道题的得数' : '，写下这一步的得数'}。`,
    operator === '×'
      ? ['一位数乘一位数可以用口诀。乘两位数时，可以拆成整十和个位来算。',
        leading
          ? `把较大的 ${largerFactor} 拆成 ${leading} 和 ${largerFactor % 10}。两部分各乘 ${smallerFactor}，再相加。`
          : `想成 ${amount} 个 ${current} 相加，或者用这两个数的乘法口诀。`]
      : ['想一想，被除数里有几份和除数一样多。也可以用乘法倒过来检查。',
        `把除法变成找方框里的数。写 ${amount} × □＝${current}，用你试出来的数乘回去验算。`],
    numberIs(result)));
    current = result;
  }
  return { steps, recap: '乘除混在一起且没有括号时，从左往右一步一步算。' };
}

function countCubes(problem) {
  const unit = /(?:一个|每个|每一小块)(?:小正方体|小方块|小块)?表示(\d+|一)万/.exec(problem)?.[1];
  const blocks = /(\d+|[一二两三四五六七八九十])(?:个|块)(?:带[^，。、]{1,8}的)?大(?:正方体|方块)/.exec(problem)?.[1];
  const handSide = /长[、,，]宽[、,，]高各(?:有)?(\d+|十)个/.exec(problem)?.[1];
  const loose = /(?:另有|再加上?|还有|旁边(?:一排)?有?|一排)(\d+|[零一二两三四五六七八九十]+)个(?:散放的)?小(?:正方体|方块)/.exec(problem)?.[1];
  if ([unit, blocks, handSide, loose].some((part) => part === undefined)) return null;
  const amount = (part) => numbers(part)[0];
  const edge = amount(handSide);
  const blockCount = amount(blocks);
  const total = edge ** 3 * blockCount + amount(loose);
  const perUnit = amount(unit);
  if (edge < 2 || edge > 20 || blockCount < 1 || blockCount > 10 || perUnit < 1 || perUnit > 100) return null;
  return {
    steps: [
      step(`一层有 ${edge} 排，每排 ${edge} 个小方块。`, '算一个大方块的一层有几个小方块。',
        ['把相同的小方块按排数。用每排的个数乘排数。',
          `在草稿画一排，在边上写 ${edge} 个。这样的排共有 ${edge} 排，填 ${edge} × ${edge}＝□。`], numberIs(edge * edge)),
      step(`刚算的是一层。一个大方块往上共有 ${edge} 层。`, '算一整个大方块里有几个小方块。',
        ['把每一层想成一盘积木。每盘一样多，再数有几盘。',
          `刚才算出每层 ${edge ** 2} 个，共 ${edge} 层。填 ${edge ** 2} × ${edge}＝□。`], numberIs(edge ** 3)),
      step('先数几个大方块里有多少，再算旁边散着的那些。', '算全图有几个小方块。',
        ['用一大块里的数量乘大块的个数。把没装进去的散块也加上。',
          `先算 ${edge ** 3} × ${blockCount}，得到整大块里的总个数。再把旁边散着的 ${amount(loose)} 个加上。`], numberIs(total)),
      step(`现在你数完了小方块。每个小方块表示 ${perUnit} 万。`, '写出全图表示的数，记得带上「万」。',
        ['先问自己小方块的个数。再想每个方块对应几个万。',
          `先求全图有多少个万。填 ${total} × ${perUnit}＝□，方框里的数后面写「万」。`], numberIs(total * perUnit * 10_000)),
    ],
    recap: '方块多时，先数一层，再数一大块，最后加散块。',
  };
}

function exactProductRows(problem) {
  const matched = /^用数字(\d(?:[、,，]\d){4})组成三位数(?:乘|×)两位数[。,.，:：]写(?:出)?积最大的(?:乘法)?算式并计算(?:\(\)|_{2,})?[。,.，]写(?:出)?积最小的(?:乘法)?算式并计算(?:\(\)|_{2,})?[。,.，]写(?:出)?积最接近18000的(?:乘法)?算式(?:并计算)?(?:\(\)|_{2,})?[。,.，]?(?:(?:每个数字(?:各|只|只能)?用一次|数字不重复)[。.!！]?)?$/.exec(problem);
  return matched && matched[1].match(/\d/g).sort().join('') === '24589';
}

function productChoices(problem, version) {
  if (version >= 3) return exactProductRows(problem) ? productRows() : null;
  const source = /用数字(\d(?:[、,，]\d){4})组成三位数乘两位数/.exec(problem)?.[1];
  if (!source || source.match(/\d/g).sort().join('') !== '24589' ||
      !/积最大.*积最小.*积最接近18000/.test(problem)) return null;
  return {
    steps: [
      step('两位数的十位用 2、4 或 5，乘不到 1000 的数，积一定小于 6 万。', '圈出求最大积时，两位数的十位还要试哪两个数字。',
        '在原来的五个数字里划掉这三种，留下两种大位的摆法。', (answer) => {
          const remaining = numbers(answer);
          return remaining.length === 2 && remaining.includes(8) && remaining.includes(9);
        }, 'phrase'),
      step('两位数左边固定写 8，三位数左边固定写 9。每道乘法里五个数字都只用一次。',
        '补完 9□□×82、9□□×84、9□□×85，写下积最大的一式和得数。',
        '给三行各摆一套数字。9□□×82 先取走 8 和 2，9□□×84 先取走 8 和 4，9□□×85 先取走 8 和 5。每行剩下的数字从大到小排。',
        (answer) => equationIs(answer, 942, '×', 85, 80070), 'equation', (answer) => {
          const factors = /(\d{3})\s*[×*xX]\s*(8[245])/.exec(answer.normalize('NFKC'));
          if (!factors) return undefined;
          const repeated = [...factors[1]].find((digit) => factors[2].includes(digit));
          if (!repeated) return factors[2] === '85' ? undefined
            : '你已试了一行。再试右边写 85 的那一行，先划掉 8 和 5，把剩下的三个数从大到小排。算完再比较。';
          return `这行把 ${repeated} 用了两次。先在五个数字里划掉 ${[...factors[2]].join(' 和 ')}，只拿没划掉的三个填左边。`;
        }),
      step('交换两个最左边的数字。两位数左边固定写 9，三位数左边固定写 8。',
        '补完 8□□×92、8□□×94、8□□×95，写下积最大的一式和得数。',
        '先试 854×92。每次移走已经用过的两个数字，剩下三个从大到小排，再比三个积。',
        (answer) => equationIs(answer, 852, '×', 94, 80088), 'equation'),
      step('把刚才两组的最大积放在一起。', '比较大小，写下第一问的乘法和得数。',
        '两数左边的数字如果一样，就往右看，直到找到不一样的那一位。',
        (answer) => equationIs(answer, 852, '×', 94, 80088), 'equation'),
      step('求最小积时，固定两位数后，把余下的三位从小到大排。先把 2 放在两位数的十位。',
        '给 24、25、28、29 各配一个最小三位数，写积最小的一式和得数。',
        '先把两位数里的两个数字划掉。每次把没被划掉的三个数从小到大排。',
        (answer) => equationIs(answer, 489, '×', 25, 12225), 'equation'),
      step('两位数的十位用 5、8 或 9，至少要拿 248 乘 52，超过上一组最小的积。',
        '给 42、45、48、49 各配一个最小三位数，写积最小的一式和得数。',
        '把两位数用过的数字划掉，每次把余下三个数字从小到大排。',
        (answer) => equationIs(answer, 259, '×', 48, 12432), 'equation'),
      step('两组的小积都找到了。', '比较这两个得数，写下第二问的乘法和得数。',
        '从左边的数位开始比较。抄下积较小的那道乘法。',
        (answer) => equationIs(answer, 489, '×', 25, 12225), 'equation'),
      step('找离 18000 最近的积。先看二十多这一组，三位数的百位用 5 最有机会。',
        '补完 5□□×28 和 5□□×29，写下离 18000 最近的一式和得数。',
        '两位数最多 29。三位数不到 500 时积太小，三位数至少 800 时积太大。二十四、二十五乘不到 600 也太小。先试剩下数字能摆成的较大三位数。',
        (answer) => equationIs(answer, 584, '×', 29, 16936), 'equation'),
      step('四十多这一组的三位数不到 300 或至少 500，积都离 18000 太远。八十多和九十多两组的积至少有 245×82。',
        '剩下五十多这一组。圈一个三位数的百位，让积尽量靠近 18000。',
        '如果三位数达到 400，乘 50 就到了 2 万。看看还剩哪个更小的百位数字。', numberIs(2)),
      step('百位定好后，五十四乘不到 300，得数还不到 16200。试另外两个个位。',
        '补完 2□□×58 和 2□□×59，写下离 18000 最近的一式和得数。',
        '每个两位数配两个可能的三位数。先试较大的那个，再比较它们各差多少。',
        (answer) => equationIs(answer, 294, '×', 58, 17052), 'equation'),
      step('把二十多和五十多两组各自最靠近的得数放在一起。', '算它们各离 18000 多远，再写下第三问的式子。',
        '一起从 18000 往小了数。走得更少的那个积离得更近。',
        (answer) => equationIs(answer, 294, '×', 58), 'equation'),
    ],
    recap: '固定一边，换几个有希望的摆法。算出小组结果后再比较。',
  };
}

function withChoices(task, choices) {
  return { ...task, choices };
}

function productRows() {
  const steps = [];
  steps.push(withChoices(
    step('积就是乘法的得数。两位数的十位若放 2、4 或 5，积不到 6 万。', '选出求最大积时，还要试哪两个十位数字。',
      ['从 2、4、5、8、9 中划掉 2、4、5，看看剩下哪两个。',
        '把题目里的五个数字各写在一张纸片上。只考虑两位数的十位，暂时移走 2、4、5，读桌上剩下的纸片。'], (answer) => {
        const remaining = numbers(answer);
        return remaining.length === 2 && remaining.includes(8) && remaining.includes(9);
      }, 'phrase'),
    ['2 和 4', '4 和 5', '8 和 9'],
  ));

  function addRow(right, left, { opening = '', order = '大到小', startsAt } = {}) {
    const index = steps.length;
    const leftValue = (accepted) => numbers(accepted[index]).at(-1);
    const value = (accepted) => numbers(accepted[index + 1]).at(-1);
    const product = left * right;
    const rightDigits = [...String(right)].join(' 和 ');
    const available = [...'28945'].filter((digit) => !String(right).includes(digit)).join('、');
    const tens = Math.floor(right / 10) * 10;
    const ones = right - tens;
    const top = left * tens;
    const bottom = left * ones;
    const additionHelp = () => {
      const places = ['个位', '十位', '百位', '千位', '万位'];
      const digitAt = (number, index) => Math.floor(number / 10 ** index) % 10;
      const carry = places.findIndex((_, index) => digitAt(top, index) + digitAt(bottom, index) >= 10);
      if (carry < 0) return `把竖式的两行 ${top} 和 ${bottom} 按数位对齐，从个位开始加。`;
      const a = digitAt(top, carry);
      const b = digitAt(bottom, carry);
      const next = carry + 1;
      const c = digitAt(top, next);
      const d = digitAt(bottom, next);
      const again = next < places.length && c + d + 1 >= 10
        ? `${places[next]}还要算 ${c}＋${d}＋1，满十就再进 1。` : '';
      return `把竖式的两行 ${top} 和 ${bottom} 按数位对齐。${places[carry]}的 ${a} 加 ${b} 满十，这一位写 ${(a + b) % 10}，往左进 1。${again}`;
    };
    steps.push(step(
      [opening, `这一行右边放 ${right}。左边能用的数字是 ${available}。`].filter(Boolean).join(''),
      startsAt
        ? `左边第一格放 ${startsAt}。把余下两格从${order}排，写出整个三位数。`
        : `把没划掉的三个数字从${order}排，写出这一行左边的三位数。`,
      [
        startsAt
          ? `写好右边的 ${right}，再圈住左边开头的 ${startsAt}。剩下两个数字各放一次。`
          : `先拿走 ${rightDigits}。这次只摆 ${available} 这三张卡，每张卡用一次。`,
        startsAt
          ? `画 ${startsAt}□□ × ${right}。从左边能用的三个数字中拿走 ${startsAt}，再把余下两个从${order}填进这两个空格。`
          : `画 □□□ × ${right}。在 ${available} 里先挑${order === '大到小' ? '最大' : '最小'}的卡放第一格，按${order}把余下两格填好。`,
      ],
      numberIs(left), 'number',
      (answer) => {
        const written = numbers(answer).at(-1);
        if (!Number.isInteger(written) || written < 100 || written > 999) return undefined;
        const repeated = [...String(written)].find((digit) => String(right).includes(digit));
        return repeated
          ? `你又用了 ${repeated}。它已经在右边的 ${right} 里。左边只用 ${available}，按这一行的要求重新排。`
          : undefined;
      },
    ));
    steps.push(step(
      (accepted) => `刚摆好的左边是 ${leftValue(accepted)}。右边是 ${right}。`,
      (accepted) => `算 ${leftValue(accepted)} × ${right}，只填得数。`,
      [
        (accepted) => `先算 ${leftValue(accepted)} × ${tens}，再算 ${leftValue(accepted)} × ${ones}，把两个得数加起来。`,
        (accepted) => `先把 ${leftValue(accepted)} 乘 ${ones} 记作一行。再把它乘 ${tens / 10}，得数向左挪一格，个位补 0。把这两行上下对齐。`,
        additionHelp,
      ],
      numberIs(product), 'number', additionHelp,
    ));
    return {
      left, right, product, value,
      label: (accepted) => `${leftValue(accepted)} × ${right}＝${value(accepted)}`,
    };
  }

  function compareRows(rows, winner, note, task, hint, fullEquation = false) {
    const labels = (accepted) => rows.map((row) => row.label(accepted));
    const values = (accepted) => rows.map((row) => String(row.value(accepted)));
    steps.push(withChoices(step(
      (accepted) => `${typeof note === 'function' ? note(accepted) : note}${(fullEquation ? labels : values)(accepted).join('、')}。`,
      task, hint,
      fullEquation
        ? (answer) => equationIs(answer, winner.left, '×', winner.right, winner.product)
        : numberIs(winner.product),
      fullEquation ? 'equation' : 'number',
    ), fullEquation ? labels : values));
  }

  const row82 = addRow(82, 954, { opening: '先试两位数的十位放 8。' });
  const row84 = addRow(84, 952);
  const row85 = addRow(85, 942);
  compareRows([row82, row84, row85], row85, '这一组的三个得数是 ',
    '从这三个得数里选出最大的一个。',
    ['从左边第一位开始比，第一位一样就往右比。',
      '把三个得数上下对齐。先看最左一格，划掉这格更小的数，有相同的再比下一格。']);

  const row94 = addRow(94, 852, { opening: '再试十位放 9 的一组，试算中间这一行。' });
  steps.push(step(
    (accepted) => `92 这一行的积是 78568，94 这一行你算出 ${row94.value(accepted)}，95 这一行的积是 79990。`,
    '从这三个得数里找出最大的一个，写下来。',
    ['圈出最左边的数位，从左到右一个数位一个数位地比。',
      '把三个数的万位上下摆齐。哪行万位更大，哪行就先留下。万位相同再比千位。'],
    numberIs(row94.product),
  ));
  compareRows([row85, row94], row94, '把两组各自最大的那一行放在一起。', '选出较大的那道乘法，写第一问的算式和得数。',
    ['比较等号后面的两个数，把较大的那行算式一起写上。',
      '把两行的得数上下对齐，在最先不同的数位画圈。圈里的数字更大的那一整行，就是要选的算式。'], true);

  const row25 = addRow(25, 489, {
    opening: '开始找最小的积。这一次，左边的三位数要尽量小。',
    order: '小到大',
  });
  const row48 = addRow(48, 259, {
    opening: '再试两位数十位放 4 的一行。',
    order: '小到大',
  });
  compareRows([row25, row48], row25,
    '按同法试出的其他行最小也有 12642。现在比这两行。',
    '选出较小的那道乘法，写第二问的算式和得数。',
    ['比较等号后面的两个数，把较小的那行算式一起写上。',
      '只比较等号右边。数位一样多，就从最左一格走到第一处不同，选那一格较小的整行。'], true);

  const row29 = addRow(29, 584, {
    opening: '开始找离 18000 最近的积。二十多这一组里，百位放 5 才有机会靠近。28 这一行的积最多是 16632。',
    startsAt: 5,
  });
  const row58 = addRow(58, 294, {
    opening: '再试五十多的一组。三位数到 400，积就超过 2 万。54 和 59 两行的积还不到 17000。',
    startsAt: 2,
  });
  const distanceIndex = steps.length;
  for (const row of [row29, row58]) {
    const distance = Math.abs(18000 - row.product);
    steps.push(step(
      (accepted) => `这行的积是 ${row.value(accepted)}，把它放在数轴上想一想。`,
      (accepted) => `算 ${row.value(accepted)} 距离 18000 还差多少，只填这个差。`,
      [
        (accepted) => `用 18000 减去你已经算出的 ${row.value(accepted)}，用竖式对齐数位。`,
        (accepted) => `在草稿上写 18000－${row.value(accepted)}＝□。从个位开始减，不够就沿着相邻数位往左借一个十。`,
      ],
      numberIs(distance),
    ));
  }
  compareRows([row29, row58], row58,
    (accepted) => `你算出这两行分别差 ${numbers(accepted[distanceIndex]).at(-1)} 和 ${numbers(accepted[distanceIndex + 1]).at(-1)}。其他行的差都更大。`,
    '选出距离较短的那一行，写第三问的算式和得数。',
    ['看刚刚算出的两个差，差越小就越接近 18000。',
      '先圈住两个差中较小的一个。再回到题里找到算出这个差的那道乘法，选那一整行。'], true);

  return {
    steps,
    recap: '你先一行一行试，再比大小和距离。最大是 852 × 94＝80088。最小是 489 × 25＝12225。最接近 18000 的是 294 × 58＝17052。',
  };
}

function closestChoice(problem) {
  const targetText = /最接近(\d+|[一二两三四五六七八九十]+)(万|亿)?的数/.exec(problem);
  const options = [...problem.matchAll(/([A-D])[.、:：)]?(\d{2,11})(?!\d)/gi)];
  if (!targetText || options.length !== 4 || new Set(options.map((option) => option[1].toUpperCase())).size !== 4) return null;
  const target = numbers(targetText[1] + (targetText[2] || ''))[0];
  const choices = options.map((item) => ({ label: item[1].toUpperCase(), value: Number(item[2]) }));
  const sorted = [...choices].sort((a, b) => Math.abs(target - a.value) - Math.abs(target - b.value));
  if (Math.abs(target - sorted[0].value) === Math.abs(target - sorted[1].value)) return null;
  const correct = sorted[0];
  const steps = choices.map(({ label, value }, index) => step(index
    ? '在草稿纸上留着刚算出的差，再算下一个。'
    : '想象目标在数轴上。是左边还是右边都可以，比的是走多少格。',
  `算选项 ${label} 到目标相差多少，写下这个差。`,
  ['用较大的数减去较小的数。如果已经一样，距离就是零。',
    `在草稿对齐数位，填 ${Math.max(target, value)}－${Math.min(target, value)}＝□。只写这个差。`],
  numberIs(Math.abs(target - value))));
  if (targetText[2] || !/^\d+$/.test(targetText[1])) {
    steps.unshift(step('先把要比较的目标写到数轴中间。', `把 ${targetText[1]}${targetText[2] || ''} 写成一个整数。`,
      ['找到目标使用的单位，把单位换成数字，再乘单位前面的数。',
        targetText[2]
          ? `写出 ${numbers(targetText[1])[0]} × ${targetText[2] === '亿' ? '100000000' : '10000'}＝□。乘整十、整百时可以在右边补 0。`
          : '先按读法找到最高数位，从左往右把每个数字写到应该在的位置，空着的位置补 0。'], numberIs(target)));
  }
  steps.push(step('现在四个距离都有了。', '选出距离最小的一个，写下字母。',
    ['先在草稿上给最短的距离画圈，再找它前面写的选项字母。',
      '把刚算的四个差写在一起，左边分别标上对应字母。从左往右比差的数位，留下差最小的那一行。'],
    (answer) => {
      const normalized = answer.normalize('NFKC');
      const letters = new Set([...normalized.matchAll(/(?:^|[^A-Z])([A-D])(?=[^A-Z]|$)/gi)]
        .map((match) => match[1].toUpperCase()));
      if (letters.size) return letters.size === 1 && letters.has(correct.label);
      const values = numbers(normalized);
      return !/[A-Z]/i.test(normalized) && values.length === 1 && values[0] === correct.value;
    }, 'phrase'));
  return { steps, recap: '离目标越近，相差的数就越小。' };
}

export function getSecondGuide(problem, version) {
  const normalized = problem.normalize('NFKC').replace(/\s+/g, '').replace(/^\d+[.、]/, '')
    .replace(/\d{1,3}(?:,\d{3})+(?!\d)/g, (part) => part.replace(/,/g, ''));
  for (const match of [compareDigits, abacusLevels, twoStepQuestion, placeBlanks,
    multiplicationAndDivision, countCubes, productChoices, closestChoice]) {
    const guide = match(normalized, version);
    if (!guide) continue;
    // Resume sessions that were already open when the two intermediate tasks were added.
    if (version === 1 && match === compareDigits) {
      const scaledDifference = guide.steps[3];
      guide.steps.splice(2, 2, {
        ...scaledDifference,
        note: '中间五个数字占十万位到十位，最右边要补一个个位。',
        task: '给两个中间数各补一个个位 0。用较大的减较小的，写下差。',
        hint: '补上个位的 0 后才对齐了数位。竖着摆好这两个数，从个位开始减。',
      });
    }
    if (version === 1 && match === abacusLevels) {
      const finalMinimum = guide.steps[5];
      guide.steps.splice(4, 2, {
        ...finalMinimum,
        note: guide.steps[4].note,
        hint: '先放个位。每档只能用一颗上珠和四颗下珠，放不下的再拿到十位。空档都写 0。',
      });
    }
    return guide;
  }
  return null;
}
