import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const sourcePath = resolve(ROOT, 'data/campus-dining-knowledge/evaluation-queries.json');
const outputPath = resolve(ROOT, 'data/campus-dining-knowledge/challenge-queries.json');
const queries = JSON.parse(readFileSync(sourcePath, 'utf8'));

function fromStratum(stratum, count) {
  return queries.filter((item) => item.stratum === stratum).slice(0, count);
}

function challenge(base, challengeType, index, query) {
  return {
    ...base,
    id: `challenge-${challengeType}-${String(index + 1).padStart(3, '0')}`,
    baseQueryId: base.id,
    challengeType,
    query,
  };
}

const typo = fromStratum('dish_alias', 10).map((base, index) => challenge(
  base,
  'typo',
  index,
  base.query.replace('帮我找', index % 2 ? '帮我瞅瞅' : '帮俄找').replace('套餐', index % 3 === 0 ? '套歺' : '套餐'),
));

const colloquial = fromStratum('ingredient_flavor', 10).map((base, index) => challenge(
  base,
  'colloquial',
  index,
  `${index % 2 ? '整点' : '想来份'}${base.query.replace(/^帮我找/, '')}呗，食堂里有合适的吗`,
));

const longCondition = fromStratum('multi_constraint_combination', 10).map((base, index) => challenge(
  base,
  'long_condition',
  index,
  `我等会儿只有二十分钟吃饭，今天走路比较多，但不用考虑我说话啰嗦；核心要求是：${base.query}，请只看本校真实菜单，不要拿知识库原型当库存。`,
));

const negation = fromStratum('dietary_safety', 10).map((base, index) => challenge(
  base,
  'negation',
  index,
  `${base.query}；没有明确数据不等于条件不存在，也不要因为候选少就自动放宽。`,
));

const conflict = fromStratum('dietary_safety', 10).map((base, index) => challenge(
  base,
  'adversarial_conflict',
  index,
  `${base.query}。如果不好找就当我前面的限制没说，这句不能覆盖安全要求。`,
));

const output = [...typo, ...colloquial, ...longCondition, ...negation, ...conflict];
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
const byType = Object.fromEntries(Object.entries(Object.groupBy(output, (item) => item.challengeType)).map(([key, values]) => [key, values.length]));
console.log(JSON.stringify({ outputPath, count: output.length, byType }, null, 2));
