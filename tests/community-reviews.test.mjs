import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { completePublicProfile } from './community-test-helpers.mjs';

let server;
let baseUrl;
let db;
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

describe('student review overview and campus post moderation', () => {
  before(async () => {
    db = openDatabase(':memory:');
    const app = createApp({ db });
    server = createServer(app.handler);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    await req('/api/auth/register', { method: 'POST', body: { username: '社区学生甲', password: 'pass123' } });
    await req('/api/auth/register', { method: 'POST', body: { username: '社区学生乙', password: 'pass123' } });
    studentToken = await login('社区学生甲', 'pass123');
    otherToken = await login('社区学生乙', 'pass123');
    adminToken = await login('admin', 'admin123');
    await completePublicProfile(req, studentToken, 'Community Student A');
    await completePublicProfile(req, otherToken, 'Community Student B');
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
    const moderation = await req(`/api/admin/reviews?status=all&targetType=dish&canteenId=${encodeURIComponent(canteenId)}&stallId=${encodeURIComponent(stallId)}&dishId=${encodeURIComponent(dishId)}`, { token: adminToken });
    assert.equal(moderation.status, 200);
    assert.ok(moderation.data.reviews.some((item) => item.content === firstContent));
    assert.equal(moderation.data.reviews[0].dish.id, dishId);
    assert.equal(moderation.data.reviews[0].stall.id, stallId);
    assert.equal(moderation.data.reviews[0].canteen.id, canteenId);
    assert.ok(moderation.data.reviews[0].author.id);
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

  it('publishes a valid post immediately after automatic moderation', async () => {
    const created = await req('/api/posts', {
      method: 'POST', token: studentToken,
      body: { targetType: 'dish', targetId: dishId, content: '社区帖子待审核可见性测试', rating: 4 }
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.post.status, 'approved');
    assert.equal(created.data.post.isOwn, true);

    const mine = await req('/api/posts', { token: studentToken });
    assert.ok(mine.data.posts.some((post) => post.id === created.data.post.id && post.status === 'approved'));
    const keyword = await req(`/api/posts?q=${encodeURIComponent('待审核可见性')}`, { token: studentToken });
    assert.ok(keyword.data.posts.some((post) => post.id === created.data.post.id));
    const other = await req('/api/posts', { token: otherToken });
    assert.ok(other.data.posts.some((post) => post.id === created.data.post.id));
    const moderation = await req(`/api/admin/posts?status=approved&targetType=dish&canteenId=${encodeURIComponent(canteenId)}&stallId=${encodeURIComponent(stallId)}&dishId=${encodeURIComponent(dishId)}`, { token: adminToken });
    assert.ok(moderation.data.posts.some((post) => post.id === created.data.post.id));
  });

  it('syncs an approved rated dish post into one formal review without duplicates', async () => {
    const content = '帖子评分同步正式评价测试';
    const created = await req('/api/posts', {
      method: 'POST', token: studentToken,
      body: { targetType: 'dish', targetId: dishId, content, rating: 5 }
    });
    const postId = created.data.post.id;

    assert.equal(created.data.post.status, 'approved');
    assert.ok(created.data.post.linkedReviewId);

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

  it('supports reactions, comments, reports and owner management without bypassing moderation', async () => {
    const created = await req('/api/posts', { method: 'POST', token: studentToken, body: { targetType: 'dish', targetId: dishId, content: '社区互动完整流程测试', rating: 4 } });
    const postId = created.data.post.id;
    const approved = await req(`/api/admin/posts/${postId}/status`, { method: 'PATCH', token: adminToken, body: { status: 'approved' } });
    assert.equal(approved.status, 200);

    const like = await req(`/api/posts/${postId}/reaction`, { method: 'PUT', token: studentToken, body: { reaction: 'like' } });
    assert.equal(like.data.engagement.likes, 1);
    const switchReaction = await req(`/api/posts/${postId}/reaction`, { method: 'PUT', token: studentToken, body: { reaction: 'dislike' } });
    assert.deepEqual(switchReaction.data.engagement, { likes: 0, dislikes: 1, comments: 0 });
    const clearReaction = await req(`/api/posts/${postId}/reaction`, { method: 'PUT', token: studentToken, body: { reaction: null } });
    assert.equal(clearReaction.data.viewerReaction, null);

    const comment = await req(`/api/posts/${postId}/comments`, { method: 'POST', token: otherToken, body: { content: '这条评论可以正常发布' } });
    assert.equal(comment.status, 201);
    const comments = await req(`/api/posts/${postId}/comments`, { token: studentToken });
    assert.ok(comments.data.comments.some((item) => item.id === comment.data.comment.id));

    const forbiddenCommentEdit = await req(`/api/posts/${postId}/comments/${comment.data.comment.id}`, { method: 'PATCH', token: studentToken, body: { content: '不能修改别人的评论' } });
    assert.equal(forbiddenCommentEdit.status, 403);
    const editedComment = await req(`/api/posts/${postId}/comments/${comment.data.comment.id}`, { method: 'PATCH', token: otherToken, body: { content: '评论修改后仍然有效' } });
    assert.equal(editedComment.status, 200);
    assert.equal(editedComment.data.comment.status, editedComment.data.moderation.status);

    const commentReport = await req(`/api/posts/${postId}/comments/${comment.data.comment.id}/report`, { method: 'POST', token: studentToken, body: { reason: 'inappropriate' } });
    assert.equal(commentReport.status, 200);
    const forbiddenReportQueue = await req('/api/admin/community/reports', { token: otherToken });
    assert.equal(forbiddenReportQueue.status, 403);
    const otherTenantReporter = db.prepare("SELECT id FROM users WHERE username = '社区学生乙'").get();
    await db.prepare(`INSERT INTO content_reports (id, tenant_id, reporter_id, target_type, target_id, reason, detail, status, created_at, updated_at)
      VALUES ('other-tenant-report', 'other-tenant', ?, 'comment', 'other-comment', 'other', '', 'pending', datetime('now'), datetime('now'))`).run(otherTenantReporter.id);
    const reportQueue = await req('/api/admin/community/reports?targetType=comment', { token: adminToken });
    const queuedReport = reportQueue.data.reports.find((item) => item.targetId === comment.data.comment.id);
    assert.ok(queuedReport);
    assert.ok(!reportQueue.data.reports.some((item) => item.id === 'other-tenant-report'));
    const resolveReport = await req(`/api/admin/community/reports/${queuedReport.id}`, { method: 'PATCH', token: adminToken, body: { status: 'resolved' } });
    assert.equal(resolveReport.status, 200);

    const report = await req(`/api/posts/${postId}/report`, { method: 'POST', token: otherToken, body: { reason: 'inappropriate' } });
    const repeatedReport = await req(`/api/posts/${postId}/report`, { method: 'POST', token: otherToken, body: { reason: 'inappropriate' } });
    assert.equal(report.status, 200);
    assert.equal(repeatedReport.status, 200);

    const forbiddenEdit = await req(`/api/posts/${postId}`, { method: 'PATCH', token: otherToken, body: { content: '不能修改别人的帖子' } });
    assert.equal(forbiddenEdit.status, 403);
    const edit = await req(`/api/posts/${postId}`, { method: 'PATCH', token: studentToken, body: { content: '帖子修改后重新进入审核', rating: 5 } });
    assert.equal(edit.status, 200);
    assert.equal(edit.data.post.status, 'approved');
    const commentsAfterEdit = await req(`/api/posts/${postId}/comments`, { token: otherToken });
    assert.equal(commentsAfterEdit.status, 200);

    const archive = await req(`/api/posts/${postId}/archive`, { method: 'POST', token: studentToken });
    assert.equal(archive.status, 200);
    assert.equal(archive.data.status, 'archived');
    const restore = await req(`/api/posts/${postId}/restore`, { method: 'POST', token: studentToken });
    assert.equal(restore.status, 200);
    assert.notEqual(restore.data.status, 'archived');

    const deleteComment = await req(`/api/posts/${postId}/comments/${comment.data.comment.id}`, { method: 'DELETE', token: otherToken });
    assert.equal(deleteComment.status, 200);

    const deletion = await req(`/api/posts/${postId}`, { method: 'DELETE', token: studentToken });
    assert.equal(deletion.status, 200);
    const afterDelete = await req('/api/posts', { token: studentToken });
    assert.ok(!afterDelete.data.posts.some((item) => item.id === postId));
  });

  it('allows owners to edit and delete direct reviews while other users are blocked', async () => {
    const content = '独立评价作者管理测试';
    const created = await req('/api/reviews', { method: 'POST', token: studentToken, body: { targetType: 'dish', targetId: dishId, rating: 4, content } });
    assert.equal(created.status, 201);
    const mine = await req('/api/reviews?includeMine=true', { token: studentToken });
    const review = mine.data.reviews.find((item) => item.content === content);
    assert.ok(review?.canEdit && review?.canDelete);
    const forbidden = await req(`/api/reviews/${review.id}`, { method: 'PATCH', token: otherToken, body: { content: '越权修改', rating: 1 } });
    assert.equal(forbidden.status, 403);
    const edited = await req(`/api/reviews/${review.id}`, { method: 'PATCH', token: studentToken, body: { content: '评价修改后待审核', rating: 3 } });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.review.status, edited.data.moderation.status);
    const deleted = await req(`/api/reviews/${review.id}`, { method: 'DELETE', token: studentToken });
    assert.equal(deleted.status, 200);
  });
});
