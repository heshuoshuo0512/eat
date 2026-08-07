import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const option = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const sourceRoot = resolve(option('source-root', 'D:/Mywechatlog/xwechat_files/wxid_06l166che9wp22_76f7/msg/attach/9e20f478899dc29eb19741386f9343c8/2026-08/Rec/3ad6c848d91e829e/F'));
const outputJson = resolve(option('output-json', 'docs/连锁菜单清洗与分类审计-2026-08-08.json'));
const outputMarkdown = resolve(option('output-md', 'docs/连锁菜单清洗与分类审计-2026-08-08.md'));

const targetLocations = {
  '0090汉堡工厂.md': ['0090汉堡工厂（大榕树餐厅）'],
  '茶百道.md': ['茶百道（广缘店）'],
  '茶瀑布.md': ['茶瀑布（西区大食堂3楼东）'],
  '华莱士.md': [],
  '橘包包现烤面包.md': ['橘包包现烤面包（燕大西区广缘店）'],
  '肯德基.md': ['肯德基（广缘店）'],
  '库迪咖啡.md': ['库迪咖啡（广缘店）'],
  '麦当劳.md': ['麦当劳（广缘店）'],
  '蜜雪冰城.md': ['蜜雪冰城（燕大食堂二楼东店）', '蜜雪冰城（广缘店）'],
  '瑞幸咖啡.md': ['瑞幸咖啡（广缘店）'],
  '塔斯汀.md': ['塔斯汀中国汉堡（大榕树餐厅）'],
  '甜啦啦.md': ['甜啦啦鲜果茶（广缘店）'],
  '幸运咖.md': ['幸运咖（广缘店）'],
  '益禾堂.md': ['益禾堂（广缘店）', '益禾堂（燕鸣湖餐厅）'],
  '左手边.md': ['左手边（喜进甲餐厅）'],
};

const beverageBrands = new Set(['茶百道.md', '茶瀑布.md', '库迪咖啡.md', '蜜雪冰城.md', '瑞幸咖啡.md', '甜啦啦.md', '幸运咖.md', '益禾堂.md', '左手边.md']);
const mealPattern = /汉堡|鸡饭|拌饭|盖饭|炒饭|米饭|套餐饭|意面|披萨/;
const beveragePattern = /奶茶|奶绿|奶茶|咖啡|拿铁|美式|澳白|浓缩|冰茶|果茶|果汁|柠檬水|气泡|牛乳|乌龙|茉莉|茶饮|幸运冰|冰奶|酸奶|饮品|豆浆/;
const snackPattern = /面包|蛋糕|贝果|布朗尼|菠萝包|牛角包|甜品|冰淇淋|圣代|薯条|薯饼|鸡块|鸡翅|炸鸡|鸡条|小食|零食|蛋挞|肉松|烤串|鸡架|派|卷|三明治|芝士|华夫|可颂|奶昔|冰沙|桶|拼盘/;
const addonPattern = /小料|加料|加冰|加奶|酱料|蘸料|蘸酱|额外|打包袋|打包盒|酱$/;
const componentPattern = /^(?:芝士片|菠萝片|牛肉饼|鸡蛋|培根|生菜|番茄片|酸黄瓜|洋葱圈|甜玉米|咖喱酱|番茄酱|沙拉酱|面包胚|鸡腿排)$/;
const nonFoodPattern = /周边|玩具|公仔|贴纸|杯子|保温杯|钥匙扣|购物袋|优惠券|代金券|会员卡/;
const ambiguousRulePattern = /任选|随心配|随心拼|随心选|自由选|自选/;
const clearBundlePattern = /汉堡|双堡|三堡|鸡桶|炸鸡桶|\d+件套/;

