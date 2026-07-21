<template>
  <section class="page-heading">
    <p class="eyebrow">{{ pageMeta.eyebrow }}</p>
    <h1>{{ pageMeta.title }}</h1>
    <p>{{ pageMeta.description }}</p>
  </section>

  <section v-if="!isAdmin" class="card empty-state">
    <h2>需要管理员身份</h2>
    <p>请在左侧身份卡选择"管理员"并登录。</p>
  </section>

  <!--
       MANAGE PAGE (/admin) — 评价管理 + 数据管理
       ═══════════════════════════════════════════════════════════════ -->

  <template v-if="isAdmin && activePanel === 'reviews'">
    <section class="card admin-form moderation-workspace">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Content Moderation</p>
          <h2>内容审核</h2>
          <p class="muted moderation-subtitle">评价与帖子审核统一处理，默认优先展示最新待审核内容。</p>
        </div>
        <div class="moderation-tabs" role="tablist" aria-label="内容审核类型">
          <button type="button" role="tab" :aria-selected="moderationTab === 'reviews'" :class="{ active: moderationTab === 'reviews' }" @click="selectModerationTab('reviews')">评价审核</button>
          <button type="button" role="tab" :aria-selected="moderationTab === 'posts'" :class="{ active: moderationTab === 'posts' }" @click="selectModerationTab('posts')">帖子审核</button>
        </div>
      </div>

      <template v-if="moderationTab === 'reviews'">
        <div v-if="!canModerateReviews" class="moderation-empty">
          <strong>当前角色无评价审核权限</strong>
          <span>需要 review:moderate 权限才能查看和处理评价。</span>
        </div>
        <template v-else>
          <div class="moderation-filters review-filters">
            <label>审核状态
              <select v-model="reviewStatusFilter" @change="reloadReviewsFromFirstPage">
                <option value="pending">待审核</option>
                <option value="approved">已通过</option>
                <option value="rejected">已驳回</option>
                <option value="all">全部状态</option>
              </select>
            </label>
            <label>评价类型
              <select v-model="reviewTypeFilter" @change="resetReviewTargetFilters">
                <option value="">全部类型</option>
                <option value="dish">菜品评价</option>
                <option value="canteen">食堂评价</option>
              </select>
            </label>
            <label>食堂
              <select v-model="reviewCanteenFilter" @change="handleReviewCanteenChange">
                <option value="">全部食堂</option>
                <option v-for="canteen in reviewFilterCanteens" :key="canteen.id" :value="canteen.id">{{ canteen.name }}</option>
              </select>
            </label>
            <label :class="{ disabled: reviewTypeFilter === 'canteen' }">档口
              <select v-model="reviewStallFilter" :disabled="reviewTypeFilter === 'canteen'" @change="handleReviewStallChange">
                <option value="">全部档口</option>
                <option v-for="stall in reviewFilterStalls" :key="stall.id" :value="stall.id">{{ stall.name }}</option>
              </select>
            </label>
            <label :class="{ disabled: reviewTypeFilter === 'canteen' }">菜品
              <select v-model="reviewDishFilter" :disabled="reviewTypeFilter === 'canteen'" @change="reloadReviewsFromFirstPage">
                <option value="">全部菜品</option>
                <option v-for="dish in reviewFilterDishes" :key="dish.id" :value="dish.id">{{ dish.name }}</option>
              </select>
            </label>
            <button class="ghost moderation-refresh" type="button" :disabled="reviewLoading" @click="refreshReviews">{{ reviewLoading ? '加载中...' : '刷新' }}</button>
          </div>

          <div class="moderation-summary">
            <span>当前页 {{ filteredAdminReviews.length }} 条</span>
            <span>共 {{ store.adminReviewTotal }} 条{{ reviewStatusFilter ? statusLabel(reviewStatusFilter) : '评价' }}</span>
          </div>
          <div v-if="reviewLoading && !store.adminReviews.length" class="moderation-empty">正在加载评价...</div>
          <div v-else-if="!filteredAdminReviews.length" class="moderation-empty">
            <strong>没有符合条件的评价</strong>
            <span>可以调整筛选条件或刷新数据。</span>
          </div>
          <div v-else class="table-wrap moderation-table">
            <table>
              <thead><tr><th>时间 / 作者</th><th>评价对象</th><th>评分</th><th>内容</th><th>状态</th><th>审核操作</th></tr></thead>
              <tbody>
                <tr v-for="review in filteredAdminReviews" :key="review.id">
                  <td data-label="时间 / 作者"><strong>{{ formatDateTime(review.createdAt) }}</strong><br /><span class="muted">{{ review.user || '匿名用户' }}</span></td>
                  <td data-label="评价对象"><span class="target-type">{{ review.targetType === 'canteen' ? '食堂评价' : '菜品评价' }}</span><strong class="target-name">{{ reviewTargetName(review) }}</strong><span class="target-path">{{ reviewTargetPath(review) }}</span></td>
                  <td data-label="评分"><span class="rating-pill">{{ review.rating }} / 5</span></td>
                  <td class="moderation-content" data-label="评价内容">{{ review.content }}</td>
                  <td data-label="状态"><span :class="['status-pill', `status-${review.status}`]">{{ statusLabel(review.status) }}</span></td>
                  <td data-label="审核操作">
                    <div class="table-actions moderation-actions">
                      <button v-if="review.status !== 'approved'" class="ghost" type="button" :disabled="isReviewBusy(review.id)" @click="moderateReview(review.id, 'approved')">{{ review.status === 'rejected' ? '改为通过' : '通过' }}</button>
                      <button v-if="review.status !== 'rejected'" class="ghost danger" type="button" :disabled="isReviewBusy(review.id)" @click="moderateReview(review.id, 'rejected')">{{ review.status === 'approved' ? '改为驳回' : '驳回' }}</button>
                      <button v-if="review.status !== 'pending'" class="ghost" type="button" :disabled="isReviewBusy(review.id)" @click="moderateReview(review.id, 'pending')">重新审核</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="pagination" v-if="store.adminReviewTotal > reviewPageSize">
            <button class="ghost" type="button" :disabled="reviewLoading || reviewPage === 0" @click="reviewPage--; refreshReviews()">上一页</button>
            <span>{{ reviewPage + 1 }} / {{ Math.max(1, Math.ceil(store.adminReviewTotal / reviewPageSize)) }}</span>
            <button class="ghost" type="button" :disabled="reviewLoading || (reviewPage + 1) * reviewPageSize >= store.adminReviewTotal" @click="reviewPage++; refreshReviews()">下一页</button>
          </div>
          <p v-if="reviewMessage" :class="['form-message', { danger: reviewMessageType === 'error' }]">{{ reviewMessage }}</p>
        </template>
      </template>

      <template v-else>
        <div v-if="!canModeratePosts" class="moderation-empty">
          <strong>当前角色无帖子审核权限</strong>
          <span>需要 post:moderate 权限才能查看和处理校园帖子。</span>
        </div>
        <template v-else>
          <div class="moderation-filters post-filters">
            <label>审核状态
              <select v-model="postStatusFilter" @change="reloadPostsFromFirstPage">
                <option value="pending">待审核</option>
                <option value="approved">已通过</option>
                <option value="rejected">已驳回</option>
                <option value="all">全部状态</option>
              </select>
            </label>
            <button class="ghost moderation-refresh" type="button" :disabled="postLoading" @click="refreshPosts">{{ postLoading ? '加载中...' : '刷新' }}</button>
          </div>
          <div class="moderation-summary">
            <span>当前页 {{ store.adminPosts.length }} 条</span>
            <span>共 {{ store.adminPostTotal }} 条{{ postStatusFilter ? statusLabel(postStatusFilter) : '帖子' }}</span>
          </div>
          <div v-if="postLoading && !store.adminPosts.length" class="moderation-empty">正在加载帖子...</div>
          <div v-else-if="!store.adminPosts.length" class="moderation-empty">
            <strong>没有符合条件的帖子</strong>
            <span>可以切换审核状态或刷新数据。</span>
          </div>
          <div v-else class="post-moderation-list">
            <article v-for="post in store.adminPosts" :key="post.id" class="post-moderation-row">
              <img v-if="post.imageUrl" class="post-admin-thumb" :src="post.imageUrl" alt="帖子图片" />
              <div v-else class="post-image-placeholder" aria-hidden="true">无图片</div>
              <div class="post-moderation-body">
                <div class="post-moderation-meta">
                  <strong>{{ post.user || '匿名用户' }}</strong>
                  <span>{{ formatDateTime(post.createdAt) }}</span>
                  <span :class="['status-pill', `status-${post.status}`]">{{ statusLabel(post.status) }}</span>
                </div>
                <p>{{ post.content }}</p>
                <div class="post-target-line">
                  <span>{{ post.targetType === 'dish' ? '关联菜品' : '关联食堂' }}：{{ postTargetLabel(post) }}</span>
                  <span v-if="post.rating" class="rating-pill">{{ post.rating }} / 5</span>
                  <span v-if="post.linkedReviewId" class="linked-review">关联评价：{{ statusLabel(post.linkedReviewStatus || 'pending') }}</span>
                </div>
              </div>
              <div class="post-moderation-actions">
                <button v-if="post.status !== 'approved'" class="ghost" type="button" :disabled="isPostBusy(post.id)" @click="moderatePost(post.id, 'approved')">{{ post.status === 'rejected' ? '重新通过' : '通过' }}</button>
                <button v-if="post.status !== 'rejected'" class="ghost danger" type="button" :disabled="isPostBusy(post.id)" @click="moderatePost(post.id, 'rejected')">{{ post.status === 'approved' ? '改为驳回' : '驳回' }}</button>
                <button v-if="post.status !== 'pending'" class="ghost" type="button" :disabled="isPostBusy(post.id)" @click="moderatePost(post.id, 'pending')">重新审核</button>
              </div>
            </article>
          </div>
          <div class="pagination" v-if="store.adminPostTotal > postPageSize">
            <button class="ghost" type="button" :disabled="postLoading || postPage === 0" @click="postPage--; refreshPosts()">上一页</button>
            <span>{{ postPage + 1 }} / {{ Math.max(1, Math.ceil(store.adminPostTotal / postPageSize)) }}</span>
            <button class="ghost" type="button" :disabled="postLoading || (postPage + 1) * postPageSize >= store.adminPostTotal" @click="postPage++; refreshPosts()">下一页</button>
          </div>
          <p v-if="postMessage" :class="['form-message', { danger: postMessageType === 'error' }]">{{ postMessage }}</p>
        </template>
      </template>
    </section>
  </template>

  <template v-if="isAdmin && activePanel === 'data'">
    <section class="card admin-form data-overview-bar">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Four Dining Areas</p>
          <h2>四区数据管理</h2>
          <p class="muted">固定按中央、北苑、南湖、东苑四个餐饮区展示，层级为食堂 → 一级档口 → 子档口 → 菜品。</p>
        </div>
        <div class="summary-bar compact-summary">
          <div class="summary-item"><strong>{{ store.canteens.length }}</strong><span>食堂</span></div>
          <div class="summary-item"><strong>{{ store.stalls.length }}</strong><span>档口</span></div>
          <div class="summary-item"><strong>{{ store.dishes.length }}</strong><span>菜品</span></div>
          <div class="summary-item"><strong>{{ databaseOverview?.driver || '—' }}</strong><span>数据库</span></div>
        </div>
      </div>
    </section>

    <div class="region-management-grid">
      <section v-for="regionCard in regionCards" :key="regionCard.id" class="card region-management-card">
        <div class="region-card-heading">
          <div>
            <p class="region-position">{{ regionCard.positionLabel }}</p>
            <h2>{{ regionCard.name }}</h2>
            <p>{{ regionCard.region?.location || '尚未建立该固定餐饮区的数据' }}</p>
          </div>
          <button v-if="canWriteCanteens" class="region-add-button" type="button" title="在该餐饮区新增食堂" :aria-label="`在${regionCard.name}新增食堂`" @click="openEntry({ task: 'canteen', parentId: regionCard.id })">+</button>
        </div>

        <div class="region-stats" aria-label="区域数据统计">
          <span><strong>{{ regionCard.canteenCount }}</strong> 食堂</span>
          <span><strong>{{ regionCard.stallCount }}</strong> 档口</span>
          <span><strong>{{ regionCard.dishCount }}</strong> 菜品</span>
        </div>

        <label class="region-search">
          <span class="sr-only">搜索{{ regionCard.name }}数据</span>
          <input v-model.trim="regionSearch[regionCard.id]" type="search" :placeholder="`搜索${regionCard.name}的食堂、档口或菜品`" />
        </label>

        <div v-if="!regionCard.region" class="region-empty-state">
          <strong>固定区域数据缺失</strong>
          <span>不会使用其他食堂补位。</span>
        </div>
        <div v-else-if="!regionCard.canteens.length" class="region-empty-state">
          <strong>{{ regionSearch[regionCard.id] ? '未找到匹配数据' : '暂无下属食堂' }}</strong>
          <span>{{ regionSearch[regionCard.id] ? '请尝试其他关键词。' : '可从右上角新增该区域的食堂。' }}</span>
        </div>
        <div v-else class="region-hierarchy">
          <section v-for="canteenNode in regionCard.canteens" :key="canteenNode.canteen.id" class="hierarchy-canteen">
            <div class="hierarchy-row canteen-hierarchy-row">
              <button class="hierarchy-main" type="button" @click="toggleCanteen(canteenNode.canteen.id)">
                <span :class="['tree-caret', { open: isCanteenOpen(regionCard.id, canteenNode.canteen.id) }]">▶</span>
                <span class="hierarchy-copy"><strong>{{ canteenNode.canteen.name }}</strong><small>{{ canteenNode.canteen.location }}</small></span>
                <span class="hierarchy-count">{{ canteenNode.primaryStallCount }} 一级档口 · {{ canteenNode.dishCount }} 菜品</span>
              </button>
              <div class="hierarchy-actions">
                <button v-if="canWriteCanteens" type="button" title="编辑食堂" @click="openEntry({ task: 'canteen', editId: canteenNode.canteen.id })">编辑</button>
                <button v-if="canWriteStalls" type="button" title="新增一级档口" @click="openEntry({ task: 'stall', canteenId: canteenNode.canteen.id })">+ 档口</button>
              </div>
            </div>

            <div v-if="isCanteenOpen(regionCard.id, canteenNode.canteen.id)" class="hierarchy-children">
              <div v-if="!canteenNode.stalls.length" class="tree-empty">暂无一级档口</div>
              <section v-for="stallNode in canteenNode.stalls" :key="stallNode.stall.id" class="hierarchy-stall">
                <div class="hierarchy-row stall-hierarchy-row">
                  <button class="hierarchy-main" type="button" @click="toggleStall(stallNode.stall.id)">
                    <span :class="['tree-caret', { open: isStallOpen(regionCard.id, stallNode.stall.id) }]">▶</span>
                    <span class="level-badge">一级档口</span>
                    <span class="hierarchy-copy"><strong>{{ stallNode.stall.name }}</strong><small>{{ stallNode.stall.floor }} · {{ stallNode.stall.category }}</small></span>
                    <span class="hierarchy-count">{{ stallNode.childCount }} 子档口 · {{ stallNode.dishCount }} 菜品</span>
                  </button>
                  <div class="hierarchy-actions">
                    <button v-if="canWriteStalls" type="button" title="编辑一级档口" @click="openEntry({ task: 'stall', canteenId: canteenNode.canteen.id, editId: stallNode.stall.id })">编辑</button>
                    <button v-if="canWriteStalls" type="button" title="新增子档口" @click="openEntry({ task: 'sub-stall', canteenId: canteenNode.canteen.id, parentId: stallNode.stall.id })">+ 子档口</button>
                    <button v-if="canWriteDishes" type="button" title="新增直属菜品" @click="openEntry({ task: 'dish', canteenId: canteenNode.canteen.id, stallId: stallNode.stall.id })">+ 菜品</button>
                  </div>
                </div>

                <div v-if="isStallOpen(regionCard.id, stallNode.stall.id)" class="stall-contents">
                  <div v-if="stallNode.directDishes.length" class="direct-dishes">
                    <p class="hierarchy-group-label">直属菜品</p>
                    <div v-for="dish in stallNode.directDishes" :key="dish.id" class="dish-hierarchy-row">
                      <span class="dish-name">{{ dish.name }}</span>
                      <span>{{ dish.taste || '未设置口味' }}</span>
                      <strong>¥{{ dish.price }}</strong>
                      <button v-if="canWriteDishes" type="button" @click="openEntry({ task: 'dish', canteenId: canteenNode.canteen.id, stallId: stallNode.stall.id, editId: dish.id })">编辑</button>
                    </div>
                  </div>

                  <div v-if="stallNode.children.length" class="child-stalls">
                    <p class="hierarchy-group-label">子档口</p>
                    <section v-for="childNode in stallNode.children" :key="childNode.stall.id" class="child-stall-node">
                      <div class="hierarchy-row child-stall-row">
                        <button class="hierarchy-main" type="button" @click="toggleStall(childNode.stall.id)">
                          <span :class="['tree-caret', { open: isStallOpen(regionCard.id, childNode.stall.id) }]">▶</span>
                          <span class="level-badge child">子档口</span>
                          <span class="hierarchy-copy"><strong>{{ childNode.stall.name }}</strong><small>{{ childNode.stall.floor }} · {{ childNode.stall.category }}</small></span>
                          <span class="hierarchy-count">{{ childNode.dishes.length }} 菜品</span>
                        </button>
                        <div class="hierarchy-actions">
                          <button v-if="canWriteStalls" type="button" title="编辑子档口" @click="openEntry({ task: 'sub-stall', canteenId: canteenNode.canteen.id, parentId: stallNode.stall.id, editId: childNode.stall.id })">编辑</button>
                          <button v-if="canWriteDishes" type="button" title="新增菜品" @click="openEntry({ task: 'dish', canteenId: canteenNode.canteen.id, stallId: childNode.stall.id })">+ 菜品</button>
                        </div>
                      </div>
                      <div v-if="isStallOpen(regionCard.id, childNode.stall.id)" class="child-dishes">
                        <div v-if="!childNode.dishes.length" class="tree-empty">暂无菜品</div>
                        <div v-for="dish in childNode.dishes" :key="dish.id" class="dish-hierarchy-row">
                          <span class="dish-name">{{ dish.name }}</span>
                          <span>{{ dish.taste || '未设置口味' }}</span>
                          <strong>¥{{ dish.price }}</strong>
                          <button v-if="canWriteDishes" type="button" @click="openEntry({ task: 'dish', canteenId: canteenNode.canteen.id, stallId: childNode.stall.id, editId: dish.id })">编辑</button>
                        </div>
                      </div>
                    </section>
                  </div>
                  <div v-if="!stallNode.directDishes.length && !stallNode.children.length" class="tree-empty">暂无子档口或直属菜品</div>
                </div>
              </section>
            </div>
          </section>
        </div>
      </section>
    </div>
  </template>




  <!-- ═══════════════════════════════════════════════════════════════
       ENTRY PAGE (/admin/input) — 数据录入与维护
       ═══════════════════════════════════════════════════════════════ -->

  <template v-if="isAdmin && isEntryPage">
    <section class="card admin-form entry-workspace-header">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Focused Entry</p>
          <h2>分段数据录入</h2>
          <p class="muted">一次只处理一种数据，保存后保留当前餐饮区、食堂和档口上下文。</p>
        </div>
        <div class="entry-task-tabs" role="tablist" aria-label="数据录入类型">
          <button v-for="task in entryTasks" :key="task.id" type="button" :class="{ active: entryMode === task.id }" @click="setEntryMode(task.id)">{{ task.label }}</button>
        </div>
      </div>
      <div v-if="!entryTasks.length" class="moderation-empty">
        <strong>当前角色无数据录入权限</strong>
        <span>请联系管理员分配食堂、档口或菜品写入权限。</span>
      </div>
      <div v-else-if="entryMode !== 'import'" class="entry-context-grid">
        <label>餐饮区
          <select v-model="entryContext.regionId" @change="handleEntryRegionChange">
            <option value="">请选择餐饮区</option>
            <option v-for="region in fixedRegions" :key="region.id" :value="region.id">{{ region.name }}</option>
          </select>
        </label>
        <label :class="{ disabled: entryMode === 'canteen' }">食堂
          <select v-model="entryContext.canteenId" :disabled="entryMode === 'canteen'" @change="handleEntryCanteenChange">
            <option value="">请选择食堂</option>
            <option v-for="canteen in entryCanteens" :key="canteen.id" :value="canteen.id">{{ canteen.name }}</option>
          </select>
        </label>
        <label :class="{ disabled: !['sub-stall', 'dish'].includes(entryMode) }">一级档口
          <select v-model="entryContext.primaryStallId" :disabled="!['sub-stall', 'dish'].includes(entryMode)" @change="handleEntryPrimaryStallChange">
            <option value="">请选择一级档口</option>
            <option v-for="stall in entryPrimaryStalls" :key="stall.id" :value="stall.id">{{ stall.name }}</option>
          </select>
        </label>
        <label :class="{ disabled: entryMode !== 'dish' }">子档口（可选）
          <select v-model="entryContext.childStallId" :disabled="entryMode !== 'dish'" @change="handleEntryChildStallChange">
            <option value="">直属一级档口</option>
            <option v-for="stall in entryChildStalls" :key="stall.id" :value="stall.id">{{ stall.name }}</option>
          </select>
        </label>
      </div>
    </section>

    <!-- 食堂与档口 CRUD -->
    <section v-if="['canteen', 'stall', 'sub-stall'].includes(entryMode)" class="entry-task-section">
      <form v-if="entryMode === 'canteen'" class="card admin-form" @submit.prevent="saveCanteen('stay')">
        <div class="section-title horizontal">
          <div>
            <p class="eyebrow">Canteen</p>
            <h2>{{ canteenForm.id ? '编辑食堂' : '新增食堂' }}</h2>
          </div>
          <button v-if="canteenForm.id" class="ghost" type="button" @click="resetCanteenForm">取消编辑</button>
        </div>
        <label>名称<input v-model="canteenForm.name" required /></label>
        <label>食堂类型<select v-model="canteenForm.canteenType" required><option value="primary">一级食堂（主食堂）</option><option value="sub">下属食堂（子食堂）</option></select></label>
        <label v-if="canteenForm.canteenType === 'sub'">上级食堂<select v-model="canteenForm.parentId" :required="canteenForm.canteenType === 'sub'"><option value="">请选择上级食堂</option><option v-for="c in primaryCanteens" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
        <label>位置<input v-model="canteenForm.location" required /></label>
        <label>营业时间<input v-model="canteenForm.hours" placeholder="07:00 - 21:00" required /></label>
        <label>图片 URL<input v-model="canteenForm.imageUrl" placeholder="https://... 或上传后自动填充" /></label>
        <label>标签<input v-model="canteenForm.tags" placeholder="低脂, 夜宵" /></label>
        <label>简介<textarea v-model="canteenForm.description" required /></label>
        <label>拥挤度 (0-100)<input v-model.number="canteenForm.crowdLevel" type="number" min="0" max="100" /></label>
        <div v-if="canteenForm.imageUrl" class="vision-preview" style="max-width:12.5rem;margin-bottom:0.5rem;"><img :src="canteenForm.imageUrl" :alt="canteenForm.name || '食堂图片'" /></div>
        <div class="entry-save-actions">
          <button class="primary" type="submit" :disabled="entrySaving">{{ entrySaving ? '保存中...' : '保存' }}</button>
          <button class="secondary" type="button" :disabled="entrySaving" @click="saveCanteen('continue')">保存并继续新增</button>
          <button class="ghost" type="button" :disabled="entrySaving" @click="saveCanteen('return')">保存后返回数据管理</button>
        </div>
        <p v-if="message" class="form-message">{{ message }}</p>
      </form>

      <form v-else class="card admin-form" @submit.prevent="saveStall('stay')">
        <div class="section-title horizontal">
          <div>
            <p class="eyebrow">Stall CRUD</p>
            <h2>{{ stallForm.id ? '编辑档口' : entryMode === 'sub-stall' ? '新增子档口' : '新增一级档口' }}</h2>
          </div>
          <button v-if="stallForm.id" class="ghost" type="button" @click="resetStallForm">取消编辑</button>
        </div>
        <label>所属食堂<select v-model="entryContext.canteenId" required @change="handleEntryCanteenChange"><option value="">请选择食堂</option><option v-for="c in entryCanteens" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
        <label v-if="entryMode === 'sub-stall'">上级一级档口<select v-model="stallForm.parentId" required><option value="">请选择一级档口</option><option v-for="stall in entryPrimaryStalls" :key="stall.id" :value="stall.id">{{ stall.name }}</option></select></label>
        <label>名称<input v-model="stallForm.name" required /></label>
        <label>楼层<input v-model="stallForm.floor" placeholder="1F" required /></label>
        <label>品类<input v-model="stallForm.category" placeholder="健康轻食" required /></label>
        <label>评分<input v-model.number="stallForm.rating" type="number" min="1" max="5" step="0.1" /></label>
        <label>均价<input v-model.number="stallForm.avgPrice" type="number" min="1" /></label>
        <label>描述<textarea v-model="stallForm.description" /></label>
        <label class="check-label"><input v-model="stallForm.open" type="checkbox" /> 营业中</label>
        <div class="entry-save-actions">
          <button class="primary" type="submit" :disabled="entrySaving">{{ entrySaving ? '保存中...' : '保存' }}</button>
          <button class="secondary" type="button" :disabled="entrySaving" @click="saveStall('continue')">保存并继续新增</button>
          <button class="ghost" type="button" :disabled="entrySaving" @click="saveStall('return')">保存后返回数据管理</button>
        </div>
        <p v-if="message" class="form-message">{{ message }}</p>
        <div v-if="stallForm.id && canDeleteStalls" class="destructive-entry-action">
          <div>
            <strong>删除当前档口</strong>
            <span>仅叶子档口可删除；操作前会明确提示关联菜品范围。</span>
          </div>
          <button class="ghost danger" type="button" :disabled="entrySaving" @click="removeStall(stallForm.id)">删除档口</button>
        </div>
      </form>
    </section>

    <!-- 菜品 CRUD + 扩展营养 + 图片识别 -->
    <section v-if="entryMode === 'dish'" class="entry-task-section">
      <form class="card admin-form entry-dish-form" @submit.prevent="saveDish('stay')">
        <div class="section-title horizontal">
          <div>
            <p class="eyebrow">Dish Workspace</p>
            <h2>{{ dishForm.id ? '编辑菜品' : '新增菜品' }}</h2>
          </div>
          <button v-if="dishForm.id" class="ghost" type="button" @click="resetDishForm">取消编辑</button>
        </div>

        <fieldset class="entry-field-group">
          <legend>基础信息</legend>
          <div class="form-grid">
            <label>所属档口
              <select v-model="dishForm.stallId" required @change="syncDishEntryContext">
                <option value="">请选择档口</option>
                <option v-for="stall in entryDishStalls" :key="stall.id" :value="stall.id">{{ stall.parentId ? `子档口 · ${stall.name}` : `一级档口 · ${stall.name}` }}</option>
              </select>
            </label>
            <label>菜名<input v-model="dishForm.name" required /></label>
            <label>价格<input v-model.number="dishForm.price" type="number" min="1" required /></label>
            <label>口味<input v-model="dishForm.taste" required /></label>
            <label>菜系<input v-model="dishForm.cuisine" required /></label>
          </div>
          <label>食材<input v-model="dishForm.ingredients" placeholder="鸡胸肉, 西兰花" required /></label>
          <label>标签<input v-model="dishForm.tags" placeholder="高蛋白, 减脂推荐" required /></label>
        </fieldset>

        <fieldset class="entry-field-group">
          <legend>营养与安全</legend>
          <div class="form-grid nutrition-entry-grid">
            <label>热量 (kcal)<input v-model.number="dishForm.calories" type="number" min="1" required /></label>
            <label>蛋白 (g)<input v-model.number="dishForm.protein" type="number" min="0" required /></label>
            <label>脂肪 (g)<input v-model.number="dishForm.fat" type="number" min="0" required /></label>
            <label>碳水 (g)<input v-model.number="dishForm.carbs" type="number" min="0" required /></label>
          </div>
          <details class="advanced-fields">
            <summary>高级营养与安全字段</summary>
            <div class="form-grid nutrition-entry-grid">
              <label>膳食纤维 (g)<input v-model.number="dishForm.fiber" type="number" min="0" /></label>
              <label>钠 (mg)<input v-model.number="dishForm.sodium" type="number" min="0" /></label>
              <label>糖 (g)<input v-model.number="dishForm.sugar" type="number" min="0" /></label>
              <label>钙 (mg)<input v-model.number="dishForm.calcium" type="number" min="0" /></label>
              <label>铁 (mg)<input v-model.number="dishForm.iron" type="number" min="0" step="0.1" /></label>
              <label>过敏原提示<input v-model="dishForm.allergens" placeholder="花生, 乳制品, 麸质" /></label>
            </div>
            <label class="check-label"><input v-model="dishForm.halal" type="checkbox" /> 清真菜品</label>
          </details>
        </fieldset>

        <fieldset class="entry-field-group">
          <legend>图片与展示</legend>
          <div class="form-grid">
            <label>图片地址<input v-model="dishForm.imageUrl" placeholder="上传后自动填充" /></label>
            <label>上传展示图<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="handleImageFile" /></label>
          </div>
          <div v-if="dishForm.imageUrl" class="vision-preview compact-vision-preview"><img :src="dishForm.imageUrl" :alt="dishForm.name || '菜品图片'" /></div>

          <div class="vision-import-inline">
            <div class="section-title horizontal">
              <div>
                <p class="eyebrow">Vision Import</p>
                <h3>AI 图片识别预填</h3>
              </div>
              <span class="pill">只预填 · 需确认</span>
            </div>
            <label>拍照或上传识别图<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" capture="environment" @change="handleVisionFile" /></label>
            <div v-if="visionPreview" class="vision-preview compact-vision-preview"><img :src="visionPreview" alt="待识别菜品图" /></div>
            <div class="table-actions">
              <button class="secondary" type="button" :disabled="visionLoading || !visionFile" @click="identifyVisionDish">{{ visionLoading ? '识别中...' : 'AI 识别并预填' }}</button>
              <button class="ghost" type="button" :disabled="visionLoading || (!visionFile && !visionSuggestion)" @click="resetVisionImport">清空识别结果</button>
            </div>
            <article v-if="visionSuggestion" class="vision-suggestion">
              <strong>{{ visionSuggestion.name || '未识别菜名' }}</strong>
              <p>{{ visionSuggestion.notes }}</p>
              <div class="nutrition-grid">
                <span>{{ visionSuggestion.nutrition.calories }} kcal</span>
                <span>蛋白 {{ visionSuggestion.nutrition.protein }}g</span>
                <span>脂肪 {{ visionSuggestion.nutrition.fat }}g</span>
                <span>碳水 {{ visionSuggestion.nutrition.carbs }}g</span>
              </div>
              <p class="muted">食材：{{ visionSuggestion.ingredients.join(' / ') }}；标签：{{ visionSuggestion.tags.join(' / ') }}；置信度 {{ Math.round(visionSuggestion.confidence * 100) }}%</p>
            </article>
            <p class="muted">识别结果不会自动入库，请确认价格、档口、营养值和图片后再保存。</p>
            <p v-if="visionMessage" class="form-message">{{ visionMessage }}</p>
          </div>
        </fieldset>

        <div class="entry-save-actions">
          <button class="primary" type="submit" :disabled="entrySaving">{{ entrySaving ? '保存中...' : '保存' }}</button>
          <button class="secondary" type="button" :disabled="entrySaving" @click="saveDish('continue')">保存并继续新增</button>
          <button class="ghost" type="button" :disabled="entrySaving" @click="saveDish('return')">保存后返回数据管理</button>
        </div>
        <p v-if="message" class="form-message">{{ message }}</p>
      </form>
    </section>

    <!-- CSV 为主要导入方式，JSON 保留为高级选项 -->
    <section v-if="entryMode === 'import'" class="card admin-form">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">CSV Import</p>
          <h2>CSV 批量导入菜品</h2>
        </div>
        <span class="pill">先预览 · 后确认</span>
      </div>
      <p class="muted">表头支持：档口ID、菜名、价格、口味、菜系、食材、标签、热量、蛋白、脂肪、碳水、膳食纤维、钠、糖、钙、铁、清真、餐别、图片地址、描述。上传 UTF-8 CSV，食材/标签/餐别用逗号分隔，含逗号字段请用双引号包裹。</p>
      <input type="file" accept=".csv,text/csv" @change="previewCsvImport" />
      <p v-if="excelMessage" class="form-message">{{ excelMessage }}</p>
      <div v-if="excelRows.length" class="table-wrap">
        <table>
          <thead><tr><th>行</th><th>菜名</th><th>档口</th><th>价格</th><th>状态</th></tr></thead>
          <tbody>
            <tr v-for="row in excelRows.slice(0, 20)" :key="row.row">
              <td>{{ row.row }}</td>
              <td>{{ row.dish.name || '-' }}</td>
              <td>{{ row.dish.stallId || '-' }}</td>
              <td>¥{{ row.dish.price || 0 }}</td>
              <td :class="row.valid ? 'positive' : 'danger'">{{ row.valid ? '可导入' : row.errors.join('；') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <button class="primary" type="button" :disabled="!excelRows.length || excelRows.some((row) => !row.valid)" @click="confirmCsvImport">确认导入 {{ excelRows.length }} 行</button>
      <details class="advanced-import-card">
        <summary>高级导入：JSON 数组</summary>
        <div class="advanced-import-body">
          <textarea v-model="bulkInput" placeholder='[{"stallId":"stall-1","name":"低脂鸡胸饭","price":16,"taste":"清爽","cuisine":"轻食","ingredients":["鸡胸肉"],"tags":["高蛋白"],"nutrition":{"calories":520,"protein":38,"fat":9,"carbs":68}}]' @input="resetJsonPreview"></textarea>
          <div class="table-actions">
            <button class="secondary" type="button" :disabled="jsonLoading || !bulkInput.trim()" @click="previewJsonImport">生成 JSON 预览</button>
            <button class="primary" type="button" :disabled="jsonLoading || !jsonRows.length || jsonRows.some((row) => !row.valid)" @click="confirmJsonImport">确认导入 {{ jsonRows.length }} 行</button>
          </div>
          <p v-if="jsonMessage" class="form-message">{{ jsonMessage }}</p>
          <div v-if="jsonRows.length" class="table-wrap">
            <table>
              <thead><tr><th>行</th><th>菜名</th><th>档口</th><th>价格</th><th>状态</th></tr></thead>
              <tbody>
                <tr v-for="row in jsonRows.slice(0, 20)" :key="row.row">
                  <td>{{ row.row }}</td>
                  <td>{{ row.dish.name || '-' }}</td>
                  <td>{{ row.dish.stallId || '-' }}</td>
                  <td>¥{{ row.dish.price || 0 }}</td>
                  <td :class="row.valid ? 'positive' : 'danger'">{{ row.valid ? '可导入' : row.errors.join('；') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </section>

  </template>



  <!-- ═══════════════════════════════════════════════════════════════
       AI PAGE (/admin/ai) — AI 配置
       ═══════════════════════════════════════════════════════════════ -->

  <template v-if="isAdmin && isAiPage">
    <section class="card ai-page-tabs" aria-label="AI 配置视图">
      <button type="button" :class="{ active: aiTab === 'provider' }" @click="selectAiTab('provider')">提供商配置</button>
      <button type="button" :class="{ active: aiTab === 'monitor' }" @click="selectAiTab('monitor')">运行监控</button>
      <button v-if="canManageTenants" type="button" :class="{ active: aiTab === 'tenants' }" @click="selectAiTab('tenants')">租户与额度</button>
    </section>

    <!-- AI 提供商配置 -->
    <section v-if="aiTab === 'provider'" ref="aiSection" class="card admin-form">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">AI Provider</p>
          <h2>AI 提供商配置</h2>
        </div>
        <span class="pill">{{ store.aiStatus?.enabled ? `已启用 · ${store.aiStatus.source}` : '未启用' }}</span>
      </div>
      <div v-if="store.aiStatus" class="metric-grid">
        <article>
          <strong>{{ store.aiStatus.enabled ? '是' : '否' }}</strong>
          <span>已启用</span>
        </article>
        <article>
          <strong>{{ store.aiStatus.source || '无' }}</strong>
          <span>来源</span>
        </article>
        <article>
          <strong>{{ store.aiStatus.hasApiKey ? '已配置' : '未配置' }}</strong>
          <span>API Key</span>
        </article>
      </div>
      <div class="form-grid">
        <label>API Base URL<input v-model="aiForm.baseUrl" placeholder="https://api.openai.com/v1" /></label>
        <label>Chat 模型<input v-model="aiForm.chatModel" placeholder="gpt-4o-mini" /></label>
        <label>Embedding 模型<input v-model="aiForm.embeddingModel" placeholder="text-embedding-3-small" /></label>
        <label>Vision 模型<input v-model="aiForm.visionModel" placeholder="gpt-4o-mini" /></label>
        <label>超时 ms<input v-model.number="aiForm.timeoutMs" type="number" min="1000" max="60000" /></label>
      </div>
      <label>API Key<input v-model="aiForm.apiKey" autocomplete="off" type="password" placeholder="留空保存将保留已有密钥" /></label>
      <div class="table-actions">
        <button class="primary" type="button" :disabled="aiSaving || aiTesting || aiClearing" @click="saveAiProvider">{{ aiSaving ? '保存中...' : '保存并启用' }}</button>
        <button class="secondary" type="button" :disabled="aiSaving || aiTesting || aiClearing" @click="testAiProvider">{{ aiTesting ? '测试中...' : '测试连接' }}</button>
        <button class="ghost danger" type="button" :disabled="aiSaving || aiTesting || aiClearing" @click="clearAiProvider">{{ aiClearing ? '清空中...' : '清空配置' }}</button>
      </div>
      <p class="muted">保存后智能体会优先走真实 LLM；检索和推荐仍只基于真实菜品库，AI 失败会自动回退本地模板。</p>
      <div v-if="aiTestResult" class="ai-test-result">
        <span :class="['status-pill', aiTestResult.success ? 'status-approved' : 'status-rejected']">{{ aiTestResult.success ? '连接成功' : '连接失败' }}</span>
        <strong>{{ aiTestResult.model || aiForm.chatModel }}</strong>
        <span>{{ aiTestResult.durationMs == null ? '耗时未知' : `${aiTestResult.durationMs}ms` }}</span>
      </div>
      <p v-if="aiMessage" class="form-message">{{ aiMessage }}</p>
    </section>

    <!-- 配额与使用量 -->
    <section v-if="aiTab === 'monitor'" class="card admin-form">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">AI Governance</p>
          <h2>AI 运行监控</h2>
        </div>
        <button class="ghost" type="button" @click="refreshAiUsage">刷新</button>
      </div>
      <div class="ai-monitor-metrics">
        <article><strong>{{ aiMonitoringMetrics.totalCalls }}</strong><span>月调用量</span></article>
        <article><strong>{{ aiMonitoringMetrics.successRate }}%</strong><span>成功率</span></article>
        <article><strong>{{ aiMonitoringMetrics.tokenAndImages }}</strong><span>Token / 图片</span></article>
        <article><strong>{{ aiMonitoringMetrics.avgLatencyMs }}ms</strong><span>平均耗时</span></article>
        <article><strong>{{ store.aiQuotaStatus?.remaining ?? 0 }}</strong><span>剩余额度</span></article>
      </div>
      <section class="retrieval-index-panel" aria-label="检索索引">
        <div class="section-title horizontal">
          <div>
            <p class="eyebrow">Retrieval Index</p>
            <h3>检索索引</h3>
            <p class="muted">查看当前索引健康状态，必要时由管理员触发一次重建。</p>
          </div>
          <button v-if="canWriteDishes" class="secondary" type="button" :disabled="retrievalReindexing" @click="runRetrievalReindex">
            {{ retrievalReindexing ? '重建中...' : '重建索引' }}
          </button>
          <span v-else class="muted">当前角色没有重建索引权限</span>
        </div>
        <div class="metric-grid retrieval-index-metrics">
          <article>
            <strong>{{ store.retrievalIndexStatus?.documentCount ?? 0 }}</strong>
            <span>文档数</span>
          </article>
          <article>
            <strong>{{ store.retrievalIndexStatus?.failureCount ?? 0 }}</strong>
            <span>失败数</span>
          </article>
          <article>
            <strong>{{ store.retrievalIndexStatus?.embeddedCount ?? 0 }}</strong>
            <span>向量数</span>
          </article>
          <article>
            <strong>{{ store.retrievalIndexStatus?.status || 'unknown' }}</strong>
            <span>索引状态</span>
          </article>
        </div>
        <p class="muted">最后更新：{{ store.retrievalIndexStatus?.lastIndexedAt || '暂无' }} · 版本：{{ store.retrievalIndexStatus?.indexVersion || '未上报' }}</p>
        <p v-if="retrievalMessage" :class="['form-message', { danger: retrievalMessageType === 'error' }]">{{ retrievalMessage }}</p>
      </section>
      <div class="table-wrap ai-usage-table">
        <table>
          <thead><tr><th>时间</th><th>功能</th><th>模型</th><th>状态</th><th>Token/图像</th><th>耗时</th><th>失败摘要</th></tr></thead>
          <tbody>
            <tr v-for="log in store.aiUsageLogs" :key="log.id">
              <td data-label="时间">{{ log.createdAt?.slice(0, 19).replace('T', ' ') }}</td>
              <td data-label="功能">{{ log.feature }}</td>
              <td data-label="模型">{{ log.model || 'fallback' }}</td>
              <td data-label="状态"><span :class="['status-pill', log.status === 'success' ? 'status-approved' : 'status-rejected']">{{ log.status === 'success' ? '成功' : '失败' }}</span></td>
              <td data-label="Token / 图像">{{ log.inputTokens + log.outputTokens }} / {{ log.imageCount }}</td>
              <td data-label="耗时">{{ log.latencyMs }}ms</td>
              <td class="ai-error-summary" data-label="失败摘要">{{ compactAiError(log) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="store.aiUsageTotal > aiUsagePageSize" class="pagination">
        <button class="ghost" type="button" :disabled="aiUsagePage === 0" @click="aiUsagePage--; refreshAiUsage()">上一页</button>
        <span>{{ aiUsagePage + 1 }} / {{ Math.ceil(store.aiUsageTotal / aiUsagePageSize) }}</span>
        <button class="ghost" type="button" :disabled="(aiUsagePage + 1) * aiUsagePageSize >= store.aiUsageTotal" @click="aiUsagePage++; refreshAiUsage()">下一页</button>
      </div>
    </section>

    <!-- 部署就绪度 -->
    <section v-if="aiTab === 'monitor' && deploymentReadiness" class="card admin-form">
      <div class="section-title">
        <p class="eyebrow">Deployment Readiness</p>
        <h2>部署就绪度</h2>
      </div>
      <p v-if="deploymentReadiness.error" class="form-message danger">部署检查失败：{{ deploymentReadiness.error }}</p>
      <template v-else>
        <div class="metric-grid">
          <article v-for="(check, key) in deploymentReadiness.checks || {}" :key="key">
            <strong :class="`readiness-${check.status || 'unknown'}`">{{ readinessStatusLabel(check.status) }}</strong>
            <span>{{ check.label || key }}</span>
          </article>
        </div>
        <p v-if="deploymentReadiness.summary" class="muted">{{ deploymentReadiness.summary }}</p>
      </template>
    </section>

    <!-- 租户管理 -->
    <section v-if="aiTab === 'tenants' && canManageTenants" class="card admin-form">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Tenant Management</p>
          <h2>租户管理</h2>
        </div>
        <button class="ghost" type="button" @click="refreshTenants">刷新</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>租户</th><th>状态</th><th>方案</th><th>AI 额度</th><th>存储额度</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="tenant in store.adminTenants" :key="tenant.id">
              <td>{{ tenant.name }}</td>
              <td><span class="pill">{{ tenant.status }}</span></td>
              <td>{{ tenant.plan }}</td>
              <td>{{ tenant.aiQuota }}</td>
              <td>{{ tenant.storageQuotaMb }} MB</td>
              <td class="table-actions">
                <button class="ghost" type="button" @click="editTenant(tenant)">编辑</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="form-grid" v-if="tenantForm.id">
        <label>名称<input v-model="tenantForm.name" required /></label>
        <label>状态<select v-model="tenantForm.status"><option value="active">活跃</option><option value="disabled">暂停/停用</option></select></label>
        <label>方案<select v-model="tenantForm.plan"><option value="starter">入门</option><option value="professional">专业</option><option value="enterprise">企业</option></select></label>
        <label>AI 额度<input v-model.number="tenantForm.aiQuota" type="number" min="0" /></label>
        <label>存储额度 MB<input v-model.number="tenantForm.storageQuotaMb" type="number" min="0" /></label>
      </div>
      <div class="table-actions" v-if="tenantForm.id">
        <button class="primary" type="button" @click="saveTenant">保存租户</button>
        <button class="ghost" type="button" @click="Object.assign(tenantForm, defaultTenantForm())">取消</button>
      </div>
      <p v-if="userMessage" class="form-message">{{ userMessage }}</p>
    </section>
  </template>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { assertNumber, assertText, parseList, validateImageFile } from '../domain/validation.js';
import { useRoute, useRouter } from 'vue-router';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const route = useRoute();
const router = useRouter();
const adminRoleSet = new Set(['operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin', 'super_admin']);
const isAdmin = computed(() => store.user && adminRoleSet.has(store.user.role));
const roleCapabilities = {
  operator: ['stall:write', 'dish:write', 'agent:use'],
  stall_admin: ['stall:write', 'stall:delete', 'dish:write', 'dish:delete', 'agent:use'],
  canteen_admin: ['canteen:write', 'stall:write', 'stall:delete', 'dish:write', 'dish:delete', 'review:moderate', 'post:moderate', 'agent:use'],
  auditor: [],
  finance: [],
  tenant_admin: ['canteen:write', 'stall:write', 'stall:delete', 'dish:write', 'dish:delete', 'review:moderate', 'post:moderate', 'agent:use', 'ai:configure'],
  admin: ['canteen:write', 'stall:write', 'stall:delete', 'dish:write', 'dish:delete', 'review:moderate', 'post:moderate', 'agent:use', 'ai:configure', 'tenant:manage'],
  super_admin: ['canteen:write', 'stall:write', 'stall:delete', 'dish:write', 'dish:delete', 'review:moderate', 'post:moderate', 'agent:use', 'ai:configure', 'tenant:manage']
};

function hasCapability(permission) {
  const explicit = store.user?.permissions;
  if (explicit instanceof Set) return explicit.has(permission);
  if (Array.isArray(explicit)) return explicit.includes(permission);
  return Boolean(roleCapabilities[store.user?.role]?.includes(permission));
}

const canWriteCanteens = computed(() => hasCapability('canteen:write'));
const canWriteStalls = computed(() => hasCapability('stall:write'));
const canDeleteStalls = computed(() => hasCapability('stall:delete'));
const canWriteDishes = computed(() => hasCapability('dish:write'));
const canModerateReviews = computed(() => hasCapability('review:moderate'));
const canModeratePosts = computed(() => hasCapability('post:moderate'));
const canConfigureAi = computed(() => hasCapability('ai:configure'));
const canManageTenants = computed(() => hasCapability('tenant:manage'));
const isAiPage = computed(() => route.path === '/admin/ai' || route.query.panel === 'ai');
const isEntryPage = computed(() => route.path === '/admin/input');
const isManagePage = computed(() => route.path === '/admin');
const activePanel = computed(() => String(route.query.panel || (route.path === '/admin' ? 'reviews' : '')));
const pageMeta = computed(() => {
  if (isAiPage.value) return { eyebrow: 'AI 配置', title: 'AI 提供商与部署配置', description: '配置 OpenAI-compatible API，查看模型状态、连接测试、使用量、配额和部署就绪度。' };
  if (isEntryPage.value) return { eyebrow: '数据中心', title: '数据中心数据录入', description: '维护食堂、档口、菜品与营养数据。' };
  if (activePanel.value === 'reviews') return { eyebrow: '内容治理', title: '内容审核', description: '集中审核菜品评价、食堂评价和校园帖子，并查看关联对象与评价同步状态。' };
  if (activePanel.value === 'data') return { eyebrow: '数据管理', title: '四区数据管理', description: '固定四个餐饮区，按食堂、一级档口、子档口和菜品逐级管理。' };
  return { eyebrow: '内容治理', title: '内容审核', description: '集中审核评价与校园帖子。' };
});
const message = ref('');
const entrySaving = ref(false);
const bulkInput = ref('');
const jsonRows = ref([]);
const jsonMessage = ref('');
const jsonLoading = ref(false);
const userMessage = ref('');
const excelFile = ref(null);
const excelRows = ref([]);
const excelSummary = ref({ validCount: 0, errorCount: 0 });
const excelMessage = ref('');
const excelLoading = ref(false);
const canteenForm = reactive(defaultCanteenForm());
const dishForm = reactive(defaultDishForm());
const stallForm = reactive(defaultStallForm());
const aiMessage = ref('');
const aiForm = reactive(defaultAiForm());
const aiSection = ref(null);
const aiTab = ref('provider');
const aiTestResult = ref(null);
const aiSaving = ref(false);
const aiTesting = ref(false);
const aiClearing = ref(false);
const retrievalReindexing = ref(false);
const retrievalMessage = ref('');
const retrievalMessageType = ref('success');
const visionFile = ref(null);
const visionPreview = ref('');
const visionSuggestion = ref(null);
const visionMessage = ref('');
const visionLoading = ref(false);
const tenantForm = reactive(defaultTenantForm());
const menuForm = reactive(defaultMenuForm());
const menuItemForm = reactive(defaultMenuItemForm());
const deploymentReadiness = ref(null);
const databaseOverview = ref(null);

// ===== 四区层级数据 =====
const fixedRegions = [
  { id: 'campus-main', name: '中央餐饮区', positionLabel: '左上' },
  { id: 'north-zone', name: '北苑餐饮区', positionLabel: '右上' },
  { id: 'south-zone', name: '南湖餐饮区', positionLabel: '左下' },
  { id: 'east-zone', name: '东苑餐饮区', positionLabel: '右下' }
];
const entryTaskDefinitions = [
  { id: 'canteen', label: '食堂', allowed: canWriteCanteens },
  { id: 'stall', label: '一级档口', allowed: canWriteStalls },
  { id: 'sub-stall', label: '子档口', allowed: canWriteStalls },
  { id: 'dish', label: '菜品', allowed: canWriteDishes },
  { id: 'import', label: '批量导入', allowed: canWriteDishes }
];
const entryTasks = computed(() => entryTaskDefinitions.filter((task) => task.allowed.value));
const defaultEntryMode = () => entryTasks.value[0]?.id || '';
const entryMode = ref(entryTasks.value.some((task) => task.id === route.query.task) ? String(route.query.task) : defaultEntryMode());
const entryContext = reactive({ regionId: '', canteenId: '', primaryStallId: '', childStallId: '' });
const regionSearch = reactive(Object.fromEntries(fixedRegions.map((region) => [region.id, ''])));
const openCanteens = ref(new Set());
const openStalls = ref(new Set());

function toggleCanteen(id) { const next = new Set(openCanteens.value); next.has(id) ? next.delete(id) : next.add(id); openCanteens.value = next; }
function toggleStall(id) { const next = new Set(openStalls.value); next.has(id) ? next.delete(id) : next.add(id); openStalls.value = next; }

function searchableText(...parts) {
  return parts.flat(Infinity).filter(Boolean).join(' ').toLocaleLowerCase('zh-CN');
}

function matchesSearch(query, ...parts) {
  if (!query) return true;
  return searchableText(...parts).includes(String(query).toLocaleLowerCase('zh-CN'));
}

function buildCanteenNode(canteen, query, forceVisible = false) {
  const canteenMatched = matchesSearch(query, canteen.name, canteen.location, canteen.tags);
  const allStalls = store.stalls.filter((stall) => stall.canteenId === canteen.id);
  const localStallIds = new Set(allStalls.map((stall) => stall.id));
  const topLevelStalls = allStalls.filter((stall) => !stall.parentId || !localStallIds.has(stall.parentId));
  const allDishCount = store.dishes.filter((dish) => localStallIds.has(dish.stallId)).length;
  const showAll = forceVisible || canteenMatched || !query;

  const stalls = topLevelStalls.map((stall) => {
    const stallMatched = matchesSearch(query, stall.name, stall.floor, stall.category, stall.description);
    const directDishes = store.dishes.filter((dish) => dish.stallId === stall.id);
    const childStalls = allStalls.filter((child) => child.parentId === stall.id);
    const showAllInStall = showAll || stallMatched;
    const visibleDirectDishes = showAllInStall
      ? directDishes
      : directDishes.filter((dish) => matchesSearch(query, dish.name, dish.taste, dish.cuisine, dish.tags, dish.ingredients));
    const children = childStalls.map((child) => {
      const childMatched = matchesSearch(query, child.name, child.floor, child.category, child.description);
      const childDishes = store.dishes.filter((dish) => dish.stallId === child.id);
      const visibleDishes = showAllInStall || childMatched
        ? childDishes
        : childDishes.filter((dish) => matchesSearch(query, dish.name, dish.taste, dish.cuisine, dish.tags, dish.ingredients));
      if (query && !showAllInStall && !childMatched && !visibleDishes.length) return null;
      return { stall: child, dishes: visibleDishes };
    }).filter(Boolean);
    if (query && !showAllInStall && !visibleDirectDishes.length && !children.length) return null;
    return {
      stall,
      directDishes: visibleDirectDishes,
      children,
      childCount: childStalls.length,
      dishCount: directDishes.length + childStalls.reduce((count, child) => count + store.dishes.filter((dish) => dish.stallId === child.id).length, 0)
    };
  }).filter(Boolean);

  if (query && !forceVisible && !canteenMatched && !stalls.length) return null;
  return { canteen, stalls, primaryStallCount: topLevelStalls.length, dishCount: allDishCount };
}

const regionCards = computed(() => fixedRegions.map((definition) => {
  const region = store.canteens.find((canteen) => canteen.id === definition.id) || null;
  if (!region) return { ...definition, region: null, canteens: [], canteenCount: 0, stallCount: 0, dishCount: 0 };
  const query = regionSearch[definition.id] || '';
  const childCanteens = store.canteens.filter((canteen) => canteen.parentId === definition.id);
  const hasDirectStalls = store.stalls.some((stall) => stall.canteenId === definition.id);
  const hierarchyCanteens = hasDirectStalls ? [region, ...childCanteens] : childCanteens;
  const regionMatched = matchesSearch(query, region.name, region.location, region.tags);
  const canteens = hierarchyCanteens.map((canteen) => buildCanteenNode(canteen, query, regionMatched)).filter(Boolean);
  const canteenIds = new Set([definition.id, ...childCanteens.map((canteen) => canteen.id)]);
  const regionStalls = store.stalls.filter((stall) => canteenIds.has(stall.canteenId));
  const stallIds = new Set(regionStalls.map((stall) => stall.id));
  return {
    ...definition,
    region,
    canteens,
    canteenCount: childCanteens.length,
    stallCount: regionStalls.length,
    dishCount: store.dishes.filter((dish) => stallIds.has(dish.stallId)).length
  };
}));

function isCanteenOpen(regionId, canteenId) {
  return Boolean(regionSearch[regionId]) || openCanteens.value.has(canteenId);
}

function isStallOpen(regionId, stallId) {
  return Boolean(regionSearch[regionId]) || openStalls.value.has(stallId);
}

function openEntry(query) {
  router.push({ path: '/admin/input', query });
}

function regionIdForCanteen(canteenId) {
  const canteen = store.canteens.find((item) => item.id === canteenId);
  if (!canteen) return '';
  return fixedRegions.some((region) => region.id === canteen.id) ? canteen.id : canteen.parentId || '';
}

function setEntryMode(mode, { reset = true } = {}) {
  const nextMode = entryTasks.value.some((task) => task.id === mode) ? mode : defaultEntryMode();
  const changed = entryMode.value !== nextMode;
  entryMode.value = nextMode;
  message.value = '';
  if (changed && reset) {
    if (nextMode === 'canteen') resetCanteenForm();
    if (['stall', 'sub-stall'].includes(nextMode)) resetStallForm();
    if (nextMode === 'dish') resetDishForm();
  }
  if (nextMode === 'canteen' && !canteenForm.id) {
    canteenForm.canteenType = 'sub';
    canteenForm.parentId = entryContext.regionId;
  } else if (nextMode === 'stall' && !stallForm.id) {
    stallForm.parentId = null;
    stallForm.canteenId = entryContext.canteenId;
  } else if (nextMode === 'sub-stall' && !stallForm.id) {
    stallForm.parentId = entryContext.primaryStallId || null;
    stallForm.canteenId = entryContext.canteenId;
  } else if (nextMode === 'dish' && !dishForm.id) {
    dishForm.stallId = entryContext.childStallId || entryContext.primaryStallId || dishForm.stallId;
  }
}

function handleEntryRegionChange() {
  entryContext.canteenId = '';
  entryContext.primaryStallId = '';
  entryContext.childStallId = '';
  canteenForm.canteenType = 'sub';
  canteenForm.parentId = entryContext.regionId;
  stallForm.canteenId = '';
  stallForm.parentId = null;
}

function handleEntryCanteenChange() {
  entryContext.primaryStallId = '';
  entryContext.childStallId = '';
  stallForm.canteenId = entryContext.canteenId;
  stallForm.parentId = null;
  dishForm.stallId = '';
}

function handleEntryPrimaryStallChange() {
  entryContext.childStallId = '';
  if (entryMode.value === 'sub-stall') stallForm.parentId = entryContext.primaryStallId;
  if (entryMode.value === 'dish') dishForm.stallId = entryContext.primaryStallId;
}

function handleEntryChildStallChange() {
  dishForm.stallId = entryContext.childStallId || entryContext.primaryStallId;
}

function syncDishEntryContext() {
  const stall = store.stalls.find((item) => item.id === dishForm.stallId);
  if (!stall) return;
  entryContext.canteenId = stall.canteenId;
  entryContext.regionId = regionIdForCanteen(stall.canteenId);
  entryContext.primaryStallId = stall.parentId || stall.id;
  entryContext.childStallId = stall.parentId ? stall.id : '';
}

const initializedEntryRoute = ref('');
const currentEntryRouteKey = () => `${route.fullPath}:${store.user?.role || 'anonymous'}`;

function initializeEntryWorkspace() {
  if (!isEntryPage.value) return;
  const routeKey = currentEntryRouteKey();
  if (initializedEntryRoute.value === routeKey) return;
  const requestedTask = String(route.query.task || '');
  const nextMode = entryTasks.value.some((task) => task.id === requestedTask) ? requestedTask : defaultEntryMode();
  const requestedCanteenId = String(route.query.canteenId || '');
  const requestedParentId = String(route.query.parentId || '');
  const requestedStallId = String(route.query.stallId || '');
  const editId = String(route.query.editId || '');
  const needsCatalog = Boolean(requestedCanteenId || requestedParentId || requestedStallId || editId);
  if (needsCatalog && !store.canteens.length && !store.stalls.length && !store.dishes.length) return;

  entryMode.value = nextMode;
  Object.assign(entryContext, { regionId: '', canteenId: '', primaryStallId: '', childStallId: '' });
  Object.assign(canteenForm, defaultCanteenForm());
  Object.assign(stallForm, defaultStallForm());
  Object.assign(dishForm, defaultDishForm(), { stallId: '' });
  resetVisionImport();

  if (requestedCanteenId) {
    entryContext.canteenId = requestedCanteenId;
    entryContext.regionId = regionIdForCanteen(requestedCanteenId);
  }
  if (entryMode.value === 'canteen' && requestedParentId) {
    entryContext.regionId = requestedParentId;
    canteenForm.canteenType = 'sub';
    canteenForm.parentId = requestedParentId;
  }
  if (entryMode.value === 'sub-stall' && requestedParentId) {
    const parent = store.stalls.find((item) => item.id === requestedParentId);
    entryContext.primaryStallId = requestedParentId;
    if (parent) {
      entryContext.canteenId = parent.canteenId;
      entryContext.regionId = regionIdForCanteen(parent.canteenId);
    }
  }
  if (requestedStallId) {
    const stall = store.stalls.find((item) => item.id === requestedStallId);
    if (stall) {
      entryContext.canteenId = stall.canteenId;
      entryContext.regionId = regionIdForCanteen(stall.canteenId);
      if (stall.parentId) {
        entryContext.primaryStallId = stall.parentId;
        entryContext.childStallId = stall.id;
      } else {
        entryContext.primaryStallId = stall.id;
      }
      dishForm.stallId = stall.id;
    }
  }
  if (editId && entryMode.value === 'canteen') {
    const canteen = store.canteens.find((item) => item.id === editId);
    if (canteen) {
      editCanteen(canteen);
      entryContext.regionId = canteen.parentId || canteen.id;
    }
  }
  if (editId && ['stall', 'sub-stall'].includes(entryMode.value)) {
    const stall = store.stalls.find((item) => item.id === editId);
    if (stall) {
      entryMode.value = stall.parentId ? 'sub-stall' : 'stall';
      editStall(stall);
      entryContext.regionId = regionIdForCanteen(stall.canteenId);
      entryContext.canteenId = stall.canteenId;
      entryContext.primaryStallId = stall.parentId || stall.id;
      entryContext.childStallId = stall.parentId ? stall.id : '';
    }
  }
  if (editId && entryMode.value === 'dish') {
    const dish = store.dishes.find((item) => item.id === editId);
    if (dish) {
      editDish(dish);
      syncDishEntryContext();
    }
  }
  setEntryMode(entryMode.value, { reset: false });
  initializedEntryRoute.value = routeKey;
}

const primaryCanteens = computed(() => store.canteens.filter((c) => c.canteenType === 'primary' || (!c.canteenType && !c.parentId)));
const entryCanteens = computed(() => {
  const children = store.canteens.filter((canteen) => canteen.parentId === entryContext.regionId);
  const region = store.canteens.find((canteen) => canteen.id === entryContext.regionId);
  const hasLegacyDirectStalls = region && store.stalls.some((stall) => stall.canteenId === region.id);
  return hasLegacyDirectStalls ? [region, ...children] : children;
});
const entryPrimaryStalls = computed(() => {
  const stalls = store.stalls.filter((stall) => stall.canteenId === entryContext.canteenId);
  const ids = new Set(stalls.map((stall) => stall.id));
  return stalls.filter((stall) => !stall.parentId || !ids.has(stall.parentId));
});
const entryChildStalls = computed(() => store.stalls.filter((stall) => stall.parentId === entryContext.primaryStallId && stall.canteenId === entryContext.canteenId));
const entryDishStalls = computed(() => {
  const primaryIds = new Set(entryPrimaryStalls.value.map((stall) => stall.id));
  return store.stalls
    .filter((stall) => stall.canteenId === entryContext.canteenId && (!stall.parentId || primaryIds.has(stall.parentId)))
    .sort((left, right) => Number(Boolean(left.parentId)) - Number(Boolean(right.parentId)) || left.name.localeCompare(right.name, 'zh-CN'));
});

const selectedMenuIds = ref(new Set());
const reviewPage = ref(0);
const reviewPageSize = 20;
const reviewMessage = ref('');
const reviewMessageType = ref('info');
const reviewLoading = ref(false);
const reviewStatusFilter = ref('pending');
const reviewTypeFilter = ref('');
const reviewCanteenFilter = ref('');
const reviewStallFilter = ref('');
const reviewDishFilter = ref('');
const reviewBusyIds = ref(new Set());
const moderationTab = ref(route.query.tab === 'posts' ? 'posts' : 'reviews');
const postPage = ref(0);
const postPageSize = 20;
const postMessage = ref('');
const postMessageType = ref('info');
const postLoading = ref(false);
const postStatusFilter = ref('pending');
const postBusyIds = ref(new Set());

const reviewFilterCanteens = computed(() => store.canteens);
const reviewFilterStalls = computed(() => store.stalls.filter((stall) => !reviewCanteenFilter.value || stall.canteenId === reviewCanteenFilter.value));
const reviewFilterDishes = computed(() => store.dishes.filter((dish) => {
  const stall = store.stalls.find((item) => item.id === dish.stallId);
  if (reviewCanteenFilter.value && stall?.canteenId !== reviewCanteenFilter.value) return false;
  if (reviewStallFilter.value && dish.stallId !== reviewStallFilter.value) return false;
  return true;
}));

function reviewDish(review) {
  return review.dish || store.dishes.find((dish) => dish.id === review.targetId) || null;
}

function reviewStall(review) {
  if (review.stall) return review.stall;
  const dish = reviewDish(review);
  return dish ? store.stalls.find((stall) => stall.id === dish.stallId) || null : null;
}

function reviewCanteen(review) {
  if (review.canteen) return review.canteen;
  if (review.targetType === 'canteen') return store.canteens.find((canteen) => canteen.id === review.targetId) || null;
  const stall = reviewStall(review);
  return stall ? store.canteens.find((canteen) => canteen.id === stall.canteenId) || null : null;
}

const filteredAdminReviews = computed(() => [...store.adminReviews].filter((review) => {
  if (reviewTypeFilter.value && review.targetType !== reviewTypeFilter.value) return false;
  const canteen = reviewCanteen(review);
  const stall = reviewStall(review);
  const dish = reviewDish(review);
  if (reviewCanteenFilter.value && canteen?.id !== reviewCanteenFilter.value) return false;
  if (reviewStallFilter.value && stall?.id !== reviewStallFilter.value) return false;
  if (reviewDishFilter.value && dish?.id !== reviewDishFilter.value) return false;
  return true;
}).sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || ''))));

const auditPage = ref(0);
const auditPageSize = 20;
const aiUsagePage = ref(0);
const aiUsagePageSize = 20;

const aiMonitoringMetrics = computed(() => {
  const summary = store.aiUsageSummary || [];
  const totalCalls = summary.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const successful = summary.filter((item) => item.status === 'success').reduce((sum, item) => sum + Number(item.count || 0), 0);
  const tokens = summary.reduce((sum, item) => sum + Number(item.inputTokens || 0) + Number(item.outputTokens || 0), 0);
  const images = summary.reduce((sum, item) => sum + Number(item.imageCount || 0), 0);
  const weightedLatency = summary.reduce((sum, item) => sum + Number(item.avgLatencyMs || 0) * Number(item.count || 0), 0);
  return {
    totalCalls,
    successRate: totalCalls ? Math.round((successful / totalCalls) * 100) : 0,
    tokenAndImages: `${tokens} / ${images}`,
    avgLatencyMs: totalCalls ? Math.round(weightedLatency / totalCalls) : 0
  };
});

const allMenusSelected = computed(() => {
  const menus = store.adminMenus;
  return menus.length > 0 && menus.every((menu) => selectedMenuIds.value.has(menu.id));
});

const todayMenus = computed(() => {
  const today = new Date().toISOString().slice(0, 10);
  return store.adminMenus.filter((menu) => menu.date === today);
});

function defaultCanteenForm() {
  return { id: '', name: '', location: '', hours: '', tags: '', description: '', crowdLevel: 30, canteenType: 'primary', parentId: '', imageUrl: '' };
}

function defaultDishForm() {
  return { id: '', stallId: store.stalls[0]?.id || '', name: '', price: 15, taste: '清爽', cuisine: '轻食', ingredients: '', tags: '', imageUrl: '', calories: 500, protein: 25, fat: 12, carbs: 60, fiber: 0, sodium: 0, sugar: 0, calcium: 0, iron: 0, halal: false, allergens: '' };
}

function defaultStallForm() {
  return { id: '', canteenId: '', parentId: null, name: '', floor: '1F', category: '', rating: 4.5, avgPrice: 15, description: '', open: true };
}

function defaultAiForm() {
  return { apiKey: '', baseUrl: 'https://api.openai.com/v1', embeddingModel: 'text-embedding-3-small', chatModel: 'gpt-4o-mini', visionModel: 'gpt-4o-mini', timeoutMs: 12000 };
}

function defaultTenantForm() {
  return { id: '', name: '', status: 'active', plan: 'starter', aiQuota: 1000, storageQuotaMb: 10240 };
}

function defaultMenuForm() {
  return { id: '', canteenId: store.canteens[0]?.id || '', date: new Date().toISOString().slice(0, 10), mealType: 'lunch', status: 'draft', items: [] };
}

function defaultMenuItemForm() {
  return { dishId: '', price: 15, supplyLimit: 0, soldOut: false };
}

function applyAiSettings(settings = {}) {
  Object.assign(aiForm, { ...defaultAiForm(), ...settings, apiKey: '' });
}

function compactAiError(log) {
  const summary = String(log?.error || '').replace(/\s+/g, ' ').trim();
  if (!summary) return '—';
  return summary.length > 80 ? `${summary.slice(0, 77)}...` : summary;
}

function readinessStatusLabel(status) {
  return { ok: '通过', warn: '提示', error: '失败' }[status] || '未知';
}

async function selectAiTab(tab) {
  const nextTab = tab === 'tenants' && !canManageTenants.value ? 'provider' : tab;
  aiTab.value = ['provider', 'monitor', 'tenants'].includes(nextTab) ? nextTab : 'provider';
  if (isAiPage.value && route.query.tab !== aiTab.value) {
    await router.replace({ path: route.path, query: { ...route.query, tab: aiTab.value } });
    return;
  }
  if (aiTab.value === 'monitor') {
    await refreshAiUsage();
    await refreshRetrievalIndexStatus();
    try {
      deploymentReadiness.value = await store.loadDeploymentReadiness();
    } catch (error) {
      deploymentReadiness.value = { error: error.message };
    }
  }
  if (aiTab.value === 'tenants' && canManageTenants.value) await refreshTenants();
}

function stallName(id) {
  return store.stalls.find((stall) => stall.id === id)?.name || '未绑定';
}

function canteenNameById(id) {
  const canteen = store.canteens.find((c) => c.id === id);
  return canteen ? canteen.name : id || '—';
}

function formatDateTime(value) {
  if (!value) return '时间未知';
  return String(value).slice(0, 19).replace('T', ' ');
}

function statusLabel(status) {
  return { pending: '待审核', approved: '已通过', rejected: '已驳回', all: '全部状态' }[status] || status || '未知状态';
}

function reviewTargetName(review) {
  if (review.targetType === 'canteen') return reviewCanteen(review)?.name || review.targetId || '未知食堂';
  return reviewDish(review)?.name || review.targetId || '未知菜品';
}

function reviewTargetPath(review) {
  const canteen = reviewCanteen(review);
  if (review.targetType === 'canteen') return canteen?.location || '食堂信息待补充';
  const stall = reviewStall(review);
  return [canteen?.name, stall?.name].filter(Boolean).join(' / ') || '关联层级待补充';
}

function resetReviewTargetFilters() {
  if (reviewTypeFilter.value === 'canteen') {
    reviewStallFilter.value = '';
    reviewDishFilter.value = '';
  }
  reloadReviewsFromFirstPage();
}

function handleReviewCanteenChange() {
  reviewStallFilter.value = '';
  reviewDishFilter.value = '';
  reloadReviewsFromFirstPage();
}

function handleReviewStallChange() {
  reviewDishFilter.value = '';
  reloadReviewsFromFirstPage();
}

function selectModerationTab(tab) {
  moderationTab.value = tab;
  router.replace({ query: { ...route.query, panel: 'reviews', tab } });
  if (tab === 'reviews' && canModerateReviews.value && !store.adminReviews.length) refreshReviews();
  if (tab === 'posts' && canModeratePosts.value && !store.adminPosts.length) refreshPosts();
}

function resetCanteenForm() {
  Object.assign(canteenForm, defaultCanteenForm());
  if (entryContext.regionId) Object.assign(canteenForm, { canteenType: 'sub', parentId: entryContext.regionId });
}

function resetDishForm() {
  Object.assign(dishForm, defaultDishForm());
  dishForm.stallId = entryContext.childStallId || entryContext.primaryStallId || '';
}

function dishPayload() {
  return {
    id: dishForm.id || undefined,
    stallId: dishForm.stallId,
    name: assertText(dishForm.name, '菜名', 2, 40),
    price: assertNumber(dishForm.price, '价格', 1, 200),
    taste: assertText(dishForm.taste, '口味', 1, 20),
    cuisine: assertText(dishForm.cuisine, '菜系', 1, 30),
    ingredients: parseList(dishForm.ingredients, '食材', { required: true }),
    tags: parseList(dishForm.tags, '标签', { required: true }),
    halal: dishForm.halal,
    allergens: parseList(dishForm.allergens, '过敏原'),
    mealTypes: ['lunch', 'dinner'],
    image: '🍽️',
    imageUrl: dishForm.imageUrl || undefined,
    description: dishForm.allergens ? `过敏原：${parseList(dishForm.allergens, '过敏原').join('、')}。管理员录入菜品。` : '管理员录入菜品。',
    rating: 4.5,
    reviewCount: 0,
    sales: 0,
    nutrition: {
      calories: assertNumber(dishForm.calories, '热量', 1, 3000),
      protein: assertNumber(dishForm.protein, '蛋白', 0, 300),
      fat: assertNumber(dishForm.fat, '脂肪', 0, 300),
      carbs: assertNumber(dishForm.carbs, '碳水', 0, 500),
      fiber: Number(dishForm.fiber || 0),
      sodium: Number(dishForm.sodium || 0),
      sugar: Number(dishForm.sugar || 0),
      calcium: Number(dishForm.calcium || 0),
      iron: Number(dishForm.iron || 0)
    }
  };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result.split(',')[1] || result);
      } else {
        reject(new Error('读取文件失败'));
      }
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function finishEntrySave(action, resetForm) {
  if (action === 'return') {
    router.push({ path: '/admin', query: { panel: 'data' } });
    return;
  }
  if (action === 'continue') resetForm();
}

async function saveCanteen(action = 'stay') {
  if (entrySaving.value) return;
  entrySaving.value = true;
  try {
    if (canteenForm.canteenType === 'sub' && !canteenForm.parentId) throw new Error('下属食堂必须选择上级食堂。');
    const payload = {
      ...canteenForm,
      name: assertText(canteenForm.name, '食堂名称', 2, 40),
      location: assertText(canteenForm.location, '位置', 2, 80),
      hours: assertText(canteenForm.hours, '营业时间', 5, 40),
      description: assertText(canteenForm.description, '简介', 5, 300),
      crowdLevel: assertNumber(canteenForm.crowdLevel, '拥挤度', 0, 100),
      tags: parseList(canteenForm.tags, '标签'),
      canteenType: canteenForm.canteenType || 'primary',
      parentId: canteenForm.canteenType === 'sub' ? canteenForm.parentId : null,
      imageUrl: canteenForm.imageUrl || undefined
    };
    await store.upsertCanteen(payload);
    const saved = store.canteens.find((item) => item.id === payload.id)
      || [...store.canteens].reverse().find((item) => item.name === payload.name && (item.parentId || null) === (payload.parentId || null));
    if (saved) {
      entryContext.regionId = regionIdForCanteen(saved.id) || saved.parentId || saved.id;
      entryContext.canteenId = saved.id;
    }
    if (action === 'stay' && saved) editCanteen(saved);
    else finishEntrySave(action, resetCanteenForm);
    message.value = '食堂已保存到数据库。';
  } catch (error) {
    message.value = error.message;
  } finally {
    entrySaving.value = false;
  }
}

async function saveStall(action = 'stay') {
  if (entrySaving.value) return;
  entrySaving.value = true;
  try {
    stallForm.canteenId = entryContext.canteenId || stallForm.canteenId;
    if (!stallForm.canteenId) throw new Error('请选择所属食堂。');
    if (entryMode.value === 'sub-stall' && !stallForm.parentId) throw new Error('子档口必须选择上级一级档口。');
    const payload = {
      id: stallForm.id || undefined,
      canteenId: stallForm.canteenId,
      parentId: entryMode.value === 'sub-stall' ? stallForm.parentId : null,
      name: assertText(stallForm.name, '档口名称', 2, 40),
      floor: assertText(stallForm.floor, '楼层', 1, 10),
      category: assertText(stallForm.category, '品类', 2, 30),
      rating: assertNumber(stallForm.rating, '评分', 1, 5),
      avgPrice: assertNumber(stallForm.avgPrice, '均价', 1, 200),
      description: stallForm.description || '',
      open: stallForm.open
    };
    await store.upsertStall(payload);
    const saved = store.stalls.find((item) => item.id === payload.id)
      || [...store.stalls].reverse().find((item) => item.canteenId === payload.canteenId && item.name === payload.name && (item.parentId || null) === (payload.parentId || null));
    if (saved) {
      if (saved.parentId) {
        entryContext.primaryStallId = saved.parentId;
        entryContext.childStallId = saved.id;
      } else {
        entryContext.primaryStallId = saved.id;
        entryContext.childStallId = '';
      }
    }
    if (action === 'stay' && saved) editStall(saved);
    else finishEntrySave(action, resetStallForm);
    message.value = '档口已保存到数据库。';
  } catch (error) {
    message.value = error.message;
  } finally {
    entrySaving.value = false;
  }
}

function editStall(stall) {
  Object.assign(stallForm, defaultStallForm(), stall, { parentId: stall.parentId || null });
}

async function removeStall(id) {
  if (!canDeleteStalls.value) {
    message.value = '当前角色无档口删除权限。';
    return;
  }
  if (entrySaving.value) return;
  const stall = store.stalls.find((item) => item.id === id);
  if (!stall) return;
  const childCount = store.stalls.filter((item) => item.parentId === id).length;
  const dishCount = store.dishes.filter((dish) => dish.stallId === id).length;
  if (childCount > 0) {
    message.value = `该一级档口仍有 ${childCount} 个子档口，请先迁移或删除子档口。`;
    return;
  }
  const confirmed = typeof window === 'undefined' || window.confirm(`确认删除“${stall.name}”？该档口当前关联 ${dishCount} 道菜，删除将沿用现有数据库级联规则。`);
  if (!confirmed) return;
  entrySaving.value = true;
  try {
    await store.deleteStall(id);
    if (entryContext.childStallId === id) entryContext.childStallId = '';
    if (entryContext.primaryStallId === id) {
      entryContext.primaryStallId = '';
      entryContext.childStallId = '';
    }
    resetStallForm();
    const nextQuery = { ...route.query };
    delete nextQuery.editId;
    await router.replace({ path: '/admin/input', query: nextQuery });
    message.value = '档口已删除。';
  } catch (error) {
    message.value = error.message;
  } finally {
    entrySaving.value = false;
  }
}

function resetStallForm() {
  Object.assign(stallForm, defaultStallForm());
  stallForm.canteenId = entryContext.canteenId;
  stallForm.parentId = entryMode.value === 'sub-stall' ? entryContext.primaryStallId || null : null;
}

async function saveDish(action = 'stay') {
  if (entrySaving.value) return;
  entrySaving.value = true;
  try {
    if (!dishForm.stallId) throw new Error('请选择所属档口。');
    const payload = dishPayload();
    await store.upsertDish(payload);
    const saved = store.dishes.find((item) => item.id === payload.id)
      || [...store.dishes].reverse().find((item) => item.stallId === payload.stallId && item.name === payload.name);
    syncDishEntryContext();
    if (action === 'stay' && saved) editDish(saved);
    else finishEntrySave(action, resetDishForm);
    message.value = '菜品和营养数据已保存到数据库。';
  } catch (error) {
    message.value = error.message;
  } finally {
    entrySaving.value = false;
  }
}

function editCanteen(canteen) {
  Object.assign(canteenForm, { ...canteen, tags: Array.isArray(canteen.tags) ? canteen.tags.join(', ') : String(canteen.tags || '') });
}

async function removeCanteen(id) {
  try {
    await store.deleteCanteen(id);
    message.value = '食堂已删除。';
  } catch (error) {
    message.value = error.message;
  }
}

function editDish(dish) {
  const nutrition = dish.nutrition || {};
  Object.assign(dishForm, {
    ...dish,
    ingredients: Array.isArray(dish.ingredients) ? dish.ingredients.join(', ') : String(dish.ingredients || ''),
    tags: Array.isArray(dish.tags) ? dish.tags.join(', ') : String(dish.tags || ''),
    allergens: Array.isArray(dish.allergens) ? dish.allergens.join(', ') : String(dish.allergens || ''),
    imageUrl: dish.imageUrl || '',
    calories: nutrition.calories,
    protein: nutrition.protein,
    fat: nutrition.fat,
    carbs: nutrition.carbs,
    fiber: dish.fiber ?? nutrition.fiber ?? 0,
    sodium: dish.sodium ?? nutrition.sodium ?? 0,
    sugar: dish.sugar ?? nutrition.sugar ?? 0,
    calcium: dish.calcium ?? nutrition.calcium ?? 0,
    iron: dish.iron ?? nutrition.iron ?? 0
  });
}

async function removeDish(id) {
  try {
    await store.deleteDish(id);
    message.value = '菜品已下架。';
  } catch (error) {
    message.value = error.message;
  }
}

function normalizeJsonImportRow(rawDish, index) {
  if (!rawDish || typeof rawDish !== 'object' || Array.isArray(rawDish)) {
    return { row: index + 1, dish: {}, valid: false, errors: ['每一行必须是菜品对象'] };
  }
  const errors = [];
  const capture = (reader, fallback) => {
    try {
      return reader();
    } catch (error) {
      errors.push(error.message);
      return fallback;
    }
  };
  const stallId = String(rawDish.stallId || '').trim();
  if (!stallId) errors.push('请选择所属档口。');
  else if (!store.stalls.some((stall) => stall.id === stallId)) errors.push('所属档口不存在或不属于当前租户。');
  const nutrition = rawDish.nutrition || {};
  const dish = {
    ...rawDish,
    stallId,
    name: capture(() => assertText(rawDish.name, '菜名', 2, 40), ''),
    price: capture(() => assertNumber(rawDish.price, '价格', 1, 200), 0),
    taste: capture(() => assertText(rawDish.taste, '口味', 1, 20), ''),
    cuisine: capture(() => assertText(rawDish.cuisine, '菜系', 1, 30), ''),
    ingredients: capture(() => parseList(rawDish.ingredients, '食材', { required: true }), []),
    tags: capture(() => parseList(rawDish.tags, '标签', { required: true }), []),
    allergens: parseList(rawDish.allergens || '', '过敏原'),
    nutrition: {
      ...nutrition,
      calories: capture(() => assertNumber(nutrition.calories, '热量', 1, 3000), 0),
      protein: capture(() => assertNumber(nutrition.protein, '蛋白', 0, 300), 0),
      fat: capture(() => assertNumber(nutrition.fat, '脂肪', 0, 300), 0),
      carbs: capture(() => assertNumber(nutrition.carbs, '碳水', 0, 500), 0),
    },
  };
  return { row: index + 1, dish, valid: errors.length === 0, errors };
}

function resetJsonPreview() {
  if (!jsonRows.value.length && !jsonMessage.value) return;
  jsonRows.value = [];
  jsonMessage.value = 'JSON 内容已修改，请重新生成预览。';
}

function previewJsonImport() {
  try {
    const dishes = JSON.parse(bulkInput.value);
    if (!Array.isArray(dishes) || !dishes.length) throw new Error('批量导入内容必须是非空 JSON 数组。');
    jsonRows.value = dishes.map(normalizeJsonImportRow);
    const invalidCount = jsonRows.value.filter((row) => !row.valid).length;
    jsonMessage.value = invalidCount
      ? `预览完成：${jsonRows.value.length - invalidCount} 行可导入，${invalidCount} 行需修正。`
      : `预览完成：${jsonRows.value.length} 行可导入，请确认后写入数据库。`;
  } catch (error) {
    jsonRows.value = [];
    jsonMessage.value = error.message;
  }
}

async function confirmJsonImport() {
  if (!jsonRows.value.length || jsonRows.value.some((row) => !row.valid) || jsonLoading.value) return;
  jsonLoading.value = true;
  try {
    const imported = await store.importDishes(jsonRows.value.map((row) => row.dish));
    bulkInput.value = '';
    jsonRows.value = [];
    jsonMessage.value = `已确认导入 ${imported} 道菜。`;
  } catch (error) {
    jsonMessage.value = error.message;
  } finally {
    jsonLoading.value = false;
  }
}

async function previewCsvImport(event) {
  const file = event.target.files?.[0];
  excelFile.value = file || null;
  excelRows.value = [];
  excelSummary.value = { validCount: 0, errorCount: 0 };
  if (!file) return;
  if (!/\.csv$/i.test(file.name)) {
    excelMessage.value = '请上传 .csv 文件。';
    return;
  }
  excelLoading.value = true;
  try {
    const csvText = await fileToText(file);
    const result = await store.previewDishImport(csvText);
    excelRows.value = result.rows;
    excelSummary.value = { validCount: result.validCount, errorCount: result.errorCount };
    excelMessage.value = `预览完成：${result.validCount} 行可导入，${result.errorCount} 行需修正。`;
  } catch (error) {
    excelMessage.value = error.message;
  } finally {
    excelLoading.value = false;
  }
}

async function confirmExcelImport() {
  if (!excelFile.value) return;
  excelLoading.value = true;
  try {
    const csvText = await fileToText(excelFile.value);
    const result = await store.confirmDishImport(csvText);
    excelRows.value = [];
    excelSummary.value = { validCount: 0, errorCount: 0 };
    excelFile.value = null;
    excelMessage.value = `已确认导入 ${result.imported} 道菜。`;
  } catch (error) {
    excelMessage.value = error.message;
  } finally {
    excelLoading.value = false;
  }
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}

function revokeVisionPreview() {
  if (visionPreview.value) URL.revokeObjectURL(visionPreview.value);
}

function resetVisionImport() {
  revokeVisionPreview();
  visionFile.value = null;
  visionPreview.value = '';
  visionSuggestion.value = null;
  visionMessage.value = '';
}

async function handleVisionFile(event) {
  const file = event.target.files?.[0];
  resetVisionImport();
  if (!file) return;
  const error = validateImageFile(file);
  if (error) {
    visionMessage.value = error;
    return;
  }
  visionFile.value = file;
  visionPreview.value = URL.createObjectURL(file);
  visionMessage.value = '图片已选择，可点击 AI 识别预填表单。';
}

async function identifyVisionDish() {
  if (!visionFile.value) return;
  visionLoading.value = true;
  try {
    const file = visionFile.value;
    const result = await store.identifyDishImage({ filename: file.name, contentType: file.type, dataBase64: await fileToBase64(file) });
    const suggestion = result.suggestion;
    visionSuggestion.value = suggestion;
    Object.assign(dishForm, {
      name: suggestion.name || dishForm.name,
      taste: suggestion.taste || dishForm.taste,
      cuisine: suggestion.cuisine || dishForm.cuisine,
      ingredients: suggestion.ingredients.join(', '),
      tags: suggestion.tags.join(', '),
      calories: suggestion.nutrition.calories,
      protein: suggestion.nutrition.protein,
      fat: suggestion.nutrition.fat,
      carbs: suggestion.nutrition.carbs
    });
    visionMessage.value = '已根据图片预填新增菜品表单，请人工确认后保存。';
  } catch (error) {
    visionMessage.value = error.message;
  } finally {
    visionLoading.value = false;
  }
}

async function handleImageFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const error = validateImageFile(file);
    if (error) throw new Error(error);
    const upload = await store.uploadImage({ filename: file.name, contentType: file.type, dataBase64: await fileToBase64(file) });
    dishForm.imageUrl = upload.url;
    message.value = '图片已上传并填入菜品表单。';
  } catch (error) {
    message.value = error.message;
  }
}

