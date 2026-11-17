const digit = new Map([...('零一二三四五六七八九')].map((word, value) => [word, value]));
digit.set('两', 2);
digit.set('〇', 0);
const place = new Map([['十', 10], ['百', 100], ['千', 1000]]);
const size = /^(?:\d+(?:\.\d+)?|[零〇一两二三四五六七八九十百千]+)$/u;

function smallNumber(value) {
  value = value.replace(/^[零〇]+(?=\d)/u, '');
  if (!size.test(value)) return NaN;
  if (/^\d/u.test(value)) return Number(value);
  if (![...value].some((word) => place.has(word))) return Number([...value].map((word) => digit.get(word)).join(''));
  let subtotal = 0;
  let last = null;
  let previousPlace = Infinity;
  for (const word of value) {
    if (digit.has(word)) {
      last = digit.get(word);
      continue;
    }
    const unit = place.get(word);
    if (unit >= previousPlace) return NaN;
    subtotal += (last ?? 1) * unit;
    previousPlace = unit;
    last = null;
  }
  return subtotal + (last || 0);
}

function chineseNumber(value) {
  if (!value || !/^[\d.零〇一两二三四五六七八九十百千万亿]+$/u.test(value)) return NaN;
  const [billions, belowBillions, ...otherBillions] = value.split('亿');
  if (otherBillions.length || (belowBillions !== undefined && !billions)) return NaN;
  const [wan, lower, ...otherWan] = (belowBillions ?? billions).split('万');
  if (otherWan.length || (lower !== undefined && !wan)) return NaN;
  const upper = belowBillions === undefined ? 0 : smallNumber(billions) * 100000000;
  if (belowBillions === '') return upper;
  return upper + (lower === undefined ? smallNumber(wan) : smallNumber(wan) * 10000 + (lower ? smallNumber(lower) : 0));
}

function answerValue(input, unit) {
  const prepared = String(input).normalize('NFKC').trim()
    .replace(/[，,|\s]/gu, '')
    .replace(/[。！!]+$/gu, '')
    .split('=').at(-1)
    .replace(/^(?:答[:：]?|我算出|我算的是)?(?:原来(?:的数)?|最大(?:的)?|最小(?:的)?|结果|最接近40亿的数)?(?:约是|约为|是|为|有|约)?/u, '')
    .replace(/(?:颗(?:珠子|算珠)?|个(?:数|零|0)?|组|份|档|格|位)$/u, '');
  const explicitUnit = /(?:毫米|千米|公里|米)$/u.exec(prepared)?.[0];
  if (explicitUnit && (explicitUnit === '公里' ? '千米' : explicitUnit) !== unit) return NaN;
  const value = chineseNumber(explicitUnit ? prepared.slice(0, -explicitUnit.length) : prepared);
  return unit === '万' && /[万亿]/u.test(prepared) ? value / 10000 : value;
}

function hintParts(hints) {
  const [hint, ...more] = Array.isArray(hints) ? hints : [hints];
  return { ...(hint ? { hint } : {}), ...(more.length ? { hints: more } : {}) };
}

function numberStep(note, task, value, hints, unit) {
  return {
    note,
    task,
    format: 'number',
    check: (answer) => answerValue(answer, unit) === value,
    ...hintParts(hints),
  };
}

function slotStep(note, task, value, wholeNumber, hint, choices) {
  const step = numberStep(note, task, value, hint);
  return { ...step, choices, check: (answer) => step.check(answer) || answerValue(answer) === wholeNumber };
}

function beadChoice(note, task, side, hints) {
  return {
    note,
    task,
    ...hintParts(hints),
    format: 'phrase',
    choices: ['上珠', '下珠'],
    check: (answer) => {
      const part = String(answer).normalize('NFKC').replace(/[\s。！!]/gu, '')
        .replace(/^(?:我)?(?:应该)?(?:选择?|拨)?(?:1|一)?颗?/u, '')
        .replace(/(?:面|边)?的?(?:珠子?)$/u, '');
      return part === side;
    },
  };
}

