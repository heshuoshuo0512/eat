import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const output = resolve(process.argv[2] || 'collector-datasets/smoke-fixture');
const definitions = [
  { dishId: 'smoke-tomato-eggs', name: '番茄炒蛋', canonical: '番茄炒蛋', venue: '测试餐饮区', stall: '家常菜档口', color: '#d9534f' },
  { dishId: 'smoke-broccoli', name: '清炒西兰花', canonical: '清炒西兰花', venue: '测试餐饮区', stall: '素菜档口', color: '#3f8d62' },
];
const manifest = [];
for (const definition of definitions) {
  for (const [split, count] of Object.entries({ train: 4, validation: 2, test: 2 })) {
    for (let index = 0; index < count; index += 1) {
      const relative = `images/${split}/${definition.dishId}/${index + 1}.jpg`;
      const target = resolve(output, relative);
      await mkdir(resolve(target, '..'), { recursive: true });
      const image = await sharp({ create: { width: 224, height: 224, channels: 3, background: definition.color } })
        .composite([{ input: Buffer.from(`<svg width="224" height="224"><circle cx="${75 + index * 8}" cy="112" r="48" fill="#f4d35e"/><rect x="118" y="62" width="62" height="100" rx="24" fill="#ffffff"/></svg>`), top: 0, left: 0 }])
        .jpeg({ quality: 90 }).toBuffer();
      await writeFile(target, image);
      const sha256 = createHash('sha256').update(image).digest('hex');
      manifest.push({ image: relative, dish_id: definition.dishId, canonical_name: definition.canonical, dish_name: definition.name, group_id: 'smoke-group', group_name: '烟雾测试', venue: definition.venue, stall: definition.stall, split, catalog_version: 'smoke-v1', sha256, prompt_generic: `一份${definition.canonical}`, prompt_instance: `${definition.venue}${definition.stall}售卖的${definition.canonical}` });
    }
  }
}
for (let index = 0; index < 4; index += 1) {
  const relative = `images/unknown/smoke-unknown/${index + 1}.jpg`;
  const target = resolve(output, relative);
  await mkdir(resolve(target, '..'), { recursive: true });
  const image = await sharp({ create: { width: 224, height: 224, channels: 3, background: '#58728a' } }).jpeg().toBuffer();
  await writeFile(target, image);
  manifest.push({ image: relative, dish_id: 'smoke-unknown', canonical_name: '未覆盖菜品', dish_name: '未覆盖菜品', group_id: 'smoke-group', group_name: '烟雾测试', venue: '其他区域', stall: '其他档口', split: 'unknown', catalog_version: 'smoke-v1', sha256: createHash('sha256').update(image).digest('hex'), prompt_generic: '一份未覆盖菜品', prompt_instance: '其他区域其他档口售卖的未覆盖菜品' });
}
await writeFile(resolve(output, 'manifest.jsonl'), `${manifest.map((item) => JSON.stringify(item)).join('\n')}\n`);
await writeFile(resolve(output, 'summary.json'), `${JSON.stringify({ version: 'smoke-fixture', eligibleDishes: 2, images: manifest.length }, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, output, images: manifest.length }, null, 2));
