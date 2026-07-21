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
    assert.match(admin, /直属菜品/);
    assert.match(admin, /parentId/);
  });

  it('provides focused cascading entry with three save outcomes and CSV-first import', () => {
    for (const task of ['canteen', 'stall', 'sub-stall', 'dish', 'import']) {
      assert.match(admin, new RegExp(`id:\\s*'${task}'`));
    }
    assert.match(admin, /餐饮区/);
    assert.match(admin, /entryContext\.canteenId/);
    assert.match(admin, /entryContext\.primaryStallId/);
    assert.match(admin, /entryContext\.childStallId/);
    assert.match(admin, /initializeEntryWorkspace\(\)/);
    assert.match(admin, /entryTaskDefinitions[\s\S]*allowed:\s*canWriteCanteens[\s\S]*allowed:\s*canWriteStalls[\s\S]*allowed:\s*canWriteDishes/);
    assert.match(admin, /entryTasks = computed/);
    assert.match(admin, /stallForm\.id && canDeleteStalls/);
    assert.match(admin, /if \(!canDeleteStalls\.value\)/);
    assert.match(admin, /parentId:\s*entryMode\.value === 'sub-stall'/);
    for (const action of ["saveCanteen('continue')", "saveStall('return')", "saveDish('stay')"]) {
      assert.ok(admin.includes(action));
    }
    assert.ok(admin.indexOf('CSV 批量导入菜品') < admin.indexOf('高级导入：JSON 数组'));
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