function normalizeProblem(problem) {
  return String(problem || '').normalize('NFKC').trim()
    .replace(/^(?:(?:第\s*\d+\s*题\s*[.:、]?|\(\s*\d+\s*\)|\d+\s*(?:[、:]|\.(?!\d)))\s*)+/u, '')
    .replace(/[\s，,。；;：:、？?！!()“”「」□_]/gu, '')
    .replace(/(?<!\d)\.|\.(?!\d)/gu, '');
}

const maximumPlace = ['', '个', '十', '百', '千', '万', '十万', '百万', '千万', '亿'];

function zeroesRemoved(problem) {
  const match = /^一个数去掉末尾的?([一二三四五1-5])个[零0](?:后|以后|之后)?就?比原来小([0-9]+)(?:原来的数|这个数原来)(?:是多少|是)$/u.exec(problem);
  if (!match) return null;
  const zeros = smallNumber(match[1]);
  const factor = 10 ** zeros;
  const difference = Number(match[2]);
  const shortened = difference / (factor - 1);
  const original = shortened * factor;
  if (!Number.isSafeInteger(original) || !Number.isInteger(shortened) || shortened < 1) return null;
  return {
    steps: [
      numberStep('去掉末尾的零以后，剩下的数算 1 份。', '数一数，原来的数相当于这样的几份？', factor,
        [
          '补回一个零就是乘 10。按题里的零数，写下补零后相当于多少份。',
          '拿小数字试一下。把 2 变成 20，是原来的 10 倍。再补一个 0 就再乘一次 10。',
          '现在从 1 份开始。在纸上写 1，右边按题目说的个数补 0。读出这时一共有几份。',
        ]),
      numberStep('一个是原来的份数，一个只有 1 份。', '用原来的份数减 1，填相差的份数。', factor - 1,
        [
          '把原来的份数写在减号左边，减号右边写 1。',
          '想象长纸条由许多同样的小格组成。划掉最右边 1 格，要数的是还留在纸条上的小格。',
          `从刚找到的 ${factor} 份往回数一步。只填这一步少掉 1 份之后的数。`,
        ]),
      numberStep('题目里的差是这些份合在一起的大小。', '用题目里的差除以刚算出的份数，填每份是多少。', shortened,
        [
          '除法不好口算时，先把除数看成接近的整十、整百或整万，试一个商。',
          `先写出 ${difference} ÷ ${factor - 1}。把除数先看作 ${factor}，估一份大约是多少，再用这个数验算。`,
          `${factor - 1} 比 ${factor} 少 1。用你试出的商乘 ${factor}，再减去这同一个商。看看结果能不能对上题目给的差。`,
        ]),
      numberStep('每份就是去掉零以后留下的数。', '把题目说的零补回去，填原来的数。', original,
        [
          '先抄下刚算出的每份是多少，只在这个数的右边补零。',
          `先写你刚算出的 ${shortened}，再在右边画空格 ${'□'.repeat(zeros)}。每个空格补一个 0。`,
          '补完后从右往左点一遍这几个 0。左边原来的数字照抄，把整串数连起来填写。',
        ]),
    ],
    recap: '把去掉零后的数看成一份，用相差的份数求出每份，再补回零。',
  };
}