async function refreshAnalytics() {
  try {
    await store.loadAnalytics();
  } catch (error) {
    message.value = error.message;
  }
}

async function refreshReviews(preserveMessage = false) {
  if (!canModerateReviews.value) return;
  reviewLoading.value = true;
  try {
    await store.loadReviewsAdmin(reviewPageSize, reviewPage.value * reviewPageSize, reviewStatusFilter.value, {
      targetType: reviewTypeFilter.value,
      canteenId: reviewCanteenFilter.value,
      stallId: reviewStallFilter.value,
      dishId: reviewDishFilter.value
    });
    if (!preserveMessage) reviewMessage.value = '';
    reviewMessageType.value = 'info';
  } catch (error) {
    reviewMessage.value = error.message;
    reviewMessageType.value = 'error';
  } finally {
    reviewLoading.value = false;
  }
}

const confirmCsvImport = confirmExcelImport;

function reloadReviewsFromFirstPage() {
  reviewPage.value = 0;
  refreshReviews();
}

async function refreshPosts(preserveMessage = false) {
  if (!canModeratePosts.value) return;
  postLoading.value = true;
  try {
    await store.loadPostsAdmin(postPageSize, postPage.value * postPageSize, postStatusFilter.value);
    if (!preserveMessage) postMessage.value = '';
    postMessageType.value = 'info';
  } catch (error) {
    postMessage.value = error.message;
    postMessageType.value = 'error';
  } finally {
    postLoading.value = false;
  }
}