function normalizeText(value) {
  return String(value || '').normalize('NFKC').replace(/[\u00a0\u2007\u202f\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function canonicalName(value) {
  return normalizeText(value).replace(/[\s·・,，。.!！:：;；'"“”‘’()（）【】\[\]{}]/g, '').toLowerCase();
}

function parsePrice(line) {
  const match = line.match(/(?:¥|￥)?\s*(\d+(?:\.\d+)?)\s*(元|块)?\s*(起)?\s*$/i);
  if (!match) return null;
  const name = normalizeText(line.slice(0, match.index)).replace(/[：:]\s*$/, '').trim();
  if (!name) return null;
  const amount = Number(match[1]);
  return { name, price: amount, priceDisplay: `${amount}${match[3] ? '元起' : '元'}`, priceMode: match[3] ? 'from' : 'fixed' };
}

function cleanLine(rawLine, lineNumber, sourceName) {
  const raw = normalizeText(rawLine);
  if (!raw) return { status: 'excluded', reason: 'blank', sourceName, lineNumber, rawText: rawLine };
  const line = raw.replace(/^(?:[-*•]\s*|\d+[.)、]\s*)/, '');
  const withoutPrice = parsePrice(line);
  if (!withoutPrice) return { status: 'excluded', reason: 'no_explicit_price_or_menu_heading', sourceName, lineNumber, rawText: rawLine };
  const name = withoutPrice.name.replace(/\s+/g, ' ').trim();
  if (!name || name === sourceName.replace(/\.md$/i, '') || /菜单|目录|商品列表|新品推荐/.test(name)) {
    return { status: 'excluded', reason: 'menu_heading', sourceName, lineNumber, rawText: rawLine };
  }
  if (addonPattern.test(name) || componentPattern.test(name)) return { status: 'excluded', reason: 'addon_or_sauce', sourceName, lineNumber, rawText: rawLine };
  if (nonFoodPattern.test(name)) return { status: 'excluded', reason: 'non_food_merchandise', sourceName, lineNumber, rawText: rawLine };
  if (/用券|券专享|优惠专享/.test(name)) return { status: 'review_required', reason: 'promotion_or_coupon_rule', sourceName, lineNumber, rawText: rawLine };
  if (ambiguousRulePattern.test(name) && !clearBundlePattern.test(name)) {
    return { status: 'excluded', reason: 'ambiguous_free_combination_rule', sourceName, lineNumber, rawText: rawLine };
  }
  return { status: 'parsed', sourceName, lineNumber, rawText: rawLine, ...withoutPrice };
}

function classify(item) {
  const name = item.name;
  if (beveragePattern.test(name) && !mealPattern.test(name) && !snackPattern.test(name)) {
    return { itemType: 'beverage', category: '饮品', rule: 'explicit_beverage_name' };
  }
  if (mealPattern.test(name)) return { itemType: 'meal', category: '汉堡套餐', rule: 'main_food_shape' };
  if (snackPattern.test(name)) return { itemType: 'snack', category: '小吃单品', rule: 'standalone_snack_or_bakery' };
  if (beverageBrands.has(item.sourceName)) return { itemType: 'beverage', category: '饮品', rule: 'beverage_brand_context' };
  return { itemType: 'review_required', category: '', rule: 'unclassified_product_name' };
}

function findSourceFiles() {
  if (!existsSync(sourceRoot)) throw new Error(`菜单来源目录不存在: ${sourceRoot}`);
  return readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(sourceRoot, entry.name))
    .flatMap((directory) => readdirSync(directory).filter((name) => name.endsWith('.md')).map((name) => join(directory, name)))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function buildAudit() {
  const files = findSourceFiles();
  const aggregate = files.find((file) => file.endsWith('连锁店菜单合集.md'));
  const aggregateNames = new Set();
  if (aggregate) {
    for (const line of readFileSync(aggregate, 'utf8').split(/\r?\n/)) {
      const parsed = parsePrice(normalizeText(line));
      if (parsed) aggregateNames.add(`${canonicalName(parsed.name)}|${parsed.price}`);
    }
  }
  const accepted = [];
  const excluded = [];
  const sourceAudit = [];
  const seen = new Set();

  for (const file of files) {
    const sourceName = file.split(/[\\/]/).pop();
    if (sourceName === '连锁店菜单合集.md') {
      sourceAudit.push({ sourceName, status: 'reference_only', reason: 'aggregate_duplicate_source', sha256: sha256(readFileSync(file)) });
      continue;
    }
    const buffer = readFileSync(file);
    const targets = targetLocations[sourceName] || [];
    const rows = { accepted: 0, excluded: 0, reviewRequired: 0 };
    for (const [index, rawLine] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
      const cleaned = cleanLine(rawLine, index + 1, sourceName);
      if (cleaned.status !== 'parsed') {
        excluded.push(cleaned);
        rows.excluded += 1;
        continue;
      }
      const classification = classify(cleaned);
      const shared = targets.length > 1;
      if (!targets.length || classification.itemType === 'review_required') {
        excluded.push({ ...cleaned, ...classification, status: 'review_required', reason: !targets.length ? 'unmapped_target_location' : 'unclassified_product_name' });
        rows.reviewRequired += 1;
        continue;
      }
      for (const location of targets) {
        const key = `${location}|${canonicalName(cleaned.name)}|${cleaned.price}`;
        if (seen.has(key)) {
          excluded.push({ ...cleaned, status: 'excluded', reason: 'duplicate_within_target', location });
          rows.excluded += 1;
          continue;
        }
        seen.add(key);
        accepted.push({
          id: `chain-${sha256(Buffer.from(`${sourceName}\n${location}\n${cleaned.name}\n${cleaned.price}`)).slice(0, 14)}`,
          sourceName,
          sourceHash: sha256(buffer),
          sourceLine: index + 1,
          sourceRawText: cleaned.rawText,
          merchant: sourceName.replace(/\.md$/i, ''),
          location,
          sourceScope: shared ? 'shared_brand_menu' : 'single_store_source',
          name: cleaned.name,
          price: cleaned.price,
          priceDisplay: cleaned.priceDisplay,
          priceMode: cleaned.priceMode,
          itemType: classification.itemType,
          category: classification.category,
          classificationRule: classification.rule,
          aggregateDuplicateReference: aggregateNames.has(`${canonicalName(cleaned.name)}|${cleaned.price}`),
          publicationStatus: 'review_required',
        });
        rows.accepted += 1;
      }
    }
    sourceAudit.push({ sourceName, status: targets.length ? 'mapped_for_review' : 'unmapped_for_review', targetLocations: targets, sha256: sha256(buffer), rows });
  }
  return {
    generatedAt: new Date().toISOString(),
    sourceRoot,
    publicationStatus: 'review_required',
    aggregateSource: aggregate ? '连锁店菜单合集.md' : null,
    policy: {
      acceptedOnlyWithExplicitPrice: true,
      aggregateIsReferenceOnly: true,
      noProductionImport: true,
      categories: ['汉堡套餐', '饮品', '小吃单品'],
      excludedRules: ['menu_heading', 'addon_or_sauce', 'non_food_merchandise', 'ambiguous_free_combination_rule', 'unmapped_target_location', 'unclassified_product_name', 'duplicate_within_target'],
    },
    sources: sourceAudit,
    accepted,
    excluded,
    summary: {
      sourceFileCount: sourceAudit.filter((source) => source.sourceName !== '连锁店菜单合集.md').length,
      acceptedCount: accepted.length,
      excludedCount: excluded.filter((row) => row.status === 'excluded').length,
      reviewRequiredCount: excluded.filter((row) => row.status === 'review_required').length,
      sharedBrandRows: accepted.filter((row) => row.sourceScope === 'shared_brand_menu').length,
      byItemType: Object.fromEntries(['meal', 'snack', 'beverage'].map((type) => [type, accepted.filter((row) => row.itemType === type).length])),
    },
  };
}

function markdown(audit) {
  const lines = [
    '# 连锁菜单清洗与分类审计（2026-08-08）',
    '',
    `生成时间：${audit.generatedAt}`,
    `状态：${audit.publicationStatus}（本批次未写入生产目录）`,
    '',
    '## 处理结果',
    '',
    `- 单店来源文件：${audit.summary.sourceFileCount} 份`,
    `- 保留商品记录：${audit.summary.acceptedCount} 条`,
    `- 排除记录：${audit.summary.excludedCount} 条`,
    `- 待核验记录：${audit.summary.reviewRequiredCount} 条`,
    `- 共享菜单记录：${audit.summary.sharedBrandRows} 条`,
    `- 分类统计：餐食 ${audit.summary.byItemType.meal}，小吃 ${audit.summary.byItemType.snack}，饮品 ${audit.summary.byItemType.beverage}`,
    '',
    '只保留有明确价格、可单独购买且能绑定地点的商品；菜单标题、加料、小料、酱料、非食品、自由组合规则和无法分类的条目不进入学生端。',
    '',
    '## 保留商品清单',
    '',
    '| 编号 | 商家 | 商品 | 地点 | 分类 | 价格 | 来源 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of audit.accepted) lines.push(`| ${row.id} | ${row.merchant} | ${row.name} | ${row.location} | ${row.itemType} / ${row.category} | ${row.priceDisplay} | ${row.sourceName}#${row.sourceLine} |`);
  lines.push('', '## 排除与待核验', '', '| 来源 | 行号 | 原文 | 结果 | 原因 |', '| --- | ---: | --- | --- | --- |');
  for (const row of audit.excluded) lines.push(`| ${row.sourceName} | ${row.lineNumber} | ${normalizeText(row.rawText).replace(/\|/g, '\\|')} | ${row.status} | ${row.reason} |`);
  lines.push('', '## 发布边界', '', '- `连锁店菜单合集.md` 仅用于重复核对，不作为导入源。', '- 同品牌多门店记录保留 `shared_brand_menu` 标记，不代表每店已现场核验。', '- 本次只生成审计结果，管理员确认前不执行生产导入。', '- 机器审计明细见同名 JSON 文件。');
  return `${lines.join('\n')}\n`;
}

const audit = buildAudit();
writeFileSync(outputJson, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
writeFileSync(outputMarkdown, markdown(audit), 'utf8');
console.log(JSON.stringify({ outputJson, outputMarkdown, summary: audit.summary }, null, 2));