function tenBeads(problem, version) {
  if (!/^(?:在)?算盘上(?:拨|用)(?:10|十)颗(?:算珠|珠子|珠)(?:靠梁)?(?:能|可以)?(?:表示出?|拨出|组成)(?:一个)?(?:十|10)位数(?:其中)?最大(?:的)?是最小(?:的)?是(?:(?:与|离)?40亿最接近|最接近40亿)(?:的)?是$/u.test(problem)) return null;
  const original = {
    steps: [
      numberStep('一档放满时，有 1 颗上珠和 4 颗下珠。现在数珠子的颗数。', '把上珠和下珠的颗数加起来，填一共有几颗珠。', 5,
        ['在纸上画 1 个上珠和 4 个下珠，数一数一共画了几个圈。',
          '先点上面那个圈，再一个一个点下面的四个圈。只填你一共点了几次。']),
      numberStep('最左边一档用 5 颗珠放满，还剩 5 颗，紧挨着的第二档也能放满。', '读出这两档各表示的数字，空档补 0，填最大的十位数。', 9900000000,
        ['写完检查两个放满的档各用了几颗，一共必须用完 10 颗。',
          '先画十位数的格子 □□｜0000｜0000。左边两格都是满档。每格算一次上珠的 5 加下珠合起来的数。',
          '两档的摆法一样。第一格算完，把同一个数字放到第二格，后面八格照着写 0。']),
      numberStep('拨最小的十位数，十亿位先放 1 颗下珠。', '这题总共用 10 颗，放完十亿位还剩几颗？', 9,
        ['用总数 10 减去十亿位先用掉的 1 颗。',
          '伸出双手十根手指，弯一根代表拨到十亿位，数还伸着的手指。']),
      numberStep('个位最多能放 5 颗，先把个位放满。', '刚才还剩的珠子里，再用 5 颗放个位。还有几颗要放进十位？', 4,
        ['用上一步剩下的珠数减 5。个位装不下的珠要往左挪一档。',
          '把刚剩下的珠子用小圈画出来，划掉要放在个位的五颗。没划掉的就是十位要用的珠。']),
      numberStep('十亿位表示 1。十位是 4 颗下珠。个位是 1 颗上珠和 4 颗下珠。', '算好个位，从左往右读出十位数。十位的珠也要写进去。', 1000000049,
        ['按数位填 10｜0000｜00□□。倒数第 2 格放十位的数，最后 1 格放个位的数。',
          '十位有四颗下珠，先填 10｜0000｜004□。个位把上珠的 5 和下珠合起来的 4 相加。']),
      numberStep('40 亿的最高档要用 4 颗下珠。', '用 10 减去这 4 颗，填还剩几颗。', 6,
        ['在纸上画 10 个圈，划掉最高档已经用掉的圈，数还剩几个。',
          '先在十亿位拿走 4 颗。把仍在手里的珠数填进 10－4＝□。']),
      numberStep('要在 40 亿下面挨得很近，前三位得是 399。这三档就要超过 10 颗珠，不够用。', '从 40 亿上面找。先把个位放满 5 颗，刚才剩的 6 颗里还有几颗没用？', 1,
        ['用 6 减去个位已经用掉的珠数。',
          '个位拿走 5 颗。在草稿写 6－5＝□，方框里就是要往十位放的珠数。']),
      numberStep('个位已经放满。刚才余下的 1 颗放在十位，用下珠。', '保留十亿位的 4，空档补 0，填最接近 40 亿的十位数。', 4000000019,
        ['写完按十亿位、十位、个位查一遍，看看三档的珠子是否都写进了数里。',
          '先写 40｜0000｜00□□。在十位记一颗下珠表示的数，最后一格记满档表示的数。']),
    ],
    recap: '最高档定大小，剩下的珠按要变大还是变小往左或往右放。',
  };
  if (version < 3) return original;
  const [count, maximum, resetMinimum, remainingTens, , closest, closestRemaining] = original.steps;
  return {
    steps: [
      { ...count, task: '算 1＋4，只填放满一档用的珠子颗数。' },
      maximum,
      { ...resetMinimum, note: '先把刚才的最大数放在一边，清空算盘。求最小时，十亿位先放 1 颗下珠。' },
      remainingTens,
      slotStep('10｜0000｜004□。十位的 4 已经写好。个位有 1 颗上珠和 4 颗下珠。',
        '算 5＋4。它的得数就是个位方框里的数字。', 9, 1000000049,
        ['只看个位。先用上珠表示的 5，再加下珠合起来的 4。',
          '先记住 5，再向后数四次。最后数到的数字填进个位方框。'], ['4', '9', '5']),
      { ...closest, note: '个位也填好了，最小数是 10｜0000｜0049。现在找最接近 40 亿的数，十亿位先放 4 颗下珠。' },
      closestRemaining,
      beadChoice('40｜0000｜00□9。只剩一颗珠，要拨在十位。十位越小，这个数就越贴近 40 亿。',
        '十位这颗要拨上珠，还是下珠？', '下',
        ['一颗上珠表示 5，一颗下珠表示 1。选表示的数字更小的珠。',
          '只比较 5 和 1。选好较小的数字，再找能表示它的那颗珠。']),
    ],
    recap: '最大 99｜0000｜0000，最小 10｜0000｜0049，最接近 40 亿的是 40｜0000｜0019。看数位定大小，最后检查有没有用够 10 颗珠。',
  };
}