function reloadPostsFromFirstPage() {
  postPage.value = 0;
  refreshPosts();
}

function setBusyId(targetRef, id, busy) {
  const next = new Set(targetRef.value);
  if (busy) next.add(id);
  else next.delete(id);
  targetRef.value = next;
}

function isReviewBusy(id) {
  return reviewBusyIds.value.has(id);
}

function isPostBusy(id) {
  return postBusyIds.value.has(id);
}

async function moderateReview(id, status) {
  if (isReviewBusy(id)) return;
  setBusyId(reviewBusyIds, id, true);
  try {
    await store.updateReviewStatusAdmin(id, status);
    reviewMessage.value = status === 'approved'
      ? '评价已通过并纳入公开数据。'
      : status === 'rejected'
        ? '评价已驳回，不会对学生公开。'
        : '评价已恢复为待审核状态。';
    reviewMessageType.value = 'info';
    await refreshReviews(true);
  } catch (error) {
    reviewMessage.value = error.message;
    reviewMessageType.value = 'error';
  } finally {
    setBusyId(reviewBusyIds, id, false);
  }
}

async function moderatePost(id, status) {
  if (isPostBusy(id)) return;
  setBusyId(postBusyIds, id, true);
  try {
    const post = await store.updatePostStatusAdmin(id, status);
    const syncedReview = Boolean(post?.linkedReviewId && post.targetType === 'dish' && post.rating);
    postMessage.value = status === 'approved'
      ? (syncedReview ? '帖子已通过，关联评分已同步为正式评价。' : '帖子已通过并公开。')
      : status === 'rejected'
        ? (syncedReview ? '帖子已驳回，关联评价状态已同步。' : '帖子已驳回。')
        : '帖子已恢复为待审核状态。';
    postMessageType.value = 'info';
    await refreshPosts(true);
  } catch (error) {
    postMessage.value = error.message;
    postMessageType.value = 'error';
  } finally {
    setBusyId(postBusyIds, id, false);
  }
}

