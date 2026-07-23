import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

let server;
let baseUrl;
let studentToken;
let otherToken;
let adminToken;
let dishId;
let canteenId;
let stallId;

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function login(username, password) {
  const response = await req('/api/auth/login', { method: 'POST', body: { username, password } });
  return response.data.token;
}

async function approveReviewByContent(content) {
  const pending = await req('/api/admin/reviews?status=pending', { token: adminToken });
  const review = pending.data.reviews.find((item) => item.content === content);
  assert.ok(review, `pending review found: ${content}`);
  const approved = await req(`/api/admin/reviews/${review.id}/status`, { method: 'PATCH', token: adminToken, body: { status: 'approved' } });
  assert.equal(approved.status, 200);
}

describe('student review overview and campus post moderation', () => {
  before(async () => {
    const app = createApp({ db: openDatabase(':memory:') });
    server = createServer(app.handler);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    await req('/api/auth/register', { method: 'POST', body: { username: '社区学生甲', password: 'pass123' } });
    await req('/api/auth/register', { method: 'POST', body: { username: '社区学生乙', password: 'pass123' } });
    studentToken = await login('社区学生甲', 'pass123');
    otherToken = await login('社区学生乙', 'pass123');
    adminToken = await login('admin', 'admin123');
    const bootstrap = await req('/api/bootstrap');
    dishId = bootstrap.data.dishes[0].id;
    const stall = bootstrap.data.stalls.find((item) => item.id === bootstrap.data.dishes[0].stallId);
    stallId = stall.id;
    canteenId = stall.canteenId;
  });

  after(() => server.close());

  it('lists approved reviews with enriched metadata and supports filters and sorting', async () => {
    const firstContent = '聚合评价五星测试';
    const secondContent = '聚合评价二星测试';
    await req('/api/reviews', { method: 'POST', token: studentToken, body: { targetType: 'dish', targetId: dishId, rating: 5, content: firstContent } });
    await req('/api/reviews', { method: 'POST', token: studentToken, body: { targetType: 'dish', targetId: dishId, rating: 2, content: secondContent } });
    const moderation = await req(`/api/admin/reviews?targetType=dish&canteenId=${encodeURIComponent(canteenId)}&stallId=${encodeURIComponent(stallId)}&dishId=${encodeURIComponent(dishId)}`, { token: adminToken });
    assert.equal(moderation.status, 200);
    assert.ok(moderation.data.reviews.some((item) => item.content === firstContent));
    assert.equal(moderation.data.reviews[0].dish.id, dishId);
    assert.equal(moderation.data.reviews[0].stall.id, stallId);
    assert.equal(moderation.data.reviews[0].canteen.id, canteenId);
    assert.ok(moderation.data.reviews[0].author.id);
    await approveReviewByContent(firstContent);
    await approveReviewByContent(secondContent);

    const response = await req(`/api/reviews?targetType=dish&canteenId=${encodeURIComponent(canteenId)}&dishId=${encodeURIComponent(dishId)}&sort=rating_desc`, { token: studentToken });
    assert.equal(response.status, 200);
    const created = response.data.reviews.filter((item) => [firstContent, secondContent].includes(item.content));
    assert.deepEqual(created.map((item) => item.rating), [5, 2]);
    assert.equal(created[0].dish.id, dishId);
    assert.ok(created[0].stall?.id);
    assert.equal(created[0].canteen.id, canteenId);
    assert.ok(response.data.summary.averageRating > 0);

    const keyword = await req(`/api/reviews?q=${encodeURIComponent('五星测试')}`, { token: studentToken });
    assert.equal(keyword.status, 200);
    assert.ok(keyword.data.reviews.length >= 1);
    assert.ok(keyword.data.reviews.every((item) => item.content.includes('五星测试')));
  });

  it('keeps a pending post private except for its author', async () => {
    const created = await req('/api/posts', {
      method: 'POST', token: studentToken,
      body: { targetType: 'dish', targetId: dishId, content: '社区帖子待审核可见性测试', rating: 4 }
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.post.status, 'pending');
    assert.equal(created.data.post.isOwn, true);

    const mine = await req('/api/posts', { token: studentToken });
    assert.ok(mine.data.posts.some((post) => post.id === created.data.post.id && post.status === 'pending'));
    const keyword = await req(`/api/posts?q=${encodeURIComponent('待审核可见性')}`, { token: studentToken });
    assert.ok(keyword.data.posts.some((post) => post.id === created.data.post.id));
    const other = await req('/api/posts', { token: otherToken });
    assert.ok(!other.data.posts.some((post) => post.id === created.data.post.id));
    const moderation = await req(`/api/admin/posts?status=pending&targetType=dish&canteenId=${encodeURIComponent(canteenId)}&stallId=${encodeURIComponent(stallId)}&dishId=${encodeURIComponent(dishId)}`, { token: adminToken });
    assert.ok(moderation.data.posts.some((post) => post.id === created.data.post.id));
  });

  it('syncs an approved rated dish post into one formal review without duplicates', async () => {
    const content = '帖子评分同步正式评价测试';
    const created = await req('/api/posts', {
      method: 'POST', token: studentToken,
      body: { targetType: 'dish', targetId: dishId, content, rating: 5 }
    });
    const postId = created.data.post.id;

    const pending = await req('/api/admin/posts?status=pending', { token: adminToken });
    assert.ok(pending.data.posts.some((post) => post.id === postId));

    const approve = await req(`/api/admin/posts/${postId}/status`, { method: 'PATCH', token: adminToken, body: { status: 'approved' } });
    assert.equal(approve.status, 200);
    assert.ok(approve.data.post.linkedReviewId);
    assert.equal(approve.data.post.linkedReviewStatus, 'approved');
    const audits = await req('/api/admin/audit-logs?limit=100', { token: adminToken });
    const moderationAudit = audits.data.logs.find((entry) => entry.action === 'MODERATE_POST' && entry.entityId === postId);
    assert.deepEqual(moderationAudit.metadata, {
      fromStatus: 'pending',
      toStatus: 'approved',
      linkedReviewId: approve.data.post.linkedReviewId,
      targetType: 'dish',
      targetId: dishId
    });

    const publicFeed = await req('/api/posts', { token: otherToken });
    assert.ok(publicFeed.data.posts.some((post) => post.id === postId && post.status === 'approved'));
    const reviewList = await req(`/api/reviews?targetType=dish&dishId=${dishId}&limit=100`, { token: studentToken });
    assert.equal(reviewList.data.reviews.filter((review) => review.content === content).length, 1);

    const approveAgain = await req(`/api/admin/posts/${postId}/status`, { method: 'PATCH', token: adminToken, body: { status: 'approved' } });
    assert.equal(approveAgain.status, 200);
    const afterRepeat = await req(`/api/reviews?targetType=dish&dishId=${dishId}&limit=100`, { token: studentToken });
    assert.equal(afterRepeat.data.reviews.filter((review) => review.content === content).length, 1);

    await req(`/api/admin/posts/${postId}/status`, { method: 'PATCH', token: adminToken, body: { status: 'rejected' } });
    const afterReject = await req(`/api/reviews?targetType=dish&dishId=${dishId}&limit=100`, { token: studentToken });
    assert.equal(afterReject.data.reviews.filter((review) => review.content === content).length, 0);

    await req(`/api/admin/posts/${postId}/status`, { method: 'PATCH', token: adminToken, body: { status: 'approved' } });
    const afterReapprove = await req(`/api/reviews?targetType=dish&dishId=${dishId}&limit=100`, { token: studentToken });
    assert.equal(afterReapprove.data.reviews.filter((review) => review.content === content).length, 1);
  });

  it('rejects ratings on canteen posts and protects moderation endpoints', async () => {
    const invalid = await req('/api/posts', { method: 'POST', token: studentToken, body: { targetType: 'canteen', targetId: canteenId, content: '食堂帖子不能附带菜品评分', rating: 5 } });
    assert.equal(invalid.status, 400);
    const forbidden = await req('/api/admin/posts', { token: studentToken });
    assert.equal(forbidden.status, 403);
    const anonymousReviews = await req('/api/reviews');
    assert.equal(anonymousReviews.status, 401);
  });
});