function moveDigit(problem) {
  if (!/^红红在听写一个数时把数字[4四]错(?:误)?(?:往|向)左(?:写|移)了(?:两|二|2)位使得?数字[4四]右边多写了(?:两|二|2)个[零0]左边少写了(?:两|二|2)个[零0]写出的数读作六亿零三百四十万零八十七正确的数(?:写作|是)$/u.test(problem)) return null;
  return {
    steps: [
      numberStep('从右往左每四位分成一级，分别看亿级、万级、个级。', '把红红写错的数用阿拉伯数字写出来。', 603400087,
        ['先写亿级的 6，再给万级和个级各留四个格。',
          '写成 6｜□□□□｜□□□□。中间从「三百四十」读，右边从「八十七」读，两组右对齐，前面的空格补 0。']),
      numberStep('刚写出的错数分组是 6｜0340｜0087。竖线只是用来分组。', '把 4 向右移两格，再照着 6｜03□□｜□087 写出整个数。', 603004087,
        ['先不看竖线，圈住 4 和右边紧挨的两个 0。4 移到这三格的最右边，其余两格填 0。',
          '把这三格想成三个座位。只挪数字 4，从左边座位走到第三个座位。再给前两个空座位补 0。']),
    ],
    recap: '读写大数先分级。移动一个数字时，给空出来的数位补上 0。',
  };
}

function maximizeDigitSum(problem) {
  const match = /^一个([二三四五六七八九2-9])位数(?:各个|每个|各)数位上的?(?:数|数字)的和(?:是|为|等于)([一二三四五六七八九1-9])(?:这个数)?最大(?:的)?是$/u.exec(problem);
  if (!match) return null;
  const width = smallNumber(match[1]);
  const sum = smallNumber(match[2]);
  const highest = maximumPlace[width];
  return {
    steps: [
      {
        note: '同样多的数位，比大小时从最左边看。', task: '写出最左边那一位的名字。', format: 'phrase',
        hint: '从右边按个、十、百……往左数，数到题目说的位数。',
        hints: [
          `在纸上画 ${width} 格，从右往左每格依次写上一个数位的名字，写完只读最左边那一格。`,
          `手指从「个、十、百、千、万、十万、百万、千万、亿」的第一个字开始，依次数到第 ${width} 个，读出它的名字。`,
        ],
        check: (answer) => new RegExp('^(?:是|最高位是)?' + highest + '(?:位)?[。.]?$','u').test(String(answer).trim()),
      },
      numberStep('把能用的数尽量放在最高位，别忘了检查各位相加的和。', '填满足条件的最大数。', sum * 10 ** (width - 1),
        ['先让最左边一格用完题目给的和。再试试其他格怎么填才不会增加这个和。',
          `画 ${width} 个框 ${'□'.repeat(width)}。左边第一框要尽可能大，试把它填成题目给的和。右边的框加在一起还能有多少？`]),
    ],
    recap: '同样多位的数，从最高位比。最高位尽可能大，整个数才可能最大。',
  };
}