function postTargetLabel(post) {
  const targetName = post.dish?.name || post.canteen?.name || post.targetId || '关联对象未知';
  const path = post.targetType === 'dish' ? [post.canteen?.name, post.stall?.name].filter(Boolean).join(' / ') : '';
  return path ? `${targetName}（${path}）` : targetName;
}

function toggleMenuSelection(id) {
  const next = new Set(selectedMenuIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedMenuIds.value = next;
}

function toggleAllMenus() {
  if (allMenusSelected.value) {
    selectedMenuIds.value = new Set();
  } else {
    selectedMenuIds.value = new Set(store.adminMenus.map((m) => m.id));
  }
}

async function batchPublishMenus() {
  try {
    const ids = [...selectedMenuIds.value];
    if (!ids.length) return;
    await store.batchMenuAction(ids, 'publish');
    selectedMenuIds.value = new Set();
    message.value = `已批量发布 ${ids.length} 个菜单。`;
  } catch (error) {
    message.value = error.message;
  }
}

async function batchArchiveMenus() {
  try {
    const ids = [...selectedMenuIds.value];
    if (!ids.length) return;
    await store.batchMenuAction(ids, 'archive');
    selectedMenuIds.value = new Set();
    message.value = `已批量下架 ${ids.length} 个菜单。`;
  } catch (error) {
    message.value = error.message;
  }
}

async function publishSingleMenu(id) {
  try {
    await store.batchMenuAction([id], 'publish');
    message.value = '菜单已发布。';
  } catch (error) {
    message.value = error.message;
  }
}

async function publishTodayMenu() {
  try {
    const drafts = todayMenus.value.filter((m) => m.status !== 'published');
    if (!drafts.length) {
      message.value = '今日菜单均已发布。';
      return;
    }
    await store.batchMenuAction(drafts.map((m) => m.id), 'publish');
    message.value = `已发布 ${drafts.length} 个今日菜单。`;
  } catch (error) {
    message.value = error.message;
  }
}

async function refreshUsers() {
  try {
    await store.loadUsers();
    userMessage.value = '';
  } catch (error) {
    userMessage.value = error.message;
  }
}

async function changeRole(userId, newRole) {
  try {
    await store.updateUserRole(userId, newRole);
    userMessage.value = '角色已更新。';
  } catch (error) {
    userMessage.value = error.message;
  }
}

async function refreshAuditLogs() {
  try {
    await store.loadAuditLogs(auditPageSize, auditPage.value * auditPageSize);
  } catch (error) {
    userMessage.value = error.message;
  }
}

async function refreshAiSettings() {
  try {
    const result = await store.loadAiSettings();
    applyAiSettings(result.settings);
    aiTestResult.value = null;
    aiMessage.value = '';
  } catch (error) {
    aiMessage.value = error.message;
  }
}

async function saveAiProvider() {
  if (aiSaving.value || aiTesting.value || aiClearing.value) return;
  aiSaving.value = true;
  try {
    const payload = { ...aiForm, timeoutMs: assertNumber(aiForm.timeoutMs, 'AI 超时', 1000, 60000) };
    const result = await store.saveAiSettings(payload);
    applyAiSettings(result.settings);
    aiForm.apiKey = '';
    aiTestResult.value = null;
    aiMessage.value = 'AI 配置已保存；API Key 留空时会保留已有密钥。';
  } catch (error) {
    aiMessage.value = error.message;
  } finally {
    aiSaving.value = false;
  }
}

async function testAiProvider() {
  if (aiSaving.value || aiTesting.value || aiClearing.value) return;
  aiTesting.value = true;
  try {
    const result = await store.testAiSettings({ ...aiForm, timeoutMs: assertNumber(aiForm.timeoutMs, 'AI 超时', 1000, 60000) });
    aiTestResult.value = {
      success: result.ok === true || result.status === 'success',
      model: result.model || aiForm.chatModel,
      durationMs: Number.isFinite(Number(result.durationMs)) ? Number(result.durationMs) : null
    };
    aiMessage.value = '';
  } catch (error) {
    aiTestResult.value = { success: false, model: aiForm.chatModel, durationMs: null };
    aiMessage.value = compactAiError({ error: error.message });
  } finally {
    aiTesting.value = false;
  }
}

async function clearAiProvider() {
  if (aiSaving.value || aiTesting.value || aiClearing.value) return;
  const confirmed = typeof window === 'undefined' || window.confirm('确认清空管理员 AI 配置？此操作会删除已保存的 API Key；如服务器配置了环境变量，系统仍会使用环境变量。');
  if (!confirmed) return;
  aiClearing.value = true;
  try {
    const result = await store.clearAiSettings();
    applyAiSettings(result.settings);
    aiTestResult.value = null;
    aiMessage.value = result.status?.enabled
      ? '管理员 AI 配置已清空，当前继续使用服务器环境变量。'
      : '管理员 AI 配置已清空，当前使用本地回退能力。';
  } catch (error) {
    aiMessage.value = error.message;
  } finally {
    aiClearing.value = false;
  }
}

async function refreshAiUsage() {
  if (!canConfigureAi.value) return;
  try {
    await store.loadAiUsage(aiUsagePageSize, aiUsagePage.value * aiUsagePageSize);
  } catch (error) {
    aiMessage.value = error.message;
  }
}

async function refreshTenants() {
  if (!canManageTenants.value) return;
  try {
    await store.loadTenants();
    userMessage.value = '';
  } catch (error) {
    userMessage.value = error.message;
  }
}

async function saveTenant() {
  try {
    await store.saveTenant({ ...tenantForm, name: assertText(tenantForm.name, '租户名称', 2, 60), aiQuota: assertNumber(tenantForm.aiQuota, 'AI 额度', 0, 10000000), storageQuotaMb: assertNumber(tenantForm.storageQuotaMb, '存储额度', 0, 10000000) });
    Object.assign(tenantForm, defaultTenantForm());
    userMessage.value = '租户已保存。';
  } catch (error) {
    userMessage.value = error.message;
  }
}

function editTenant(tenant) {
  Object.assign(tenantForm, tenant);
}

async function refreshDatabaseOverview() {
  try { databaseOverview.value = await store.loadDatabaseOverview(); } catch { /* silent */ }
}

async function refreshMenus() {
  try {
    await store.loadMenus();
    userMessage.value = '';
  } catch (error) {
    userMessage.value = error.message;
  }
}

function addMenuItem() {
  if (!menuItemForm.dishId) return;
  const dish = store.dishes.find((item) => item.id === menuItemForm.dishId);
  menuForm.items.push({ ...menuItemForm, price: Number(menuItemForm.price || dish?.price || 0) });
  Object.assign(menuItemForm, defaultMenuItemForm());
}

async function saveMenu() {
  try {
    if (!menuForm.canteenId) throw new Error('请选择食堂。');
    await store.saveMenu({ ...menuForm, date: assertText(menuForm.date, '日期', 8, 20), mealType: assertText(menuForm.mealType, '餐段', 3, 20) });
    Object.assign(menuForm, defaultMenuForm());
    userMessage.value = '菜单已保存。';
  } catch (error) {
    userMessage.value = error.message;
  }
}

function editMenu(menu) {
  Object.assign(menuForm, { ...menu, items: menu.items.map((item) => ({ dishId: item.dishId, price: item.price, supplyLimit: item.supplyLimit, soldOut: item.soldOut })) });
}

async function archiveMenu(id) {
  try {
    await store.archiveMenu(id);
    userMessage.value = '菜单已下架。';
  } catch (error) {
    userMessage.value = error.message;
  }
}

async function scrollToRequestedPanel() {
  if (route.path !== '/admin/ai' && route.query.panel !== 'ai') return;
  await nextTick();
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  aiSection.value?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

async function refreshRetrievalIndexStatus() {
  if (!canConfigureAi.value) return;
  try {
    await store.loadRetrievalIndexStatus();
    retrievalMessage.value = '';
  } catch (error) {
    retrievalMessageType.value = 'error';
    retrievalMessage.value = error.message;
  }
}

async function runRetrievalReindex() {
  if (!canWriteDishes.value || retrievalReindexing.value) return;
  retrievalReindexing.value = true;
  retrievalMessage.value = '';
  try {
    await store.rebuildRetrievalIndex({ prune: true });
    await store.loadRetrievalIndexStatus();
    retrievalMessageType.value = 'success';
    retrievalMessage.value = '检索索引重建完成。';
  } catch (error) {
    retrievalMessageType.value = 'error';
    retrievalMessage.value = error.message;
  } finally {
    retrievalReindexing.value = false;
  }
}

async function initializeAdminPage() {
  if (!isAdmin.value) return;
  if (route.path === '/admin' && !route.query.panel) {
    await router.replace({ path: '/admin', query: { ...route.query, panel: 'reviews', tab: 'reviews' } });
  }
  if (isAiPage.value) {
    if (!canConfigureAi.value) return;
    const requestedTab = String(route.query.tab || 'provider');
    aiTab.value = ['provider', 'monitor', 'tenants'].includes(requestedTab) ? requestedTab : 'provider';
    if (aiTab.value === 'tenants' && !canManageTenants.value) aiTab.value = 'provider';
    await refreshAiSettings();
    if (aiTab.value === 'monitor') {
      await refreshAiUsage();
      await refreshRetrievalIndexStatus();
      try {
        deploymentReadiness.value = await store.loadDeploymentReadiness();
      } catch (error) {
        deploymentReadiness.value = { error: error.message };
      }
    }
    if (aiTab.value === 'tenants' && canManageTenants.value) await refreshTenants();
    await scrollToRequestedPanel();
    return;
  }
  if (isEntryPage.value) {
    initializeEntryWorkspace();
    return;
  }
  if (activePanel.value === 'data') {
    await refreshDatabaseOverview();
    return;
  }
  if (activePanel.value === 'reviews') {
    moderationTab.value = route.query.tab === 'posts' ? 'posts' : 'reviews';
    if (moderationTab.value === 'posts') await refreshPosts();
    else await refreshReviews();
  }
}

onBeforeUnmount(resetVisionImport);

onMounted(initializeAdminPage);

watch(() => [route.fullPath, store.user?.role], initializeAdminPage);

watch(() => [store.canteens.length, store.stalls.length, store.dishes.length], () => {
  if (isEntryPage.value && initializedEntryRoute.value !== currentEntryRouteKey()) initializeEntryWorkspace();
});
</script>

<style scoped>
.moderation-subtitle { margin: 0.35rem 0 0; }
.moderation-tabs { display: inline-grid; grid-template-columns: repeat(2, minmax(7rem, 1fr)); gap: 0.25rem; padding: 0.25rem; border: 1px solid rgba(31, 122, 77, .16); border-radius: 0.5rem; background: #eef5eb; }
.moderation-tabs button { min-height: 2.5rem; border: 0; border-radius: 0.375rem; background: transparent; color: var(--muted); box-shadow: none; }
.moderation-tabs button.active { background: #fff; color: var(--primary-dark); box-shadow: 0 0.1875rem 0.625rem rgba(21, 95, 59, .1); }
.moderation-filters { display: grid; grid-template-columns: repeat(5, minmax(8.5rem, 1fr)); gap: 0.75rem; align-items: end; padding: 0.875rem; border: 1px solid rgba(31, 122, 77, .12); border-radius: 0.5rem; background: rgba(242, 248, 239, .74); }
.post-filters { grid-template-columns: minmax(10rem, 15rem) auto; justify-content: start; }
.moderation-filters label { min-width: 0; }
.moderation-filters label.disabled { opacity: .52; }
.moderation-refresh { min-height: 2.75rem; align-self: end; }
.moderation-summary { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem; color: var(--muted); font-size: 0.8125rem; font-weight: 650; }
.moderation-empty { min-height: 9rem; display: grid; place-content: center; gap: 0.375rem; text-align: center; color: var(--muted); border: 1px dashed rgba(31, 122, 77, .2); border-radius: 0.5rem; background: rgba(255, 255, 255, .34); }
.moderation-empty strong { color: var(--text); }
.moderation-table table { min-width: 62rem; }
.moderation-table td { vertical-align: top; }
.moderation-content { min-width: 15rem; max-width: 26rem; white-space: normal; line-height: 1.65; }
.target-type, .target-name, .target-path { display: block; }
.target-type { color: var(--primary); font-size: 0.6875rem; font-weight: 760; }
.target-name { margin-top: 0.2rem; }
.target-path { margin-top: 0.2rem; max-width: 14rem; color: var(--muted); font-size: 0.75rem; line-height: 1.45; }
.rating-pill, .status-pill, .linked-review, .level-badge { display: inline-flex; align-items: center; min-height: 1.625rem; padding: 0.2rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: 760; white-space: nowrap; }
.rating-pill { color: #7a5200; background: #fff2c9; }
.status-pill { color: var(--muted); background: #edf1ea; }
.status-approved { color: #14623d; background: #dff3e7; }
.status-pending { color: #795500; background: #fff1c7; }
.status-rejected { color: #9a2f2f; background: #fbe1df; }
.moderation-actions { min-width: 8rem; }
.post-moderation-list { display: grid; border-top: 1px solid rgba(31, 122, 77, .12); }
.post-moderation-row { display: grid; grid-template-columns: 7rem minmax(0, 1fr) auto; gap: 1rem; align-items: start; padding: 1rem 0; border-bottom: 1px solid rgba(31, 122, 77, .12); }
.post-admin-thumb, .post-image-placeholder { width: 7rem; height: 5.25rem; border-radius: 0.375rem; }
.post-admin-thumb { object-fit: cover; }
.post-image-placeholder { display: grid; place-items: center; color: var(--muted); font-size: 0.75rem; background: rgba(31, 122, 77, .06); border: 1px dashed rgba(31, 122, 77, .16); }
.post-moderation-body { min-width: 0; }
.post-moderation-body p { margin: 0.6rem 0; line-height: 1.7; overflow-wrap: anywhere; }
.post-moderation-meta, .post-target-line { display: flex; flex-wrap: wrap; align-items: center; gap: 0.625rem; }
.post-moderation-meta span:not(.status-pill), .post-target-line { color: var(--muted); font-size: 0.8125rem; }
.post-moderation-actions { width: 7rem; display: grid; gap: 0.5rem; }
.post-moderation-actions button { width: 100%; }

.entry-workspace-header { margin-bottom: 1rem; }
.entry-task-tabs, .ai-page-tabs { display: grid; gap: 0.25rem; padding: 0.25rem; border: 1px solid rgba(31, 122, 77, .16); border-radius: 0.5rem; background: #eef5eb; }
.entry-task-tabs { grid-template-columns: repeat(5, minmax(5.5rem, 1fr)); }
.ai-page-tabs { grid-template-columns: repeat(3, minmax(8rem, 1fr)); margin-bottom: 1rem; }
.entry-task-tabs button, .ai-page-tabs button { min-height: 2.5rem; border: 0; border-radius: 0.375rem; color: var(--muted); background: transparent; box-shadow: none; }
.entry-task-tabs button.active, .ai-page-tabs button.active { color: var(--primary-dark); background: #fff; box-shadow: 0 0.1875rem 0.625rem rgba(21, 95, 59, .1); }
.entry-context-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.75rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(31, 122, 77, .12); }
.entry-context-grid label.disabled { opacity: .5; }
.entry-task-section { min-width: 0; }
.entry-dish-form { display: grid; gap: 1rem; }
.entry-field-group { min-width: 0; display: grid; gap: 0.75rem; margin: 0; padding: 1rem; border: 1px solid rgba(31, 122, 77, .13); border-radius: 0.5rem; background: rgba(250, 252, 248, .74); }
.entry-field-group legend { padding: 0 0.35rem; color: var(--primary-dark); font-size: 0.875rem; font-weight: 800; }
.nutrition-entry-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.advanced-fields, .advanced-import-card { border-top: 1px solid rgba(31, 122, 77, .12); padding-top: 0.75rem; }
.advanced-fields summary, .advanced-import-card summary { cursor: pointer; color: var(--primary-dark); font-weight: 760; }
.advanced-fields[open] summary, .advanced-import-card[open] summary { margin-bottom: 0.75rem; }
.vision-import-inline { display: grid; gap: 0.75rem; padding-top: 0.75rem; border-top: 1px solid rgba(31, 122, 77, .12); }
.vision-import-inline h3 { margin: 0.15rem 0 0; font-size: 1rem; }
.compact-vision-preview { width: min(100%, 20rem); border-radius: 0.5rem; }
.vision-suggestion { padding: 0.875rem; border-left: 3px solid #d3a12e; background: #fff9e9; }
.vision-suggestion p { margin: 0.45rem 0 0; }
.entry-save-actions { display: flex; flex-wrap: wrap; gap: 0.625rem; }
.entry-save-actions button { min-height: 2.75rem; }
.destructive-entry-action { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: 0.75rem; padding: 0.875rem; border: 1px solid rgba(154, 47, 47, .18); border-radius: 0.5rem; background: #fff7f6; }
.destructive-entry-action div { display: grid; gap: 0.2rem; }
.destructive-entry-action span { color: var(--muted); font-size: 0.8125rem; }
.advanced-import-body { display: grid; gap: 0.75rem; }
.advanced-import-body textarea { min-height: 10rem; }

.ai-page-tabs:has(button:nth-child(2):last-child) { grid-template-columns: repeat(2, minmax(8rem, 1fr)); }
.ai-test-result { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; padding: 0.75rem; border: 1px solid rgba(31, 122, 77, .13); border-radius: 0.5rem; background: rgba(242, 248, 239, .74); }
.ai-monitor-metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0.75rem; }
.ai-monitor-metrics article { min-width: 0; display: grid; gap: 0.25rem; padding: 0.875rem; border: 1px solid rgba(31, 122, 77, .12); border-radius: 0.5rem; background: rgba(250, 252, 248, .8); }
.ai-monitor-metrics strong { color: var(--primary-dark); font-size: 1.25rem; overflow-wrap: anywhere; }
.ai-monitor-metrics span { color: var(--muted); font-size: 0.75rem; }
.ai-error-summary { max-width: 18rem; white-space: normal; overflow-wrap: anywhere; }
.readiness-ok { color: #14623d; }
.readiness-warn { color: #795500; }
.readiness-error, .readiness-unknown { color: #9a2f2f; }

.data-overview-bar { margin-bottom: 1rem; }
.compact-summary { flex-wrap: wrap; justify-content: flex-end; }
.compact-summary .summary-item { min-width: 6.5rem; padding: 0.65rem 1rem; border-radius: 0.5rem; }
.compact-summary .summary-item strong { font-size: 1.35rem; }
.region-management-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; align-items: start; }
.region-management-card { min-width: 0; display: grid; gap: 0.875rem; border-radius: 0.5rem; }
.region-card-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.region-card-heading h2 { margin: 0.15rem 0 0.25rem; font-family: var(--font-display); font-size: 1.35rem; }
.region-card-heading p { margin: 0; color: var(--muted); font-size: 0.8125rem; }
.region-card-heading .region-position { color: var(--primary); font-size: 0.6875rem; font-weight: 800; }
.region-add-button { flex: 0 0 2.5rem; width: 2.5rem; height: 2.5rem; display: grid; place-items: center; padding: 0; border-radius: 0.5rem; font-size: 1.35rem; line-height: 1; }
.region-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }
.region-stats span { min-width: 0; padding: 0.5rem; text-align: center; color: var(--muted); font-size: 0.75rem; background: rgba(31, 122, 77, .055); border-radius: 0.375rem; }
.region-stats strong { display: block; color: var(--primary-dark); font-size: 1rem; }
.region-search input { width: 100%; }
.region-empty-state { min-height: 8rem; display: grid; place-content: center; gap: 0.3rem; text-align: center; color: var(--muted); border: 1px dashed rgba(31, 122, 77, .2); border-radius: 0.5rem; }
.region-empty-state strong { color: var(--text); }
.region-hierarchy { min-width: 0; display: grid; gap: 0.625rem; }
.hierarchy-canteen { min-width: 0; border: 1px solid rgba(31, 122, 77, .13); border-radius: 0.5rem; overflow: hidden; background: rgba(255, 255, 255, .38); }
.hierarchy-row { min-width: 0; display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem; }
.canteen-hierarchy-row { background: rgba(31, 122, 77, .07); }
.stall-hierarchy-row { background: rgba(255, 255, 255, .5); }
.child-stall-row { background: rgba(246, 250, 243, .7); }
.hierarchy-main { min-width: 0; flex: 1; display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem; border: 0; border-radius: 0.375rem; color: var(--text); text-align: left; background: transparent; box-shadow: none; }
.hierarchy-main:hover:not(:disabled) { transform: none; background: rgba(255, 255, 255, .52); }
.hierarchy-copy { min-width: 0; flex: 1; display: grid; gap: 0.1rem; }
.hierarchy-copy strong, .hierarchy-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hierarchy-copy small { color: var(--muted); font-size: 0.6875rem; font-weight: 500; }
.hierarchy-count { color: var(--muted); font-size: 0.6875rem; font-weight: 650; white-space: nowrap; }
.hierarchy-actions { flex: 0 0 auto; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.25rem; }
.hierarchy-actions button, .dish-hierarchy-row button { min-height: 1.875rem; padding: 0.25rem 0.45rem; border: 1px solid rgba(31, 122, 77, .15); border-radius: 0.375rem; color: var(--primary-dark); font-size: 0.6875rem; background: rgba(255, 255, 255, .72); box-shadow: none; }
.hierarchy-actions button:hover:not(:disabled), .dish-hierarchy-row button:hover:not(:disabled) { transform: none; border-color: rgba(31, 122, 77, .32); }
.hierarchy-children { padding: 0.5rem 0.5rem 0.625rem 1rem; border-left: 2px solid rgba(31, 122, 77, .13); }
.hierarchy-stall + .hierarchy-stall { margin-top: 0.35rem; }
.stall-contents { margin-left: 1.25rem; padding: 0.35rem 0 0.5rem 0.75rem; border-left: 2px solid rgba(31, 122, 77, .1); }
.hierarchy-group-label { margin: 0.3rem 0; color: var(--muted); font-size: 0.6875rem; font-weight: 800; }
.level-badge { min-height: 1.4rem; color: var(--primary-dark); background: #e1f0dd; }
.level-badge.child { color: #5e4c10; background: #f4edcf; }
.child-stall-node + .child-stall-node { margin-top: 0.25rem; }
.child-dishes { margin-left: 1.25rem; }
.dish-hierarchy-row { display: grid; grid-template-columns: minmax(6rem, 1fr) minmax(4rem, auto) auto auto; gap: 0.5rem; align-items: center; min-height: 2.5rem; padding: 0.35rem 0.5rem; color: var(--muted); font-size: 0.75rem; border-bottom: 1px solid rgba(31, 122, 77, .08); }
.dish-hierarchy-row:last-child { border-bottom: 0; }
.dish-hierarchy-row .dish-name { min-width: 0; overflow: hidden; color: var(--text); font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
.dish-hierarchy-row strong { color: var(--primary-dark); white-space: nowrap; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 1100px) {
  .moderation-filters { grid-template-columns: repeat(3, minmax(8rem, 1fr)); }
  .entry-context-grid, .nutrition-entry-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ai-monitor-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .hierarchy-row { align-items: flex-start; flex-wrap: wrap; }
  .hierarchy-actions { width: 100%; padding-left: 1.75rem; justify-content: flex-start; }
}

@media (max-width: 720px) {
  .moderation-tabs, .region-management-grid { width: 100%; grid-template-columns: 1fr; }
  .moderation-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .entry-task-tabs, .ai-page-tabs, .ai-page-tabs:has(button:nth-child(2):last-child), .entry-context-grid, .nutrition-entry-grid, .ai-monitor-metrics { width: 100%; grid-template-columns: 1fr; }
  .moderation-filters, .post-filters { grid-template-columns: 1fr; }
  .moderation-refresh { width: 100%; }
  .post-moderation-row { grid-template-columns: 1fr; }
  .post-admin-thumb, .post-image-placeholder { width: 100%; height: auto; aspect-ratio: 16 / 9; }
  .post-moderation-actions { width: 100%; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .moderation-table,
  .ai-usage-table { overflow: visible; border: 0; }
  .moderation-table table,
  .ai-usage-table table,
  .moderation-table tbody,
  .ai-usage-table tbody,
  .moderation-table tr,
  .ai-usage-table tr,
  .moderation-table td,
  .ai-usage-table td { display: block; width: 100%; min-width: 0; }
  .moderation-table table,
  .ai-usage-table table { min-width: 0; }
  .moderation-table thead,
  .ai-usage-table thead { display: none; }
  .moderation-table tr,
  .ai-usage-table tr { padding: 0.5rem 0; border-bottom: 1px solid rgba(31, 122, 77, .13); }
  .moderation-table td,
  .ai-usage-table td {
    position: relative;
    max-width: none;
    min-height: 2.5rem;
    padding: 0.5rem 0 0.5rem 7rem !important;
    border: 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .moderation-table td::before,
  .ai-usage-table td::before {
    content: attr(data-label);
    position: absolute;
    top: 0.5rem;
    left: 0;
    width: 6.25rem;
    color: var(--muted);
    font-size: 0.6875rem;
    font-weight: 800;
  }
  .moderation-actions { min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .moderation-actions button { width: 100%; min-height: 2.75rem; }
  .ai-error-summary { max-width: none; word-break: break-word; }
  .compact-summary { justify-content: stretch; }
  .compact-summary .summary-item { flex: 1 1 calc(50% - 0.5rem); }
  .hierarchy-count { width: 100%; padding-left: 1.8rem; }
  .dish-hierarchy-row { grid-template-columns: minmax(0, 1fr) auto; }
  .dish-hierarchy-row > :nth-child(2) { display: none; }
  .entry-save-actions, .destructive-entry-action { align-items: stretch; flex-direction: column; }
  .entry-save-actions button, .destructive-entry-action button { width: 100%; }
}

@media (max-width: 1020px) {
  :global(.shell:has(.moderation-workspace) > .mobile-nav-toggle),
  :global(.shell:has(.region-management-grid) > .mobile-nav-toggle),
  :global(.shell:has(.entry-workspace-header) > .mobile-nav-toggle),
  :global(.shell:has(.ai-page-tabs) > .mobile-nav-toggle),
  :global(.shell:has(.agent-view) > .mobile-nav-toggle) {
    position: relative;
    top: auto;
    min-height: 2.75rem;
    height: 2.75rem;
    margin-bottom: 0;
    border-radius: 0.5rem;
    white-space: nowrap;
  }
}

@media (prefers-reduced-motion: reduce) {
  .moderation-workspace *, .region-management-grid *, .entry-workspace-header *, .entry-task-section *, .ai-page-tabs *, .ai-test-result * { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
</style>
