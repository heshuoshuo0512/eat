import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(path), 'utf8');
const router = read('src/router/index.js');
const app = read('src/App.vue');
const admin = read('src/views/AdminView.vue');
const agent = read('src/views/AgentView.vue');

describe('administrator companion UI contracts', () => {
  it('defaults /admin to content review and keeps review/post deep links', () => {
    assert.match(router, /path:\s*'\/admin'[\s\S]*beforeEnter:[\s\S]*panel:\s*'reviews',\s*tab:\s*'reviews'/);
    assert.match(app, /to:\s*'\/admin\?panel=reviews&tab=reviews',\s*label:\s*'内容审核'/);
    assert.match(admin, /selectModerationTab\('reviews'\)/);
    assert.match(admin, /selectModerationTab\('posts'\)/);
    assert.match(admin, /panel:\s*'reviews',\s*tab/);
  });

  it('uses backend review filters and supports re-moderation without post deletion', () => {
    for (const filter of ['targetType', 'canteenId', 'stallId', 'dishId']) {
      assert.match(admin, new RegExp(`${filter}:\\s*review`));
    }
    assert.match(admin, /updateReviewStatusAdmin\(id, status\)/);
    assert.match(admin, /moderateReview\(review\.id, 'pending'\)/);
    assert.match(admin, /updatePostStatusAdmin\(id, status\)/);
    assert.doesNotMatch(admin, /deletePost|removePost/);
    assert.match(admin, /linkedReviewStatus/);
  });

  it('pins the four dining regions in the required order and responsive grid', () => {
    const ids = ['campus-main', 'north-zone', 'south-zone', 'east-zone'];
    const positions = ids.map((id) => admin.indexOf(`id: '${id}'`));
    assert.ok(positions.every((position) => position >= 0));
    assert.deepEqual([...positions].sort((left, right) => left - right), positions);
    assert.match(admin, /\.region-management-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
    assert.match(admin, /@media \(max-width: 720px\)[\s\S]*\.region-management-grid[^}]*grid-template-columns:\s*1fr/);
    assert.match(admin, /食堂 → 餐厅\/楼层餐区 → 档口 → 菜品/);
    assert.match(admin, /parentId/);
  });

  it('uses the venue, area, stall and dish entry hierarchy with URL-restored context', () => {
    const taskDefinitions = admin.match(/const entryTaskDefinitions\s*=\s*\[([\s\S]*?)\n\];/)?.[1];
    assert.ok(taskDefinitions, 'entry task definitions should remain explicit and testable');

    const taskIds = ['venue', 'area', 'stall', 'dish', 'import'];
    const declaredTaskIds = [...taskDefinitions.matchAll(/id:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.deepEqual(declaredTaskIds, taskIds);
    assert.doesNotMatch(taskDefinitions, /id:\s*['"]sub-stall['"]/, 'legacy child stalls must not be creatable');
    for (const [task, permission] of [
      ['venue', 'canWriteCanteens'],
      ['area', 'canWriteCanteens'],
      ['stall', 'canWriteStalls'],
      ['dish', 'canWriteDishes'],
      ['import', 'canBulkImportDishes']
    ]) {
      assert.match(taskDefinitions, new RegExp(`\\{\\s*id:\\s*'${task}'[^}]*allowed:\\s*${permission}[^}]*\\}`));
    }

    const contextDefinition = admin.match(/const entryContext\s*=\s*reactive\(\{([^}]+)\}\)/)?.[1];
    assert.ok(contextDefinition, 'entry context should be a single reactive object');
    const contextKeys = [...contextDefinition.matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:/g)].map((match) => match[1]);
    assert.deepEqual(contextKeys, ['venueId', 'areaId', 'stallId']);
    for (const key of ['venueId', 'areaId', 'stallId']) {
      assert.match(contextDefinition, new RegExp(`${key}:\\s*['"]['"]`));
      assert.match(admin, new RegExp(`route\\.query\\.${key}`), `${key} should restore from the URL`);
      assert.match(admin, new RegExp(`entryContext\\.${key}`), `${key} should drive the cascading controls`);
    }
    assert.doesNotMatch(contextDefinition, /regionId|canteenId|primaryStallId|childStallId/);
    assert.match(admin, /initializeEntryWorkspace\(\)/);

    const areaLabelDefinition = admin.match(/const entryAreaLabel\s*=\s*computed\(\(\)\s*=>\s*\{?[\s\S]*?\}\);/)?.[0];
    assert.ok(areaLabelDefinition, 'area terminology should be computed from the selected venue');
    assert.match(areaLabelDefinition, /campus-main|dining_complex/);
    assert.match(areaLabelDefinition, /餐厅/);
    assert.match(areaLabelDefinition, /楼层餐区/);
    assert.match(admin, /\{\{\s*entryAreaLabel\s*\}\}/);
    assert.match(admin, /v-model="entryContext\.venueId"/);
    assert.match(admin, /v-model="entryContext\.areaId"/);
    assert.match(admin, /v-model="entryContext\.stallId"/);
    assert.match(admin, /router\.replace\(\{\s*path:\s*'\/admin\/input',\s*query/);

    for (const label of ['保存', '保存并继续新增', '保存后返回数据管理']) {
      assert.ok(admin.includes(label), `missing save action: ${label}`);
    }
  });

  it('keeps CSV import preview-first and disables confirmation while loading', () => {
    assert.ok(admin.indexOf('CSV 批量导入菜品') < admin.indexOf('高级导入：JSON 数组'));
    assert.match(admin, /previewCsvImport/);
    assert.match(admin, /confirmCsvImport/);
    const confirmButton = admin.split(/\r?\n/).find((line) => line.includes('@click="confirmCsvImport"'));
    assert.ok(confirmButton, 'CSV confirmation button should be present');
    assert.match(confirmButton, /:disabled="[^"]*excelLoading[^"]*"/);
    assert.match(confirmButton, /excelRows\.some\(\(row\) => !row\.valid\)/);
    assert.match(admin, /previewJsonImport/);
    assert.match(admin, /confirmJsonImport/);
    assert.doesNotMatch(admin, /@click="importBulkDishes"/);
    assert.match(admin, /AI 图片识别预填/);
    assert.match(admin, /只预填 · 需确认/);
  });

  it('keeps AI configuration concise, paginated, and permission-isolated', () => {
    for (const tab of ['provider', 'monitor', 'tenants']) {
      assert.match(admin, new RegExp(`selectAiTab\\('${tab}'\\)`));
    }
    assert.match(admin, /const aiUsagePageSize = 20/);
    assert.match(admin, /hasApiKey/);
    assert.match(admin, /durationMs/);
    assert.match(admin, /window\.confirm\('确认清空管理员 AI 配置/);
    assert.match(admin, /hasCapability\('tenant:manage'\)/);
    assert.match(admin, /if \(!canManageTenants\.value\) return/);
    assert.match(admin, /summary\.length > 80/);
    assert.doesNotMatch(admin, /result\.sample/);
  });

  it('keeps mobile moderation and AI logs readable without a sticky navigation overlay', () => {
    assert.match(admin, /data-label="审核操作"/);
    assert.match(admin, /class="table-wrap ai-usage-table"/);
    assert.match(admin, /\.moderation-table td::before,[\s\S]*content:\s*attr\(data-label\)/);
    assert.match(admin, /\.ai-usage-table td[\s\S]*overflow-wrap:\s*anywhere/);
    assert.match(admin, /\.shell:has\(\.moderation-workspace\)[\s\S]*position:\s*relative/);
  });

  it('keeps the operations agent redacted and motion-aware', () => {
    assert.match(agent, /<h1>运营智能体<\/h1>/);
    assert.match(agent, /脱敏工具摘要/);
    assert.match(agent, /summarizeToolResult/);
    assert.match(agent, /normalizedPersonas/);
    assert.match(agent, /groundednessScore/);
    assert.match(agent, /toolSuccessRate/);
    assert.match(agent, /safetyScore/);
    assert.match(agent, /prefers-reduced-motion/);
    assert.match(agent, /label:\s*'经营概况'[\s\S]*统计今天营业收入、热销菜品和售罄数量/);
    assert.match(agent, /label:\s*'今日午餐'[\s\S]*推荐今天午餐中的素食菜品/);
    assert.match(agent, /meal_recommendation:\s*'餐食推荐'/);
    assert.match(agent, /recommendation\.source \|\| recommendation\.answerSource/);
    assert.match(agent, /tool === 'meal\.recommend' \|\| tool === 'rag\.meal_advisor'/);
    assert.doesNotMatch(agent, /原始 SSE|函数 Schema|完整响应/);
    assert.match(admin, /prefers-reduced-motion/);
  });
});