function sixBeads(problem, version) {
  if (!/^(?:在)?算盘上(?:拨|用)(?:6|六)颗(?:算珠|珠子|珠)(?:靠梁)?(?:能|可以)?(?:表示出?|拨出|组成)(?:一个)?整万数(?:这个整万数)?最小(?:的)?是(?:如果|若)拨出的数是(?:八|8)位数(?:那么)?(?:这个整万数)?最大(?:的)?是$/u.test(problem)) return null;
  const original = {
    steps: [
      numberStep('整万数的末尾有几档必须空着。', '填整万数末尾至少有几个零。', 4,
        ['先找万位，再把它右边的数位一格一格数出来。',
          '画一行 万｜千｜百｜十｜个。只数分隔线右边有几个数位。']),
      numberStep('同一档最多能放 5 颗。要用完 6 颗，至少用十万位和万位。十万位先用 1 颗下珠。', '剩下的珠子都要放万位。填还有几颗。', 5,
        ['用题目给的 6 颗减掉十万位已用的 1 颗。',
          '画 6 个圈，圈出拨在十万位的 1 颗。数还没被圈到的珠。']),
      numberStep('万位的 5 颗珠是 1 颗上珠和 4 颗下珠。上珠表示 5，每颗下珠表示 1。', '算一算 5＋4×1，填万位上拨成的数字。', 9,
        ['先算 4 颗下珠合起来表示多少，再把上珠表示的 5 加进去。',
          '先记住上珠的 5。每数一颗下珠，就从 5 往后数一步。四颗下珠都数完时，把数到的数字填在万位。']),
      numberStep('十万位有一颗下珠，表示 1。万位也已经拨好。', '接上刚算的万位数字，补上四个零，写完整的六位数。', 190000,
        ['纸上写 1□｜0000。空格是你刚算出的万位数字。填好后把六位连着读。',
          '第一格是 1。第二格写上一步的数字。右边四格都是空的，把这四格各写一个 0。']),
      numberStep('八位数的千万位用 5 颗珠放满，还剩 1 颗。选百万位的上珠或下珠，只能拨其中一颗。', '选能表示较大数字的那颗珠，空档补 0，填最大的八位整万数。', 95000000,
        ['上珠一颗表示 5，下珠一颗表示 1。写完数一数，一共只能用 6 颗珠。',
          '写成 9□00｜0000。比较一颗上珠和一颗下珠分别表示的数，把较大的数字填进方框。']),
    ],
    recap: '整万数最右边四档留空。先定最高档，再用剩下的珠子。',
  };
  if (version < 3) return original;
  const [zeroes, remaining, minimumSlot] = original.steps;
  return {
    steps: [
      zeroes,
      remaining,
      {
        ...minimumSlot,
        task: '算 5＋4，填进 1□｜0000 的万位方框。',
        hint: '把一颗上珠表示的 5 和四颗下珠表示的 4 加起来。',
        choices: ['5', '4', '9'],
      },
      beadChoice('万位填好了，最小数是 19｜0000。现在清空算盘。求最大的八位整万数，先把千万位放满，再把最后一颗放在百万位。',
        '想让百万位的数字更大，最后这颗要拨上珠，还是下珠？', '上',
        ['一颗上珠表示 5，一颗下珠表示 1。选表示的数字更大的珠。',
          '试把上珠记作 5，把下珠记作 1。对比这两个数字，选择表示较大数字的珠。']),
      slotStep('9□00｜0000。千万位已经放满，百万位用的是你刚选的那一颗珠。',
        '填最大的整万数缺的百万位。只填方框里的一个数字。', 5, 95000000,
        ['看看在百万位选的是哪一颗珠，填它表示的数字。',
          '方框只对应一颗珠。想象它能换成几颗每颗表示 1 的下珠，写这个数。']),
    ],
    recap: '最小 19｜0000，最大的八位整万数是 9500｜0000。整万数最后四档留空，再数一数总共用了几颗珠。',
  };
}

