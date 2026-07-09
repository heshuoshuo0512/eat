import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNumber,
  normalizeProfileInput,
  parseList,
  validateImageFile,
  validateLoginForm,
  validateQuestion,
  validateReviewForm,
} from '../src/domain/validation.js';

describe('production form validation', () => {
  it('rejects malformed login credentials before API submission', () => {
    assert.match(validateLoginForm({ username: 'a', password: 'student123' }), /用户名/);
    assert.match(validateLoginForm({ username: '演示学生', password: '123' }), /密码长度/);
    assert.equal(validateLoginForm({ username: '演示学生', password: 'student123' }), '');
  });

  it('requires a selected dish, integer rating, and substantive review content', () => {
    assert.match(validateReviewForm({ targetId: '', rating: 5, content: '好吃' }), /请选择/);
    assert.match(validateReviewForm({ targetId: 'd-1', rating: 6, content: '好吃' }), /评分/);
    assert.match(validateReviewForm({ targetId: 'd-1', rating: 5, content: ' ' }), /评价内容/);
    assert.equal(validateReviewForm({ targetId: 'd-1', rating: 5, content: '清爽高蛋白' }), '');
  });

  it('normalizes profile budget and avoid-list fields', () => {
    assert.deepEqual(
      normalizeProfileInput({ goal: 'fatLoss', budgetMax: '18' }, '香菜, 牛肉  辣椒'),
      { goal: 'fatLoss', budgetMax: 18, avoid: ['香菜', '牛肉', '辣椒'] }
    );
    assert.throws(() => normalizeProfileInput({ budgetMax: 7 }, ''), /预算上限/);
  });

  it('parses comma and whitespace separated lists with required mode', () => {
    assert.deepEqual(parseList('高蛋白, 低脂 夜宵', '标签'), ['高蛋白', '低脂', '夜宵']);
    assert.throws(() => parseList('', '标签', { required: true }), /至少填写 1 项/);
  });

  it('guards numeric admin fields and RAG question length', () => {
    assert.equal(assertNumber('16.5', '价格', 1, 200), 16.5);
    assert.throws(() => assertNumber('free', '价格', 1, 200), /价格/);
    assert.match(validateQuestion('短', { min: 2, max: 100, label: '检索关键词' }), /检索关键词/);
    assert.equal(validateQuestion('鸡胸肉', { min: 2, max: 100, label: '检索关键词' }), '');
  });

  it('accepts only production image upload types under 5MB', () => {
    assert.equal(validateImageFile({ type: 'image/png', size: 5 * 1024 * 1024 }), '');
    assert.match(validateImageFile({ type: 'text/plain', size: 1 }), /仅支持/);
    assert.match(validateImageFile({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }), /5MB/);
  });
});