function roundingLimits(problem) {
  const match = /^一个数省略亿位后面的尾数(?:得到的)?近似数(?:是|为)([0-9]{1,3})亿(?:如果|若)将(?:原来的数|原数)省略万位后面的尾数(?:得到的)?近似数最大(?:的)?是万最小(?:的)?是万$/u.exec(problem);
  if (!match) return null;
  const target = Number(match[1]) * 100000000;
  if (target < 100000000) return null;
  const lower = target - 50000000;
  const upper = target + 49999999;
  return {
    steps: [
      numberStep('省略亿位后面的尾数，要看千万位。比题里的整亿数少 5000 万，正好还能进上去。', '写出原数最小可能是多少。先写完整的数字。', lower,
        ['把题里的整亿数写成数字，再减去 5000 万。',
          `在草稿上写 ${match[1]} 亿－5000 万＝□。把 1 亿看成 10000 万，换成同样的单位再减。`]),
      numberStep('比这个整亿数多满 5000 万时，就会变成下一个整亿数。', '在刚好要进到下一亿的位置往回退 1，填写原数最大可能是多少。', upper,
        ['先把题里的整亿数加 5000 万，再减 1。',
          `先算 ${match[1]} 亿＋5000 万，再在数轴上往左走一步。把走到的那个数完整写出来。`]),
      numberStep('现在轮到按万位取近似数，要看千位。', '把刚找到的最大原数四舍五入到万位，填有多少万。', Math.round(upper / 10000),
        ['先把末尾四位圈在一起。如果这四位里的第一个数字满 5，就给左边的数加 1。',
          '只看圈里第一格的千位。千位够 5 时，让圈外面紧挨着的万位加 1，再把圈外面的数写下来。'], '万'),
      numberStep('再看看刚找到的最小原数的千位。', '把最小原数四舍五入到万位，填有多少万。', Math.round(lower / 10000),
        ['同样把末尾四位圈出来。先看千位要不要进 1，再写左边有多少万。',
          '先圈住右边四位。如果它们本来都是 0，把左边的数直接抄下来，再写上单位万。'], '万'),
    ],
    recap: '先找能四舍五入到指定整亿数的两个边界，再分别取到万位。',
  };
}

function scaleCoins(problem) {
  const match = /^(\d+)枚[1一]元硬币叠(?:放)?在一起的高度(?:大)?约(?:是|为)(\d+)毫米([\d万亿]+)枚[1一]元硬币叠(?:放)?在一起的高度(?:大)?约(?:是|为)千米$/u.exec(problem);
  if (!match) return null;
  const batch = Number(match[1]);
  const height = Number(match[2]);
  const total = chineseNumber(match[3]);
  const batches = total / batch;
  const millimeters = batches * height;
  if (!Number.isSafeInteger(millimeters) || !Number.isInteger(batches) || batch < 1 || height < 1 || batches < 2) return null;
  return {
    steps: [
      numberStep('把题目开头说的那几枚硬币看作一组。', '用总枚数除以每组的枚数，填一共有几组。', batches,
        ['先把题里的总枚数写成一串数字，再看每组分走几枚。',
          `题目有 ${total} 枚，每组只装 ${batch} 枚。写 ${total} ÷ ${batch}＝□，方框里的数就是组数。`]),
      numberStep('每组的高度在题目里。', '用组数乘每组高度，填叠起来一共有多少毫米。', millimeters,
        ['写一个乘法算式，左边写刚算出的组数，右边写每组的高度。',
          `把刚算出的 ${batches} 组，每组都想成一段 ${height} 毫米。写 ${batches} × ${height}＝□ 毫米。`], '毫米'),
      numberStep('1000 毫米是 1 米。', '把刚算出的总高度换成米。', millimeters / 1000,
        ['每 1000 毫米换成 1 米。用刚算的毫米数除以 1000。',
          `填这个框 ${millimeters} ÷ 1000＝□ 米。看看刚才算过的是毫米，这里要改用米。`], '米'),
      numberStep('1000 米是 1 千米。', '把总高度换成千米，填出题目要的答案。', millimeters / 1000000,
        ['从上一步算出的米数出发，再做一次除以 1000。',
          `填这个框 ${millimeters / 1000} ÷ 1000＝□ 千米。最后读出方框里的数字和它的单位。`], '千米'),
    ],
    recap: '先用组数求出总高度，再一步一步换单位。',
  };
}

export function getFirstGuide(problem, version = 3) {
  const normalized = normalizeProblem(problem);
  for (const match of [zeroesRemoved, tenBeads, moveDigit, maximizeDigitSum, sixBeads, roundingLimits, scaleCoins]) {
    const guide = match(normalized, version);
    if (guide) return guide;
  }
  return null;
}
