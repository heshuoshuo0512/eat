<template>
  <section ref="pageElement" class="catalog-page" :aria-busy="loading || refreshing">
    <header class="catalog-toolbar">
      <div class="catalog-heading">
        <p class="catalog-eyebrow">数据中心 / 餐饮目录</p>
        <div class="catalog-title-row">
          <h1>餐饮目录管理</h1>
          <span class="tenant-badge">{{ tenantLabel }}</span>
        </div>
      </div>

      <form class="catalog-search" role="search" @submit.prevent="applySearch">
        <label class="sr-only" for="catalog-search-input">搜索餐饮目录</label>
        <span class="search-icon" aria-hidden="true"></span>
        <input
          id="catalog-search-input"
          v-model.trim="searchTerm"
          type="search"
          autocomplete="off"
          placeholder="搜索餐饮分区、档口或菜品"
          @input="queueSearch"
        />
        <button v-if="searchTerm" class="clear-search" type="button" title="清除搜索" aria-label="清除搜索" @click="clearSearch">×</button>
      </form>

      <div class="catalog-toolbar-actions">
        <button v-if="canReviewIntroductions" class="tool-button" type="button" @click="toggleIntroductionPanel">
          <span aria-hidden="true">文</span><span>介绍审核</span>
        </button>
        <button class="tool-button" type="button" :disabled="refreshing" title="刷新目录" @click="refreshTree">
          <span class="refresh-symbol" :class="{ spinning: refreshing }" aria-hidden="true">↻</span>
          <span>刷新</span>
        </button>
        <button v-if="canBulkImportDishes" class="tool-button" type="button" @click="openImport">
          <span aria-hidden="true">⇧</span><span>批量导入</span>
        </button>
        <button v-if="(canWriteCanteens || canWriteStalls) && activeVenue" class="tool-button primary-action" type="button" @click="handlePrimaryVenueAction">
          <span aria-hidden="true">{{ activeVenue.missing ? '⌂' : '＋' }}</span><span>{{ activeVenue.missing ? '配置餐饮场所' : `新增${activeVenue.areaLabel}` }}</span>
        </button>
      </div>
    </header>

    <div v-if="errorMessage" class="catalog-notice error" role="alert">
      <span>{{ errorMessage }}</span>
      <button type="button" @click="refreshTree">重试</button>
    </div>
    <div v-else-if="successMessage" class="catalog-notice success" role="status">{{ successMessage }}</div>

    <section v-if="introductionPanelOpen" class="introduction-review" aria-label="目录介绍审核">
      <header class="introduction-review-head">
        <div><p class="catalog-eyebrow">AI目录整理 / 人工审核</p><h2>分层介绍审核</h2></div>
        <button class="icon-action" type="button" @click="introductionPanelOpen=false">关闭</button>
      </header>
      <div class="introduction-filters">
        <label>批次<select v-model="selectedIntroductionBatch" @change="loadIntroductions(0)"><option value="">选择批次</option><option v-for="batch in introductionBatches" :key="batch.id" :value="batch.id">{{ batch.id }} · {{ batch.status }} · {{ batch.completedCount }}/{{ batch.entityCount }}</option></select></label>
        <label>实体<select v-model="introductionFilters.entityType" @change="loadIntroductions(0)"><option value="">全部</option><option value="dish">菜品</option><option value="stall">档口</option><option value="canteen">餐厅/食堂</option></select></label>
        <label>状态<select v-model="introductionFilters.status" @change="loadIntroductions(0)"><option value="">全部</option><option value="schema_validated">待审核</option><option value="approved">已批准</option><option value="rejected">已拒绝</option></select></label>
        <label>搜索<input v-model.trim="introductionFilters.q" type="search" @keyup.enter="loadIntroductions(0)" /></label>
        <button type="button" :disabled="introductionLoading" @click="loadIntroductions(0)">查询</button>
        <button v-if="canApproveIntroductionBatch&&selectedIntroductionBatch" type="button" @click="previewIntroductionApproval">整批批准预览</button>
        <button v-if="canRollbackIntroductionBatch" type="button" @click="prepareIntroductionRollback">整批回滚</button>
      </div>
      <div v-if="introductionPreview" class="introduction-preview">
        <p>候选 {{ introductionPreview.candidateCount }}/{{ introductionPreview.entityCount }} · 缺失 {{ introductionPreview.missingCount }} · 过期 {{ introductionPreview.staleCount }} · 无效 {{ introductionPreview.invalidCount }} · 低置信 {{ introductionPreview.lowConfidenceCount }}</p>
        <label>确认文字<input v-model="introductionConfirmation" :placeholder="introductionPreview.requiredConfirmation" /></label>
        <button type="button" :disabled="!introductionPreview.approvable||introductionConfirmation!==introductionPreview.requiredConfirmation" @click="approveIntroductionBatch">批准全校介绍</button>
      </div>
      <div v-if="introductionRollback" class="introduction-preview">
        <p>回滚后将停用本批介绍，并恢复各实体上一版已批准介绍。</p>
        <label>确认文字<input v-model="introductionRollbackConfirmation" :placeholder="introductionRollback.requiredConfirmation" /></label>
        <button type="button" :disabled="introductionRollbackConfirmation!==introductionRollback.requiredConfirmation" @click="rollbackIntroductionBatch">确认整批回滚</button>
      </div>
      <p v-if="introductionMessage" class="catalog-notice" role="status">{{ introductionMessage }}</p>
      <div v-if="introductionLoading" class="catalog-loading"><span v-for="index in 4" :key="index"></span></div>
      <div v-else class="introduction-table">
        <article v-for="item in introductionItems" :key="item.id" class="introduction-row">
          <header><strong>{{ introductionEntityLabel(item) }} · {{ item.entityId }}</strong><span :class="['venue-status',item.status==='approved'?'active':item.status==='rejected'?'inactive':'renovating']">{{ item.status }}</span></header>
          <label>目录事实摘要<textarea v-model="item.factualSummary" maxlength="720" /></label>
          <label>推测性推荐文案<textarea v-model="item.recommendationCopy" maxlength="540" /></label>
          <p class="introduction-meta">置信度 {{ item.confidence.level }} {{ Math.round(item.confidence.score*100) }}% · {{ item.evidenceIds.length }} 条证据 · {{ item.boundaryCodes.join(' / ') }}</p>
          <div class="introduction-actions"><button type="button" @click="saveIntroduction(item,'schema_validated')">保存</button><button type="button" @click="saveIntroduction(item,'approved')">批准</button><button type="button" @click="saveIntroduction(item,'rejected')">拒绝</button></div>
        </article>
        <p v-if="!introductionItems.length" class="inline-empty">该筛选条件下没有介绍候选。</p>
      </div>
      <footer v-if="introductionTotal>introductionLimit" class="introduction-pagination"><button type="button" :disabled="introductionOffset===0" @click="loadIntroductions(Math.max(0,introductionOffset-introductionLimit))">上一页</button><span>{{ introductionOffset+1 }}-{{ Math.min(introductionOffset+introductionItems.length,introductionTotal) }} / {{ introductionTotal }}</span><button type="button" :disabled="introductionOffset+introductionLimit>=introductionTotal" @click="loadIntroductions(introductionOffset+introductionLimit)">下一页</button></footer>
    </section>

    <div v-if="loading && !venues.length" class="venue-grid loading-grid" aria-label="正在加载真实餐饮目录">
      <article v-for="index in 2" :key="index" class="venue-panel venue-panel-placeholder">
        <div class="catalog-loading"><span v-for="row in 6" :key="row"></span></div>
      </article>
    </div>

    <div v-else class="venue-grid">
      <article
        v-for="venue in venues"
        :key="venue.id"
        class="venue-panel"
        :class="[{ selected: selectedVenueId === venue.id, missing: venue.missing }, nodeClasses('venue', venue.id)]"
        :data-position="venue.position"
        :data-venue-id="venue.id"
        :data-node-key="`venue:${venue.id}`"
      >
        <header class="venue-panel-header">
          <div class="venue-heading-row">
            <button class="venue-identity" type="button" @click="openVenue(venue, 'view')">
              <span class="venue-index" aria-hidden="true">{{ venueIndex(venue.id) }}</span>
              <span>
                <strong><HighlightText :text="venue.displayName || venue.name" :query="searchTerm" /></strong>
                <small>{{ venueTypeLabel(venue) }} · {{ venue.region?.location || venue.defaultName || '待配置' }}</small>
              </span>
            </button>
            <div class="venue-header-actions">
              <span :class="['venue-status', venue.missing ? 'inactive' : venue.operatingStatus === 'renovating' ? 'renovating' : venue.operatingStatus === 'closed' ? 'inactive' : 'active']">{{ venue.missing ? '未配置' : venue.operatingStatus === 'renovating' ? '装修中' : venue.operatingStatus === 'closed' ? '已关闭' : '已启用' }}</span>
              <button v-if="canWriteCanteens && !venue.missing" class="icon-action" type="button" title="编辑餐饮场所" aria-label="编辑餐饮场所" @click="openVenue(venue, 'edit')">编辑</button>
              <button v-else-if="canWriteCanteens" class="icon-action" type="button" title="配置餐饮场所" @click="openVenue(venue, 'create')">配置</button>
            </div>
          </div>

          <div class="venue-summary" aria-label="场所数据统计">
            <span v-if="!venue.supportsDirectStalls"><b>{{ venue.counts?.canteens || 0 }}</b>{{ venue.areaLabel }}</span>
            <span><b>{{ venue.counts?.stalls || 0 }}</b>档口</span>
            <span><b>{{ venue.counts?.dishes || 0 }}</b>菜品</span>
            <span><b>{{ venue.counts?.openStalls || 0 }}</b>营业档口</span>
          </div>

          <div class="venue-view-switch" role="tablist" :aria-label="`${venue.name}视图`">
            <button
              type="button"
              role="tab"
              :id="`venue-${venue.id}-directory-tab`"
              :aria-controls="`venue-${venue.id}-panel`"
              :aria-selected="modeByVenue[venue.id] === 'directory'"
              :class="{ active: modeByVenue[venue.id] === 'directory' }"
              @click="setVenueMode(venue.id, 'directory')"
            >目录</button>
            <button
              v-if="!venue.missing"
              type="button"
              role="tab"
              :id="`venue-${venue.id}-stats-tab`"
              :aria-controls="`venue-${venue.id}-panel`"
              :aria-selected="modeByVenue[venue.id] === 'stats'"
              :class="{ active: modeByVenue[venue.id] === 'stats' }"
              @click="setVenueMode(venue.id, 'stats')"
            >统计</button>
            <button
              v-if="(venue.supportsDirectStalls ? canWriteStalls : canWriteCanteens) && !venue.missing"
              class="add-area-button"
              type="button"
              @click="venue.supportsDirectStalls ? openNewDirectStall(venue) : openNewArea(venue)"
            >＋ {{ venue.areaLabel }}</button>
          </div>
        </header>

        <div
          :ref="(element) => registerScrollElement(venue.id, element)"
          class="venue-panel-scroll"
          :id="`venue-${venue.id}-panel`"
          role="tabpanel"
          :aria-labelledby="`venue-${venue.id}-${modeByVenue[venue.id] === 'stats' ? 'stats' : 'directory'}-tab`"
          tabindex="0"
          @scroll.passive="rememberScroll(venue.id, $event)"
        >
          <div v-if="loading" class="catalog-loading" aria-label="正在加载目录">
            <span v-for="index in 5" :key="index"></span>
          </div>

          <template v-else-if="venue.missing">
            <div class="catalog-empty">
              <span class="empty-symbol" aria-hidden="true">＋</span>
              <strong>该餐饮场所尚未配置</strong>
              <span>{{ venue.name }}</span>
              <button v-if="canWriteCanteens" type="button" @click="openVenue(venue, 'create')">配置场所</button>
            </div>
          </template>

          <template v-else-if="modeByVenue[venue.id] === 'stats'">
            <section class="venue-stats-view">
              <div class="stats-total-line">
                <div><strong>{{ venue.counts?.canteens || 0 }}</strong><span>{{ venue.areaLabel }}</span></div>
                <div><strong>{{ venue.counts?.stalls || 0 }}</strong><span>档口总数</span></div>
                <div><strong>{{ venue.counts?.dishes || 0 }}</strong><span>菜品总数</span></div>
                <div><strong>{{ venue.counts?.openStalls || 0 }}</strong><span>营业档口</span></div>
              </div>

              <div v-if="visibleAreas(venue).length" class="area-chart" aria-label="餐饮分区档口与菜品对比">
                <button
                  v-for="areaNode in visibleAreas(venue)"
                  :key="areaNode.canteen.id"
                  class="chart-row"
                  type="button"
                  @click="locateArea(venue, areaNode)"
                >
                  <span class="chart-label"><b>{{ areaNode.canteen.name }}</b><small>{{ areaNode.openStallCount || 0 }}/{{ areaNode.stallCount || 0 }} 档口营业</small></span>
                  <span class="chart-bars">
                    <span class="bar-line"><i class="bar stalls" :style="{ width: chartWidth(areaNode.stallCount, maxAreaCount(venue, 'stallCount')) }"></i><em>{{ areaNode.stallCount || 0 }} 档口</em></span>
                    <span class="bar-line"><i class="bar dishes" :style="{ width: chartWidth(areaNode.dishCount, maxAreaCount(venue, 'dishCount')) }"></i><em>{{ areaNode.dishCount || 0 }} 菜品</em></span>
                  </span>
                  <span class="chart-arrow" aria-hidden="true">›</span>
                </button>
              </div>
              <div v-else class="catalog-empty compact">
                <strong>暂无可统计的{{ venue.areaLabel }}</strong>
                <button v-if="canWriteCanteens && !venue.missing" type="button" @click="openNewArea(venue)">新增{{ venue.areaLabel }}</button>
              </div>

              <div class="chart-legend" aria-label="图例"><span><i class="legend-stalls"></i>档口</span><span><i class="legend-dishes"></i>菜品</span></div>
            </section>
          </template>

          <template v-else-if="visibleAreas(venue).length || visibleDirectStalls(venue).length">
            <section
              v-for="areaNode in visibleAreas(venue)"
              :key="areaNode.canteen.id"
              :ref="(element) => registerAreaElement(areaNode.canteen.id, element)"
              class="area-section"
              :class="nodeClasses('area', areaNode.canteen.id)"
              :data-node-key="`area:${areaNode.canteen.id}`"
            >
              <header class="area-header">
                <button
                  class="disclosure-button"
                  type="button"
                  :aria-expanded="isAreaExpanded(areaNode.canteen.id)"
                  :aria-label="`${isAreaExpanded(areaNode.canteen.id) ? '收起' : '展开'}${areaNode.canteen.name}`"
                  @click="toggleArea(venue, areaNode.canteen.id)"
                ><span :class="{ expanded: isAreaExpanded(areaNode.canteen.id) }" aria-hidden="true">›</span></button>
                <button class="area-title" type="button" @click="openArea(venue, areaNode, 'view')">
                  <strong><HighlightText :text="areaNode.displayName || areaNode.canteen.displayName || areaNode.canteen.name" :query="searchTerm" /></strong>
                  <small>{{ areaNode.stallCount || 0 }} 档口 · {{ areaNode.dishCount || 0 }} 菜品 · {{ areaNode.openStallCount || 0 }} 营业</small>
                </button>
                <span :class="['operation-state', areaOperating(areaNode) ? 'open' : 'closed']">{{ areaOperating(areaNode) ? '营业' : '暂停' }}</span>
                <div class="area-actions">
                  <button v-if="canWriteCanteens" type="button" @click="openArea(venue, areaNode, 'edit')">编辑</button>
                  <button v-if="canWriteStalls" type="button" @click="openNewStall(venue, areaNode)">＋ 档口</button>
                </div>
              </header>

              <div v-if="isAreaExpanded(areaNode.canteen.id)" class="area-content">
                <div v-if="isAreaLoading(areaNode.canteen.id)" class="catalog-loading area-loading" aria-label="正在加载菜品">
                  <span v-for="index in 3" :key="index"></span>
                </div>
                <div v-else-if="displayedStalls(areaNode).length" class="stall-table" role="table" :aria-label="`${areaNode.canteen.name}档口目录`">
                  <div class="stall-table-heading" role="row">
                    <span role="columnheader">档口</span><span role="columnheader">品类</span><span role="columnheader">状态</span><span role="columnheader">菜品 / 均价</span><span role="columnheader">操作</span>
                  </div>

                  <div
                    v-for="row in displayedStalls(areaNode)"
                    :key="row.node.stall.id"
                    class="stall-block"
                    :class="nodeClasses('stall', row.node.stall.id)"
                    :data-node-key="`stall:${row.node.stall.id}`"
                  >
                    <div class="stall-table-row" role="row" :class="{ legacy: row.depth > 0, expanded: isStallExpanded(areaNode.canteen.id, row.node.stall.id) }">
                      <button
                        class="stall-disclosure"
                        type="button"
                        :aria-expanded="isStallExpanded(areaNode.canteen.id, row.node.stall.id)"
                        :aria-label="`${isStallExpanded(areaNode.canteen.id, row.node.stall.id) ? '收起' : '展开'}${row.node.stall.name}菜品`"
                        @click="toggleStall(areaNode.canteen.id, row.node, { venueId: venue.id, areaId: areaNode.canteen.id })"
                      ><span :class="{ expanded: isStallExpanded(areaNode.canteen.id, row.node.stall.id) }" aria-hidden="true">›</span></button>
                      <button class="stall-name-cell" type="button" role="cell" @click="openStall(venue, areaNode, row.node, 'view')">
                        <span v-if="row.depth" class="tree-branch" aria-hidden="true">└</span>
                        <span><strong><HighlightText :text="row.node.stall.name" :query="searchTerm" /></strong><small>{{ row.node.stall.floor || '楼层未设置' }}<em v-if="row.node.legacyHierarchy">历史层级</em></small></span>
                      </button>
                      <span class="stall-category" role="cell"><HighlightText :text="row.node.stall.category || '未分类'" :query="searchTerm" /></span>
                      <span role="cell"><i :class="['status-dot', row.node.stall.open ? 'open' : 'closed']"></i>{{ row.node.stall.open ? '营业中' : '已暂停' }}</span>
                      <span role="cell"><b>{{ row.node.dishCount || 0 }}</b> 道 · ¥{{ formatPrice(row.node.stall.avgPrice) }}</span>
                      <span class="stall-actions" role="cell">
                        <button type="button" @click="openStall(venue, areaNode, row.node, 'view')">查看</button>
                        <button v-if="canWriteStalls" type="button" @click="openStall(venue, areaNode, row.node, 'edit')">{{ row.node.legacyHierarchy ? '迁移' : '编辑' }}</button>
                        <button v-if="canWriteDishes && !row.node.legacyHierarchy" type="button" @click="openNewDish(venue, areaNode, row.node)">＋ 菜品</button>
                      </span>
                    </div>

                    <div v-if="isStallExpanded(areaNode.canteen.id, row.node.stall.id)" class="dish-rows">
                      <div v-if="isStallLoading(row.node.stall.id) && !stallDishes(row.node.stall.id).length" class="catalog-loading stall-loading" aria-label="正在加载档口菜品">
                        <span v-for="index in 3" :key="index"></span>
                      </div>
                      <div
                        v-for="dish in stallDishes(row.node.stall.id)"
                        :key="dish.id"
                        class="dish-table-row"
                        :class="nodeClasses('dish', dish.id)"
                        :data-node-key="`dish:${dish.id}`"
                      >
                        <button class="dish-name" type="button" @click="openDish(venue, areaNode, row.node, dish, 'view')">
                          <span class="dish-thumb" aria-hidden="true">
                            <span>{{ dish.image || '餐' }}</span>
                            <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="'dish thumbnail'" loading="lazy" @error="$event.currentTarget.hidden = true" />
                          </span>
                          <span>
                            <strong><HighlightText :text="dish.name" :query="searchTerm" /></strong>
                            <small><HighlightText :text="dishMeta(dish)" :query="searchTerm" /></small>
                            <small v-if="dishSearchDetail(dish)" class="dish-search-match">命中：<HighlightText :text="dishSearchDetail(dish)" :query="searchTerm" /></small>
                          </span>
                        </button>
                        <span class="dish-price">{{ dishPriceText(dish) }}</span>
                        <span :class="['dish-state', dish.status === 'hidden' ? 'hidden' : 'active']">{{ dish.status === 'hidden' ? '已隐藏' : '上架中' }}</span>
                        <span class="dish-actions">
                          <button type="button" @click="openDish(venue, areaNode, row.node, dish, 'view')">查看</button>
                          <button v-if="canWriteDishes" type="button" @click="openDish(venue, areaNode, row.node, dish, 'edit')">编辑</button>
                        </span>
                      </div>
                      <button
                        v-if="stallDishPage(row.node.stall.id).hasMore"
                        class="stall-load-more"
                        type="button"
                        :disabled="isStallLoading(row.node.stall.id)"
                        @click="loadMoreStallDishes(row.node)"
                      >{{ isStallLoading(row.node.stall.id) ? '加载中…' : `加载更多（已显示 ${stallDishes(row.node.stall.id).length}/${stallDishPage(row.node.stall.id).total}）` }}</button>
                      <div v-if="!isStallLoading(row.node.stall.id) && !stallDishes(row.node.stall.id).length" class="inline-empty">
                        <span>{{ searchTerm ? '该档口没有匹配菜品' : '暂无菜品' }}</span>
                        <button v-if="canWriteDishes && !row.node.legacyHierarchy && !searchTerm" type="button" @click="openNewDish(venue, areaNode, row.node)">＋ 添加菜品</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div v-else class="inline-empty roomy">
                  <span>{{ searchTerm ? '该餐饮分区没有匹配结果' : `该${venue.areaLabel}暂无档口` }}</span>
                  <button v-if="canWriteStalls && !searchTerm" type="button" @click="openNewStall(venue, areaNode)">＋ 添加档口</button>
                </div>
              </div>
            </section>

            <section v-if="visibleDirectStalls(venue).length" class="area-section direct-stalls-section">
              <header class="area-header">
                <div class="area-title static"><strong>档口</strong><small>{{ visibleDirectStalls(venue).length }} 个直属档口</small></div>
                <button v-if="canWriteStalls && venue.supportsDirectStalls" class="area-add-stall" type="button" @click="openNewDirectStall(venue)">＋ 添加档口</button>
              </header>
              <div class="area-content">
                <div class="stall-table direct-stalls-table" role="table" aria-label="直属档口">
                  <div
                    v-for="row in displayedDirectStalls(venue)"
                    :key="row.node.stall.id"
                    class="stall-block"
                    :class="nodeClasses('stall', row.node.stall.id)"
                    :data-node-key="`stall:${row.node.stall.id}`"
                  >
                    <div class="stall-table-row" role="row" :class="{ expanded: isStallExpanded(`venue:${venue.id}`, row.node.stall.id) }">
                      <button
                        class="stall-disclosure"
                        type="button"
                        :aria-expanded="isStallExpanded(`venue:${venue.id}`, row.node.stall.id)"
                        :aria-label="`${isStallExpanded(`venue:${venue.id}`, row.node.stall.id) ? '收起' : '展开'}${row.node.stall.name}菜品`"
                        @click="toggleStall(`venue:${venue.id}`, row.node, { venueId: venue.id })"
                      ><span :class="{ expanded: isStallExpanded(`venue:${venue.id}`, row.node.stall.id) }" aria-hidden="true">›</span></button>
                      <button class="stall-name-cell" type="button" role="cell" @click="openDirectStall(venue, row.node, 'view')">
                        <span><strong><HighlightText :text="row.node.stall.name" :query="searchTerm" /></strong><small>{{ row.node.stall.category || '未分类' }}</small></span>
                      </button>
                      <span role="cell">{{ row.node.stall.floor || '楼层未设置' }}</span>
                      <span role="cell"><i :class="['status-dot', row.node.stall.open ? 'open' : 'closed']"></i>{{ row.node.stall.open ? '营业中' : '暂停' }}</span>
                      <span role="cell">{{ row.node.dishCount || 0 }} 道菜品</span>
                      <span class="stall-actions" role="cell">
                        <button type="button" @click="openDirectStall(venue, row.node, 'view')">查看</button>
                        <button v-if="canWriteStalls" type="button" @click="openDirectStall(venue, row.node, 'edit')">编辑</button>
                      </span>
                    </div>
                    <div v-if="isStallExpanded(`venue:${venue.id}`, row.node.stall.id)" class="dish-rows">
                      <div v-if="isStallLoading(row.node.stall.id) && !stallDishes(row.node.stall.id).length" class="catalog-loading stall-loading" aria-label="正在加载档口菜品">
                        <span v-for="index in 3" :key="index"></span>
                      </div>
                      <div
                        v-for="dish in stallDishes(row.node.stall.id)"
                        :key="dish.id"
                        class="dish-table-row"
                        :class="nodeClasses('dish', dish.id)"
                        :data-node-key="`dish:${dish.id}`"
                      >
                        <button class="dish-name" type="button" @click="openDirectDish(venue, row.node, dish, 'view')">
                          <span class="dish-thumb" aria-hidden="true">
                            <span>{{ dish.image || '餐' }}</span>
                            <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="'dish thumbnail'" loading="lazy" @error="$event.currentTarget.hidden = true" />
                          </span>
                          <span>
                            <strong><HighlightText :text="dish.name" :query="searchTerm" /></strong>
                            <small><HighlightText :text="dishMeta(dish)" :query="searchTerm" /></small>
                            <small v-if="dishSearchDetail(dish)" class="dish-search-match">命中：<HighlightText :text="dishSearchDetail(dish)" :query="searchTerm" /></small>
                          </span>
                        </button>
                        <span class="dish-price">{{ dishPriceText(dish) }}</span>
                        <span :class="['dish-state', dish.status === 'hidden' ? 'hidden' : 'active']">{{ dish.status === 'hidden' ? '已隐藏' : '上架中' }}</span>
                        <span class="dish-actions">
                          <button type="button" @click="openDirectDish(venue, row.node, dish, 'view')">查看</button>
                          <button v-if="canWriteDishes" type="button" @click="openDirectDish(venue, row.node, dish, 'edit')">编辑</button>
                        </span>
                      </div>
                      <button v-if="stallDishPage(row.node.stall.id).hasMore" class="stall-load-more" type="button" :disabled="isStallLoading(row.node.stall.id)" @click="loadMoreStallDishes(row.node)">{{ isStallLoading(row.node.stall.id) ? '加载中…' : `加载更多（已显示 ${stallDishes(row.node.stall.id).length}/${stallDishPage(row.node.stall.id).total}）` }}</button>
                      <div v-if="!isStallLoading(row.node.stall.id) && !stallDishes(row.node.stall.id).length" class="inline-empty"><span>{{ searchTerm ? '该档口没有匹配菜品' : '暂无菜品' }}</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </template>

          <div v-else class="catalog-empty compact">
            <strong>{{ searchTerm ? '没有匹配的目录内容' : `暂无${venue.areaLabel}` }}</strong>
            <span v-if="searchTerm">“{{ searchTerm }}”</span>
            <button v-if="searchTerm" type="button" @click="clearSearch">清除搜索</button>
            <button v-else-if="venue.supportsDirectStalls ? canWriteStalls : canWriteCanteens" type="button" @click="venue.supportsDirectStalls ? openNewDirectStall(venue) : openNewArea(venue)">新增{{ venue.areaLabel }}</button>
          </div>
        </div>
      </article>
    </div>

    <CatalogEditorDrawer
      ref="drawerRef"
      :open="Boolean(drawerDescriptor)"
      :descriptor="drawerDescriptor"
      :areas="allAreas"
      :stalls="allStalls"
      @close="closeDrawer"
      @edit="editDrawerNode"
      @saved="handleSaved"
    />
  </section>
</template>

<script setup>
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import CatalogEditorDrawer from '../components/CatalogEditorDrawer.vue';
import { dishPriceText } from '../domain/dishPresentation.js';
import { apiClient } from '../services/apiClient.js';
import { useCanteenStore } from '../stores/canteenStore.js';

const HighlightText = defineComponent({
  name: 'HighlightText',
  props: { text: { type: [String, Number], default: '' }, query: { type: String, default: '' } },
  setup(props) {
    return () => {
      const value = String(props.text || '');
      const query = String(props.query || '').trim();
      const index = query ? value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
      if (index < 0) return value;
      return [value.slice(0, index), h('mark', value.slice(index, index + query.length)), value.slice(index + query.length)];
    };
  }
});

const store = useCanteenStore();
const route = useRoute();
const router = useRouter();
const pageElement = ref(null);
const drawerRef = ref(null);
const drawerDescriptor = ref(null);
const loading = ref(true);
const refreshing = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const searchTerm = ref(String(route.query.q || ''));
const expandedAreas = ref(new Set());
const loadingAreas = ref(new Set());
const expandedStallByScope = reactive({});
const stallDishPages = reactive({});
const loadingStalls = ref(new Set());
const scrollElements = new Map();
const areaElements = new Map();
const modeByVenue = reactive({});
const highlightedNode = ref('');
const introductionPanelOpen = ref(false);
const introductionBatches = ref([]);
const selectedIntroductionBatch = ref('');
const introductionFilters = reactive({ entityType: '', status: 'schema_validated', q: '' });
const introductionItems = ref([]);
const introductionTotal = ref(0);
const introductionLimit = 24;
const introductionOffset = ref(0);
const introductionLoading = ref(false);
const introductionMessage = ref('');
const introductionPreview = ref(null);
const introductionConfirmation = ref('');
const introductionRollback = ref(null);
const introductionRollbackConfirmation = ref('');
let searchTimer = null;
let messageTimer = null;
let highlightTimer = null;
let internalSelectionUpdate = false;
let internalSearchUpdate = false;
let pendingSearchQuery = '';
let loadedSearchQuery = null;

const roleCapabilities = {
  operator: ['stall:write', 'dish:write', 'dish:bulk_import'],
  stall_admin: ['stall:write', 'dish:write', 'dish:bulk_import'],
  canteen_admin: ['canteen:write', 'stall:write', 'dish:write', 'dish:bulk_import', 'catalog:introduction:review'],
  tenant_admin: ['canteen:write', 'stall:write', 'dish:write', 'dish:bulk_import', 'catalog:introduction:review', 'catalog:introduction:approve_all'],
  admin: ['canteen:write', 'stall:write', 'dish:write', 'dish:bulk_import', 'catalog:introduction:review', 'catalog:introduction:approve_all'],
  super_admin: ['canteen:write', 'stall:write', 'dish:write', 'dish:bulk_import', 'catalog:introduction:review', 'catalog:introduction:approve_all']
};

function hasCapability(permission) {
  const explicit = store.user?.permissions;
  if (explicit instanceof Set) return explicit.has(permission);
  if (Array.isArray(explicit)) return explicit.includes(permission);
  return Boolean(roleCapabilities[store.user?.role]?.includes(permission));
}

const canWriteCanteens = computed(() => hasCapability('canteen:write'));
const canWriteStalls = computed(() => hasCapability('stall:write'));
const canWriteDishes = computed(() => hasCapability('dish:write'));
const canBulkImportDishes = computed(() => hasCapability('dish:bulk_import'));
const canReviewIntroductions = computed(() => hasCapability('catalog:introduction:review'));
const canApproveIntroductionBatch = computed(() => hasCapability('catalog:introduction:approve_all'));
const selectedIntroductionBatchRecord = computed(() => introductionBatches.value.find((batch) => batch.id === selectedIntroductionBatch.value) || null);
const canRollbackIntroductionBatch = computed(() => canApproveIntroductionBatch.value && selectedIntroductionBatchRecord.value?.status === 'approved');
const tenantLabel = computed(() => store.user?.tenantName || store.user?.tenantId || store.user?.nickname || '当前租户');

const venues = computed(() => (store.adminCatalogTree?.regions || []).map((current) => ({
  ...current,
  name: current.region?.name || current.name,
  displayName: current.displayName || current.region?.displayName || current.region?.name || current.name,
  areaLabel: current.areaLabel || current.labels?.area || '下属场所',
  counts: current.counts || {},
  canteens: current.canteens || [],
  directStalls: current.directStalls || []
})));
const venueIds = computed(() => venues.value.map((venue) => venue.id));
const selectedVenueId = computed(() => String(route.query.venueId || venueIds.value[0] || ''));
const activeVenue = computed(() => venues.value.find((venue) => venue.id === selectedVenueId.value) || venues.value[0]);
const allAreas = computed(() => venues.value.flatMap((venue) => venue.canteens.map((node) => node.canteen)));
const allStalls = computed(() => {
  const result = [];
  const visit = (node) => {
    result.push(node.stall);
    for (const child of node.children || []) visit(child);
  };
  for (const venue of venues.value) {
    for (const area of venue.canteens || []) for (const node of area.stalls || []) visit(node);
    for (const node of venue.directStalls || []) visit(node);
  }
  return result;
});

const storageScope = computed(() => store.user?.tenantId || store.user?.id || 'default');
function storageKey(suffix) { return `admin-catalog:${storageScope.value}:${suffix}`; }

function loadWorkspaceMemory() {
  if (typeof sessionStorage === 'undefined') return;
  for (const venueId of venueIds.value) modeByVenue[venueId] = 'directory';
  try {
    const expanded = JSON.parse(sessionStorage.getItem(storageKey('expanded')) || '[]');
    expandedAreas.value = new Set(Array.isArray(expanded) ? expanded : []);
    const expandedStalls = JSON.parse(sessionStorage.getItem(storageKey('expanded-stalls')) || '{}');
    for (const key of Object.keys(expandedStallByScope)) delete expandedStallByScope[key];
    if (expandedStalls && typeof expandedStalls === 'object' && !Array.isArray(expandedStalls)) {
      for (const [scope, stallId] of Object.entries(expandedStalls)) if (stallId) expandedStallByScope[scope] = String(stallId);
    }
    for (const venueId of venueIds.value) {
      const mode = sessionStorage.getItem(storageKey(`mode:${venueId}`));
      if (mode === 'stats' || mode === 'directory') modeByVenue[venueId] = mode;
    }
  } catch {
    expandedAreas.value = new Set();
  }
}

function persistExpanded() {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(storageKey('expanded'), JSON.stringify([...expandedAreas.value]));
    sessionStorage.setItem(storageKey('expanded-stalls'), JSON.stringify(expandedStallByScope));
  }
}

function registerScrollElement(venueId, element) {
  if (!element) {
    scrollElements.delete(venueId);
    return;
  }
  scrollElements.set(venueId, element);
}

function registerAreaElement(areaId, element) {
  if (element) areaElements.set(areaId, element);
  else areaElements.delete(areaId);
}

function rememberScroll(venueId, event) {
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(storageKey(`scroll:${venueId}`), String(event.currentTarget.scrollTop));
}

async function restoreScrollPositions() {
  await nextTick();
  for (const venueId of venueIds.value) {
    const element = scrollElements.get(venueId);
    if (!element || typeof sessionStorage === 'undefined') continue;
    element.scrollTop = Number(sessionStorage.getItem(storageKey(`scroll:${venueId}`)) || 0);
  }
}

async function refreshTree() {
  const firstLoad = !store.adminCatalogTree;
  if (firstLoad) loading.value = true;
  else refreshing.value = true;
  errorMessage.value = '';
  let loaded = false;
  try {
    await store.loadAdminCatalogTree({ include: searchTerm.value.trim() ? 'dishes' : 'summary', q: searchTerm.value.trim(), limit: 20, offset: 0 });
    for (const venueId of venueIds.value) if (!modeByVenue[venueId]) modeByVenue[venueId] = 'directory';
    loadedSearchQuery = searchTerm.value.trim();
    loaded = true;
    expandSearchPaths();
    const selectedArea = String(route.query.areaId || '');
    if (selectedArea) setAreaExpanded(selectedArea, true, false);
    await normalizeDeepLink();
    await restoreExpandedStalls();
    return true;
  } catch (error) {
    errorMessage.value = formatCatalogError(error, '目录加载失败，请稍后重试。');
    return false;
  } finally {
    loading.value = false;
    refreshing.value = false;
    // Restore after the real tree has rendered.  Restoring against the five
    // skeleton rows clamps scrollTop to zero and loses a user's position.
    if (loaded) {
      await nextTick();
      await restoreScrollPositions();
    }
  }
}

function setVenueMode(venueId, mode) {
  modeByVenue[venueId] = mode;
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(storageKey(`mode:${venueId}`), mode);
}

function isAreaExpanded(areaId) { return expandedAreas.value.has(areaId); }
function setAreaExpanded(areaId, expanded, persist = true) {
  const next = new Set(expandedAreas.value);
  if (expanded) next.add(areaId);
  else next.delete(areaId);
  expandedAreas.value = next;
  if (persist) persistExpanded();
}
function isAreaLoading(areaId) { return loadingAreas.value.has(areaId); }
async function ensureAreaDetails(venue, areaId) {
  const area = venue?.canteens?.find((node) => node.canteen?.id === areaId);
  if (!area) return;
}
async function toggleArea(venue, areaId) {
  const expanding = !isAreaExpanded(areaId);
  setAreaExpanded(areaId, expanding);
  if (expanding) await ensureAreaDetails(venue, areaId);
}

function normalizedQuery() { return searchTerm.value.trim().toLocaleLowerCase(); }
function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((entry) => String(entry));
  return String(value || '').split(/[，,\s]+/).map((entry) => entry.trim()).filter(Boolean);
}
function textMatches(...values) {
  const query = normalizedQuery();
  return !query || values.some((value) => String(value || '').toLocaleLowerCase().includes(query));
}
function dishMatches(dish) { return textMatches(dish.name, dish.taste, dish.cuisine, ...asList(dish.tags), ...asList(dish.ingredients), ...asList(dish.allergens)); }
function dishSearchDetail(dish) {
  const query = normalizedQuery();
  if (!query) return '';
  const details = [
    ...asList(dish.tags).map((value) => `标签：${value}`),
    ...asList(dish.ingredients).map((value) => `食材：${value}`),
    ...asList(dish.allergens).map((value) => `过敏原：${value}`)
  ];
  return details.find((value) => value.toLocaleLowerCase().includes(query)) || '';
}
function stallSelfMatches(stall) { return textMatches(stall.name, stall.category, stall.floor); }
function stallBranchMatches(node) {
  if (!normalizedQuery()) return true;
  return stallSelfMatches(node.stall) || (node.directDishes || []).some(dishMatches) || (node.children || []).some(stallBranchMatches);
}
function areaMatches(areaNode) {
  return textMatches(areaNode.canteen.name, areaNode.canteen.location) || (areaNode.stalls || []).some(stallBranchMatches);
}
function visibleAreas(venue) {
  if (!normalizedQuery() || textMatches(venue.name, venue.region?.location)) return venue.canteens || [];
  return (venue.canteens || []).filter(areaMatches);
}
function visibleDirectStalls(venue) {
  if (!normalizedQuery() || textMatches(venue.name, venue.region?.location)) return venue.directStalls || [];
  return (venue.directStalls || []).filter(stallBranchMatches);
}

function flattenStalls(nodes, { ancestorMatches = false, depth = 0 } = {}) {
  const rows = [];
  for (const node of nodes || []) {
    const selfMatch = stallSelfMatches(node.stall);
    const branchMatch = stallBranchMatches(node);
    if (!normalizedQuery() || ancestorMatches || branchMatch) {
      rows.push({ node, depth, showAllDishes: !normalizedQuery() || ancestorMatches || selfMatch });
    }
    rows.push(...flattenStalls(node.children || [], { ancestorMatches: ancestorMatches || selfMatch, depth: depth + 1 }));
  }
  return rows;
}
function displayedStalls(areaNode) {
  const areaSelfMatches = textMatches(areaNode.canteen.name, areaNode.canteen.location);
  return flattenStalls(areaNode.stalls, { ancestorMatches: areaSelfMatches });
}
function displayedDirectStalls(venue) {
  const venueSelfMatches = textMatches(venue.name, venue.region?.location);
  return flattenStalls(visibleDirectStalls(venue), { ancestorMatches: venueSelfMatches });
}
function visibleDishes(row, areaNode) {
  const dishes = row.node.directDishes || [];
  if (!normalizedQuery() || row.showAllDishes || (areaNode && textMatches(areaNode.canteen.name, areaNode.canteen.location))) return dishes;
  return dishes.filter(dishMatches);
}

function isStallExpanded(scope, stallId) { return expandedStallByScope[scope] === String(stallId); }
function isStallLoading(stallId) { return loadingStalls.value.has(String(stallId)); }
function stallDishPage(stallId) { return stallDishPages[String(stallId)] || { items: [], page: 0, pageSize: 30, total: 0, hasMore: false }; }
function stallDishes(stallId) { return stallDishPage(stallId).items || []; }

async function loadStallDishes(node, page = 1) {
  const stallId = String(node?.stall?.id || node?.id || '');
  if (!stallId || isStallLoading(stallId)) return;
  loadingStalls.value = new Set([...loadingStalls.value, stallId]);
  try {
    const result = await store.loadAdminStallDishes(stallId, { page, pageSize: 30, q: normalizedQuery() });
    const previous = page > 1 ? stallDishes(stallId) : [];
    const itemsById = new Map(previous.map((dish) => [String(dish.id), dish]));
    for (const dish of result.items || []) itemsById.set(String(dish.id), dish);
    stallDishPages[stallId] = { ...result, items: [...itemsById.values()] };
  } catch (error) {
    errorMessage.value = formatCatalogError(error, '档口菜品加载失败，请稍后重试。');
  } finally {
    const next = new Set(loadingStalls.value);
    next.delete(stallId);
    loadingStalls.value = next;
  }
}

async function toggleStall(scope, node, selection = {}) {
  const stallId = String(node?.stall?.id || '');
  if (!stallId) return;
  if (isStallExpanded(scope, stallId)) delete expandedStallByScope[scope];
  else {
    expandedStallByScope[scope] = stallId;
    await loadStallDishes(node, 1);
    await setRouteSelection({ ...selection, stallId });
  }
  persistExpanded();
}

async function loadMoreStallDishes(node) {
  const current = stallDishPage(node?.stall?.id);
  if (!current.hasMore) return;
  await loadStallDishes(node, Number(current.page || 1) + 1);
}

function locateStall(stallId) {
  for (const venue of venues.value) {
    for (const areaNode of venue.canteens || []) {
      const node = (areaNode.stalls || []).find((candidate) => String(candidate.stall?.id) === String(stallId));
      if (node) return { venue, areaNode, node, scope: areaNode.canteen.id };
    }
    const node = (venue.directStalls || []).find((candidate) => String(candidate.stall?.id) === String(stallId));
    if (node) return { venue, areaNode: null, node, scope: `venue:${venue.id}` };
  }
  return null;
}

async function restoreExpandedStalls() {
  const requestedStallId = String(route.query.stallId || '');
  if (requestedStallId) {
    const located = locateStall(requestedStallId);
    if (located) {
      if (located.areaNode) setAreaExpanded(located.areaNode.canteen.id, true, false);
      expandedStallByScope[located.scope] = requestedStallId;
    }
  }
  for (const [scope, stallId] of Object.entries(expandedStallByScope)) {
    const located = locateStall(stallId);
    if (!located || located.scope !== scope) { delete expandedStallByScope[scope]; continue; }
    await loadStallDishes(located.node, 1);
  }
  persistExpanded();
}

function expandSearchPaths() {
  if (!normalizedQuery()) return;
  const next = new Set(expandedAreas.value);
  for (const venue of venues.value) {
    for (const area of visibleAreas(venue)) {
      next.add(area.canteen.id);
      const match = displayedStalls(area).find((row) => (row.node.directDishes || []).some(dishMatches) || stallSelfMatches(row.node.stall));
      if (match) expandedStallByScope[area.canteen.id] = match.node.stall.id;
    }
    const directMatch = displayedDirectStalls(venue).find((row) => (row.node.directDishes || []).some(dishMatches) || stallSelfMatches(row.node.stall));
    if (directMatch) expandedStallByScope[`venue:${venue.id}`] = directMatch.node.stall.id;
  }
  expandedAreas.value = next;
  persistExpanded();
}

async function setRouteSelection({ venueId, areaId, stallId, dishId } = {}) {
  const query = { ...route.query };
  for (const key of ['venueId', 'areaId', 'stallId', 'dishId']) delete query[key];
  if (venueId) query.venueId = venueId;
  if (areaId) query.areaId = areaId;
  if (stallId) query.stallId = stallId;
  if (dishId) query.dishId = dishId;
  internalSelectionUpdate = true;
  try {
    await router.replace({ path: '/admin/catalog', query });
  } finally {
    internalSelectionUpdate = false;
  }
}

function queueSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applySearch, 220);
}
async function applySearch() {
  clearTimeout(searchTimer);
  const query = { ...route.query };
  if (searchTerm.value.trim()) query.q = searchTerm.value.trim();
  else delete query.q;
  internalSearchUpdate = true;
  pendingSearchQuery = searchTerm.value.trim();
  try {
    await router.replace({ path: '/admin/catalog', query });
  } finally {
    internalSearchUpdate = false;
  }
  await refreshTree();
  pendingSearchQuery = '';
  if (searchTerm.value.trim()) {
    for (const venue of venues.value) {
      if (visibleAreas(venue).length || visibleDirectStalls(venue).length) setVenueMode(venue.id, 'directory');
    }
  }
  expandSearchPaths();
}
function clearSearch() {
  searchTerm.value = '';
  applySearch();
}

function formatCatalogError(error, fallback) {
  if (!error) return fallback;
  const prefix = {
    permission: '当前账号没有执行此操作的权限',
    validation: '请检查表单中的字段',
    conflict: '数据存在冲突，请先处理关联记录',
    network: '网络连接失败，已保留当前页面内容',
    server: '服务暂时不可用'
  }[error.kind];
  const detail = String(error.message || '').trim();
  if (!prefix) return detail || fallback;
  return detail && detail !== prefix ? `${prefix}：${detail}` : prefix;
}

async function toggleIntroductionPanel() {
  introductionPanelOpen.value = !introductionPanelOpen.value;
  if (!introductionPanelOpen.value || introductionBatches.value.length) return;
  await loadIntroductionBatches();
}

async function loadIntroductionBatches() {
  introductionLoading.value = true;
  introductionMessage.value = '';
  try {
    const result = await apiClient.listCatalogIntroductionBatches();
    introductionBatches.value = result.batches || [];
    if (!selectedIntroductionBatch.value && introductionBatches.value.length) {
      selectedIntroductionBatch.value = introductionBatches.value[0].id;
    }
    if (selectedIntroductionBatch.value) await loadIntroductions(0, { preserveLoading: true });
  } catch (error) {
    introductionMessage.value = formatCatalogError(error, '介绍批次加载失败，请稍后重试。');
  } finally {
    introductionLoading.value = false;
  }
}

async function loadIntroductions(offset = 0, { preserveLoading = false } = {}) {
  introductionOffset.value = Math.max(0, Number(offset) || 0);
  introductionPreview.value = null;
  introductionConfirmation.value = '';
  introductionRollback.value = null;
  introductionRollbackConfirmation.value = '';
  introductionMessage.value = '';
  if (!selectedIntroductionBatch.value) {
    introductionItems.value = [];
    introductionTotal.value = 0;
    return;
  }
  if (!preserveLoading) introductionLoading.value = true;
  try {
    const result = await apiClient.listCatalogIntroductions({
      batchId: selectedIntroductionBatch.value,
      entityType: introductionFilters.entityType,
      status: introductionFilters.status,
      q: introductionFilters.q,
      limit: introductionLimit,
      offset: introductionOffset.value
    });
    introductionItems.value = result.items || [];
    introductionTotal.value = Number(result.total || 0);
  } catch (error) {
    introductionMessage.value = formatCatalogError(error, '介绍候选加载失败，请稍后重试。');
  } finally {
    if (!preserveLoading) introductionLoading.value = false;
  }
}

async function previewIntroductionApproval() {
  if (!selectedIntroductionBatch.value || !canApproveIntroductionBatch.value) return;
  introductionLoading.value = true;
  introductionMessage.value = '';
  introductionConfirmation.value = '';
  try {
    introductionPreview.value = await apiClient.previewCatalogIntroductionApproval(selectedIntroductionBatch.value);
  } catch (error) {
    introductionMessage.value = formatCatalogError(error, '整批批准预览失败。');
  } finally {
    introductionLoading.value = false;
  }
}

async function approveIntroductionBatch() {
  const preview = introductionPreview.value;
  if (!preview?.approvable || introductionConfirmation.value !== preview.requiredConfirmation) return;
  introductionLoading.value = true;
  introductionMessage.value = '';
  try {
    const result = await apiClient.approveCatalogIntroductionBatch(selectedIntroductionBatch.value, {
      confirmation: introductionConfirmation.value,
      expectedDigest: preview.approvalDigest
    });
    introductionMessage.value = `已批准 ${result.approvedCount} 条目录介绍，并提交增量索引任务。`;
    introductionPreview.value = null;
    introductionConfirmation.value = '';
    await loadIntroductionBatches();
  } catch (error) {
    introductionMessage.value = formatCatalogError(error, '整批批准失败，请重新预览后再试。');
  } finally {
    introductionLoading.value = false;
  }
}

function prepareIntroductionRollback() {
  if (!canRollbackIntroductionBatch.value) return;
  introductionPreview.value = null;
  introductionConfirmation.value = '';
  introductionRollbackConfirmation.value = '';
  introductionRollback.value = {
    requiredConfirmation: `回滚介绍批次 ${selectedIntroductionBatch.value}`
  };
}

async function rollbackIntroductionBatch() {
  const rollback = introductionRollback.value;
  if (!rollback || introductionRollbackConfirmation.value !== rollback.requiredConfirmation) return;
  introductionLoading.value = true;
  introductionMessage.value = '';
  try {
    const result = await apiClient.rollbackCatalogIntroductionBatch(selectedIntroductionBatch.value, {
      confirmation: introductionRollbackConfirmation.value
    });
    introductionMessage.value = `已回滚 ${result.rolledBackCount} 条目录介绍，并提交索引更新任务。`;
    introductionRollback.value = null;
    introductionRollbackConfirmation.value = '';
    await loadIntroductionBatches();
  } catch (error) {
    introductionMessage.value = formatCatalogError(error, '整批回滚失败，请刷新批次状态后重试。');
  } finally {
    introductionLoading.value = false;
  }
}

async function saveIntroduction(item, status) {
  if (!item?.id || !canReviewIntroductions.value) return;
  introductionLoading.value = true;
  introductionMessage.value = '';
  try {
    const result = await apiClient.updateCatalogIntroduction(item.id, {
      factualSummary: item.factualSummary,
      recommendationCopy: item.recommendationCopy,
      status,
      expectedUpdatedAt: item.updatedAt
    });
    const index = introductionItems.value.findIndex((entry) => entry.id === item.id);
    if (index >= 0) introductionItems.value.splice(index, 1, result.introduction);
    introductionMessage.value = status === 'approved' ? '该介绍已批准并提交增量索引任务。' : status === 'rejected' ? '该介绍已拒绝。' : '修改已保存。';
    introductionPreview.value = null;
  } catch (error) {
    introductionMessage.value = formatCatalogError(error, '介绍保存失败，请刷新后重试。');
  } finally {
    introductionLoading.value = false;
  }
}

function introductionEntityLabel(item) {
  return ({ dish: '菜品', stall: '档口', area: '餐厅/楼层', venue: '食堂' })[item?.hierarchyLevel] || ({ dish: '菜品', stall: '档口', canteen: '餐厅/食堂' })[item?.entityType] || '目录实体';
}

function findDeepLinkSelection() {
  const requestedArea = String(route.query.areaId || '');
  const requestedStall = String(route.query.stallId || '');
  const requestedDish = String(route.query.dishId || '');
  if (!requestedArea && !requestedStall && !requestedDish) return null;
  const visit = (node) => {
    if (requestedStall && node.stall?.id === requestedStall) return { stallId: requestedStall };
    if (requestedDish && (node.directDishes || []).some((dish) => dish.id === requestedDish)) return { stallId: node.stall.id, dishId: requestedDish };
    for (const child of node.children || []) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  for (const venue of venues.value) {
    for (const areaNode of venue.canteens || []) {
      if (requestedArea === areaNode.canteen.id) return { venueId: venue.id, areaId: areaNode.canteen.id };
      for (const stallNode of areaNode.stalls || []) {
        const found = visit(stallNode);
        if (found) return { venueId: venue.id, areaId: areaNode.canteen.id, ...found };
      }
    }
    for (const stallNode of venue.directStalls || []) {
      const found = visit(stallNode);
      if (found) return { venueId: venue.id, ...found };
    }
  }
  return null;
}

async function normalizeDeepLink() {
  if (route.query.venueId) return;
  const inferred = findDeepLinkSelection();
  if (inferred) await setRouteSelection(inferred);
}

async function confirmDrawerChange() {
  if (!drawerDescriptor.value) return true;
  if (typeof drawerRef.value?.confirmDiscard === 'function') return drawerRef.value.confirmDiscard();
  return true;
}

async function showDrawer(descriptor, selection) {
  if (!(await confirmDrawerChange())) return;
  drawerDescriptor.value = descriptor;
  if (selection) await setRouteSelection(selection);
}
function closeDrawer() { drawerDescriptor.value = null; }
function editDrawerNode() {
  if (!drawerDescriptor.value) return;
  drawerDescriptor.value = { ...drawerDescriptor.value, mode: 'edit' };
}

function venueDescriptor(venue, mode) {
  return {
    mode,
    type: 'venue',
    venue,
    item: venue.region || { id: venue.id, name: venue.name, location: '', hours: '07:00 - 21:00', description: '' },
    fixedId: venue.id,
    canEdit: canWriteCanteens.value
  };
}
function handlePrimaryVenueAction() {
  if (!activeVenue.value) return;
  if (activeVenue.value.missing) openVenue(activeVenue.value, 'create');
  else if (activeVenue.value.supportsDirectStalls) openNewDirectStall(activeVenue.value);
  else openNewArea(activeVenue.value);
}
function openVenue(venue, mode = 'view') {
  if (mode !== 'view' && !canWriteCanteens.value) return;
  showDrawer(venueDescriptor(venue, mode), { venueId: venue.id });
}
function openNewArea(venue) {
  if (!venue || venue.missing || !canWriteCanteens.value) return;
  showDrawer({ mode: 'create', type: 'area', venue, item: null, canEdit: true }, { venueId: venue.id });
}
function openNewDirectStall(venue) {
  if (!venue?.supportsDirectStalls || !canWriteStalls.value) return;
  showDrawer({ mode: 'create', type: 'stall', venue, area: venue.region, item: null, canEdit: true }, { venueId: venue.id, areaId: venue.id });
}
function openArea(venue, areaNode, mode = 'view') {
  if (mode !== 'view' && !canWriteCanteens.value) return;
  setAreaExpanded(areaNode.canteen.id, true);
  showDrawer({ mode, type: 'area', venue, area: areaNode.canteen, item: areaNode.canteen, canEdit: canWriteCanteens.value }, { venueId: venue.id, areaId: areaNode.canteen.id });
}
function openNewStall(venue, areaNode) {
  if (!canWriteStalls.value) return;
  setAreaExpanded(areaNode.canteen.id, true);
  showDrawer({ mode: 'create', type: 'stall', venue, area: areaNode.canteen, item: null, canEdit: true }, { venueId: venue.id, areaId: areaNode.canteen.id });
}
function openStall(venue, areaNode, stallNode, mode = 'view') {
  if (mode !== 'view' && !canWriteStalls.value) return;
  setAreaExpanded(areaNode.canteen.id, true);
  showDrawer({ mode, type: 'stall', venue, area: areaNode.canteen, stall: stallNode.stall, item: stallNode.stall, legacyHierarchy: stallNode.legacyHierarchy, canEdit: canWriteStalls.value }, { venueId: venue.id, areaId: areaNode.canteen.id, stallId: stallNode.stall.id });
}
function openDirectStall(venue, stallNode, mode = 'view') {
  if (mode !== 'view' && !canWriteStalls.value) return;
  showDrawer({ mode, type: 'stall', venue, area: venue.region, stall: stallNode.stall, item: stallNode.stall, canEdit: canWriteStalls.value }, { venueId: venue.id, areaId: venue.id, stallId: stallNode.stall.id });
}
function openDirectDish(venue, stallNode, dish, mode = 'view') {
  if (mode !== 'view' && !canWriteDishes.value) return;
  showDrawer({ mode, type: 'dish', venue, area: venue.region, stall: stallNode.stall, item: dish, canEdit: canWriteDishes.value }, { venueId: venue.id, areaId: venue.id, stallId: stallNode.stall.id, dishId: dish.id });
}
function openNewDish(venue, areaNode, stallNode) {
  if (!canWriteDishes.value) return;
  showDrawer({ mode: 'create', type: 'dish', venue, area: areaNode.canteen, stall: stallNode.stall, item: null, canEdit: true }, { venueId: venue.id, areaId: areaNode.canteen.id, stallId: stallNode.stall.id });
}
function openDish(venue, areaNode, stallNode, dish, mode = 'view') {
  if (mode !== 'view' && !canWriteDishes.value) return;
  showDrawer({ mode, type: 'dish', venue, area: areaNode.canteen, stall: stallNode.stall, item: dish, canEdit: canWriteDishes.value }, { venueId: venue.id, areaId: areaNode.canteen.id, stallId: stallNode.stall.id, dishId: dish.id });
}

function findSavedContext(type, item, payload) {
  if (type === 'venue') return { venueId: item?.id || payload.venueId };
  if (type === 'area') return { venueId: item?.parentId || payload.venueId, areaId: item?.id };
  if (type === 'stall') {
    const areaId = item?.canteenId || payload.areaId;
    const venue = venues.value.find((entry) => entry.canteens.some((node) => node.canteen.id === areaId));
    return { venueId: venue?.id || payload.venueId, areaId, stallId: item?.id };
  }
  const stallId = item?.stallId || payload.stallId;
  for (const venue of venues.value) {
    for (const area of venue.canteens) {
      if (flattenStalls(area.stalls).some((row) => row.node.stall.id === stallId)) return { venueId: venue.id, areaId: area.canteen.id, stallId, dishId: item?.id };
    }
  }
  return { venueId: payload.venueId, areaId: payload.areaId, stallId, dishId: item?.id };
}

async function handleSaved(payload) {
  drawerDescriptor.value = null;
  if (searchTerm.value) {
    searchTerm.value = '';
    const query = { ...route.query };
    delete query.q;
    await router.replace({ path: route.path, query });
  }
  const refreshed = await refreshTree();
  if (!refreshed) return;
  const selection = findSavedContext(payload.type, payload.item, payload);
  if (selection.areaId) setAreaExpanded(selection.areaId, true);
  await setRouteSelection(selection);
  const id = payload.item?.id;
  if (id) {
    highlightedNode.value = `${payload.type}:${id}`;
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => { highlightedNode.value = ''; }, 2600);
    await nextTick();
    scrollNodeIntoView(payload.type, id);
  }
  showSuccess('保存成功，目录已更新。');
}

function showSuccess(message) {
  successMessage.value = message;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => { successMessage.value = ''; }, 2600);
}
function scrollNodeIntoView(type, id) {
  const element = pageElement.value?.querySelector(`[data-node-key="${type}:${String(id).replace(/"/g, '\\"')}"]`);
  element?.scrollIntoView({ block: 'nearest', behavior: preferredScrollBehavior() });
}
async function locateArea(venue, areaNode) {
  setVenueMode(venue.id, 'directory');
  setAreaExpanded(areaNode.canteen.id, true);
  await setRouteSelection({ venueId: venue.id, areaId: areaNode.canteen.id });
  await nextTick();
  areaElements.get(areaNode.canteen.id)?.scrollIntoView({ block: 'start', behavior: preferredScrollBehavior() });
}
function openImport() {
  if (!canBulkImportDishes.value) return;
  const query = { task: 'import' };
  if (route.query.venueId) query.venueId = route.query.venueId;
  if (route.query.areaId) query.areaId = route.query.areaId;
  if (route.query.stallId) query.stallId = route.query.stallId;
  router.push({ path: '/admin/input', query });
}

function selectedNodeId(type) {
  const keys = { venue: 'venueId', area: 'areaId', stall: 'stallId', dish: 'dishId' };
  return String(route.query[keys[type]] || '');
}
function nodeClasses(type, id) {
  const key = `${type}:${id}`;
  return { 'is-selected': selectedNodeId(type) === String(id), 'is-highlighted': highlightedNode.value === key };
}
function venueIndex(id) { return String(Math.max(0, venueIds.value.indexOf(id)) + 1).padStart(2, '0'); }
function venueTypeLabel(venue) {
  return ({ campus: '校区餐饮', dining_hall: '餐饮场所', service_building: '生活服务', supermarket: '校园超市' })[venue.venueType] || '餐饮与生活服务';
}
function areaOperating(areaNode) { return Number(areaNode.openStallCount || 0) > 0; }
function openRate(venue) {
  const total = Number(venue.counts?.stalls || 0);
  return total ? Math.round((Number(venue.counts?.openStalls || 0) / total) * 100) : 0;
}
function maxAreaCount(venue, key) { return Math.max(1, ...visibleAreas(venue).map((area) => Number(area[key] || 0))); }
function chartWidth(value, max) { return `${Math.max(Number(value) > 0 ? 6 : 0, Math.round((Number(value || 0) / Math.max(1, max)) * 100))}%`; }
function formatPrice(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}
function dishMeta(dish) { return [dish.taste, dish.cuisine].filter(Boolean).join(' · ') || '菜品信息待补充'; }
function preferredScrollBehavior() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

watch(() => route.query.q, async (value) => {
  const next = String(value || '');
  if (next !== searchTerm.value) searchTerm.value = next;
  if (!internalSearchUpdate && next !== pendingSearchQuery && next !== loadedSearchQuery) await refreshTree();
  if (next) {
    for (const venue of venues.value) {
      if (visibleAreas(venue).length || visibleDirectStalls(venue).length) setVenueMode(venue.id, 'directory');
    }
  }
  expandSearchPaths();
});
watch(() => route.query.areaId, (areaId) => {
  if (areaId) {
    const id = String(areaId);
    setAreaExpanded(id, true);
    const venue = venues.value.find((entry) => entry.canteens.some((node) => node.canteen.id === id));
    if (venue) ensureAreaDetails(venue, id);
  }
});
watch(storageScope, async (nextScope, previousScope) => {
  if (nextScope === previousScope) return;
  loadWorkspaceMemory();
  await restoreScrollPositions();
});
watch(() => [route.query.areaId, route.query.stallId, route.query.dishId], async ([areaId, stallId, dishId]) => {
  if (areaId) setAreaExpanded(String(areaId), true);
  const target = dishId ? ['dish', dishId] : stallId ? ['stall', stallId] : areaId ? ['area', areaId] : null;
  if (!target) return;
  await nextTick();
  scrollNodeIntoView(target[0], String(target[1]));
});

onMounted(async () => {
  loadWorkspaceMemory();
  await refreshTree();
  const areaId = String(route.query.areaId || '');
  if (areaId) {
    setAreaExpanded(areaId, true);
    const venue = venues.value.find((entry) => entry.canteens.some((node) => node.canteen.id === areaId));
    if (venue) await ensureAreaDetails(venue, areaId);
    await nextTick();
    const dishId = String(route.query.dishId || '');
    const stallId = String(route.query.stallId || '');
    if (dishId) scrollNodeIntoView('dish', dishId);
    else if (stallId) scrollNodeIntoView('stall', stallId);
    else scrollNodeIntoView('area', areaId);
  }
});

onBeforeRouteLeave(() => {
  if (!drawerDescriptor.value) return true;
  return drawerRef.value?.confirmDiscard?.() ?? true;
});

onBeforeRouteUpdate((to, from) => {
  if (internalSelectionUpdate) return true;
  const selectionKeys = ['venueId', 'areaId', 'stallId', 'dishId'];
  const selectionChanged = selectionKeys.some((key) => String(to.query[key] || '') !== String(from.query[key] || ''));
  if (!selectionChanged || !drawerDescriptor.value) return true;
  if (!(drawerRef.value?.confirmDiscard?.() ?? true)) return false;
  drawerDescriptor.value = null;
  return true;
});

onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  clearTimeout(messageTimer);
  clearTimeout(highlightTimer);
});
</script>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.catalog-page { position: relative; min-height: calc(100dvh - 4.25rem); display: grid; grid-template-rows: auto minmax(0, 1fr); gap: .75rem; color: #173b28; }
.catalog-toolbar { min-width: 0; display: grid; grid-template-columns: minmax(15rem, auto) minmax(16rem, 1fr) auto; gap: 1rem; align-items: center; padding: .1rem .15rem; }
.catalog-heading { min-width: 0; }
.catalog-eyebrow { margin: 0 0 .12rem; color: #5d7565; font-size: .7rem; font-weight: 750; letter-spacing: 0; }
.catalog-title-row { display: flex; align-items: center; gap: .65rem; min-width: 0; }
.catalog-title-row h1 { margin: 0; color: #173b28; font-size: 1.65rem; line-height: 1.15; letter-spacing: 0; }
.tenant-badge { max-width: 9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid #d5e5d7; border-radius: .35rem; padding: .2rem .45rem; background: rgba(255,255,255,.7); color: #607166; font-size: .68rem; }
.catalog-search { position: relative; width: min(100%, 34rem); justify-self: center; }
.catalog-search input { height: 2.65rem; border-radius: .45rem; padding: .6rem 2.5rem .6rem 2.35rem; background: rgba(255,255,255,.86); }
.search-icon { position: absolute; left: .85rem; top: 50%; width: .75rem; height: .75rem; transform: translateY(-58%); border: 2px solid #64816c; border-radius: 50%; pointer-events: none; }
.search-icon::after { content: ''; position: absolute; width: .4rem; height: 2px; right: -.32rem; bottom: -.18rem; transform: rotate(45deg); background: #64816c; }
.clear-search { position: absolute; right: .4rem; top: .32rem; width: 2rem; height: 2rem; border-radius: .35rem; background: transparent; color: #64746a; font-size: 1.15rem; }
.catalog-toolbar-actions { display: flex; justify-content: flex-end; gap: .45rem; }
.tool-button { min-height: 2.65rem; display: inline-flex; align-items: center; justify-content: center; gap: .38rem; border: 1px solid #d4e3d5; border-radius: .42rem; padding: .55rem .72rem; background: rgba(255,255,255,.82); color: #285b3d; font-weight: 700; font-size: .78rem; white-space: nowrap; box-shadow: 0 .3rem .8rem rgba(28,76,46,.06); }
.tool-button.primary-action { border-color: #1f7a4d; background: #1f7a4d; color: #fff; }
.refresh-symbol { display: inline-block; font-size: 1.08rem; line-height: 1; }
.refresh-symbol.spinning { animation: catalog-spin .8s linear infinite; }
.catalog-notice { position: fixed; z-index: 58; top: 1rem; right: 1rem; width: min(32rem, calc(100% - 2rem)); min-height: 2.35rem; display: flex; align-items: center; justify-content: space-between; gap: .75rem; border-radius: .4rem; padding: .55rem .8rem; font-size: .78rem; box-shadow: 0 .55rem 1.4rem rgba(27,65,42,.14); }
.catalog-notice.error { border: 1px solid #efc8c3; background: #fff1ef; color: #8a3128; }
.catalog-notice.success { border: 1px solid #b8ddc2; background: #eef9f0; color: #23653d; }
.catalog-notice button { background: transparent; color: inherit; font-weight: 750; }
.introduction-review { min-width: 0; border: 1px solid #cddfd1; border-radius: .5rem; padding: .8rem; background: #f8fbf8; box-shadow: 0 .55rem 1.4rem rgba(27,65,42,.08); }
.introduction-review-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: .7rem; }
.introduction-review-head h2 { margin: 0; color: #173b28; font-size: 1.05rem; letter-spacing: 0; }
.introduction-filters { display: grid; grid-template-columns: minmax(12rem, 1.4fr) repeat(2, minmax(7rem, .7fr)) minmax(9rem, 1fr) auto auto; align-items: end; gap: .55rem; }
.introduction-filters label, .introduction-preview label, .introduction-row label { display: grid; gap: .22rem; color: #53695a; font-size: .68rem; font-weight: 720; }
.introduction-filters input, .introduction-filters select, .introduction-preview input, .introduction-row textarea { width: 100%; border: 1px solid #cbd9cd; border-radius: .32rem; padding: .42rem .5rem; background: #fff; color: #1d3e2b; font: inherit; }
.introduction-filters button, .introduction-preview button, .introduction-actions button, .introduction-pagination button { min-height: 2.15rem; border: 1px solid #bad2bf; border-radius: .32rem; padding: .38rem .58rem; background: #fff; color: #245c3b; font-size: .68rem; font-weight: 750; }
.introduction-filters button:last-child, .introduction-preview button, .introduction-actions button:nth-child(2) { border-color: #1f7a4d; background: #1f7a4d; color: #fff; }
.introduction-review button:disabled { cursor: not-allowed; opacity: .48; }
.introduction-preview { display: grid; grid-template-columns: minmax(14rem, 1fr) minmax(17rem, 1fr) auto; align-items: end; gap: .7rem; margin-top: .7rem; border: 1px solid #e4d49f; border-radius: .36rem; padding: .6rem; background: #fff9e8; }
.introduction-preview p { margin: 0; align-self: center; color: #654f1c; font-size: .72rem; }
.introduction-table { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(24rem, 100%), 1fr)); gap: .65rem; max-height: 58dvh; margin-top: .7rem; overflow: auto; scrollbar-gutter: stable; }
.introduction-row { min-width: 0; display: grid; gap: .48rem; border: 1px solid #dce7de; border-radius: .4rem; padding: .65rem; background: #fff; }
.introduction-row header { display: flex; align-items: center; justify-content: space-between; gap: .55rem; }
.introduction-row header strong { min-width: 0; overflow: hidden; color: #264c35; text-overflow: ellipsis; white-space: nowrap; font-size: .76rem; }
.introduction-row textarea { min-height: 5.2rem; resize: vertical; line-height: 1.5; }
.introduction-meta { min-height: 1.2rem; margin: 0; overflow-wrap: anywhere; color: #77847b; font-size: .62rem; }
.introduction-actions, .introduction-pagination { display: flex; align-items: center; justify-content: flex-end; gap: .4rem; }
.introduction-actions button:last-child { border-color: #dfc7c3; color: #8a3128; }
.introduction-pagination { margin-top: .65rem; color: #607166; font-size: .68rem; }
.venue-grid { min-height: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(31rem, 100%), 1fr)); align-items: start; gap: .75rem; }
.venue-panel { --venue-accent: #1f7a4d; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(37,91,58,.16); border-top: 3px solid var(--venue-accent); border-radius: .5rem; background: rgba(250,252,249,.94); box-shadow: 0 .6rem 1.6rem rgba(26,67,42,.08); }
.venue-panel:nth-child(4n + 2) { --venue-accent: #3f7990; }
.venue-panel:nth-child(4n + 3) { --venue-accent: #b17b27; }
.venue-panel:nth-child(4n + 4) { --venue-accent: #8a675d; }
.venue-panel-placeholder { min-height: 24rem; }
.venue-panel.selected { box-shadow: 0 0 0 2px rgba(31,122,77,.13), 0 .8rem 1.8rem rgba(26,67,42,.1); }
.venue-panel-header { flex: 0 0 auto; padding: .65rem .8rem .45rem; border-bottom: 1px solid #e0e9e0; background: rgba(255,255,255,.96); }
.venue-heading-row { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: .7rem; }
.venue-identity { min-width: 0; display: flex; align-items: center; gap: .62rem; padding: 0; background: transparent; text-align: left; }
.venue-index { flex: 0 0 auto; width: 2rem; height: 2rem; display: grid; place-items: center; border-radius: .38rem; background: color-mix(in srgb, var(--venue-accent) 12%, white); color: var(--venue-accent); font-size: .68rem; font-weight: 800; }
.venue-identity > span:last-child { min-width: 0; }
.venue-identity strong { display: block; overflow: hidden; color: #173d29; text-overflow: ellipsis; white-space: nowrap; font-size: .98rem; letter-spacing: 0; }
.venue-identity small { display: block; overflow: hidden; max-width: 19rem; margin-top: .04rem; color: #718077; text-overflow: ellipsis; white-space: nowrap; font-size: .66rem; }
.venue-header-actions { flex: 0 0 auto; display: flex; align-items: center; gap: .3rem; }
.venue-status, .operation-state, .dish-state { display: inline-flex; align-items: center; border-radius: .28rem; padding: .15rem .36rem; font-size: .63rem; font-weight: 750; white-space: nowrap; }
.venue-status.active, .operation-state.open, .dish-state.active { background: #e7f5ea; color: #1d7042; }
.venue-status.inactive, .operation-state.closed, .dish-state.hidden { background: #f0f1ef; color: #6d756f; }
.venue-status.renovating { background: #fff3d7; color: #8b5d0d; }
.operation-state.warning { background: #fff3d7; color: #8b5d0d; }
.icon-action, .area-actions button, .stall-actions button, .dish-actions button, .inline-empty button { min-height: 1.9rem; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #cfdfd2; border-radius: .3rem; padding: .28rem .5rem; background: #fff; color: #245c3b; font-size: .66rem; font-weight: 730; box-shadow: 0 .16rem .38rem rgba(25,68,42,.06); }
.icon-action:hover, .area-actions button:hover, .stall-actions button:hover, .dish-actions button:hover, .inline-empty button:hover { border-color: #4b8c64; background: #e8f3ea; color: #164b2e; transform: none; }
.venue-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: .55rem 0 .45rem; border-block: 1px solid #edf1ec; padding: .35rem 0; }
.venue-summary span { display: flex; align-items: baseline; justify-content: center; gap: .2rem; border-right: 1px solid #e5ece5; color: #6c7b70; font-size: .63rem; }
.venue-summary span:last-child { border-right: 0; }
.venue-summary b { color: #234d35; font-size: .82rem; font-variant-numeric: tabular-nums; }
.venue-view-switch { display: flex; align-items: center; gap: .2rem; }
.venue-view-switch > button { min-height: 1.75rem; border-radius: .28rem; padding: .25rem .62rem; background: transparent; color: #66756b; font-size: .68rem; font-weight: 720; }
.venue-view-switch > button.active { background: #e7f1e8; color: #1e6640; }
.venue-view-switch .add-area-button { margin-left: auto; border: 1px solid #d8e5da; background: #fff; color: #2b6542; }
.venue-panel-scroll { min-height: 12rem; max-height: 62dvh; flex: 1; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-color: #8eaa95 #edf2ed; scrollbar-width: thin; scroll-behavior: smooth; background: #f7faf6; }
.venue-panel-scroll::-webkit-scrollbar { width: .65rem; }
.venue-panel-scroll::-webkit-scrollbar-track { background: #edf2ed; }
.venue-panel-scroll::-webkit-scrollbar-thumb { border: 2px solid #edf2ed; border-radius: .25rem; background: #8eaa95; }
.venue-panel-scroll:focus-visible { outline-offset: -3px; }
.catalog-loading { display: grid; gap: .55rem; padding: .75rem; }
.catalog-loading span { height: 2.9rem; border-radius: .35rem; background: linear-gradient(90deg, #edf3ed 25%, #f8faf8 48%, #edf3ed 72%); background-size: 220% 100%; animation: catalog-shimmer 1.2s ease-in-out infinite; }
.area-section { position: relative; border-bottom: 1px solid #dfe8df; background: #fff; }
.area-section.is-selected { box-shadow: inset 3px 0 #1f7a4d; }
.venue-panel.is-highlighted, .area-section.is-highlighted, .stall-block.is-highlighted, .dish-table-row.is-highlighted { animation: node-highlight 2.4s ease-out; }
.area-header { position: sticky; top: 0; z-index: 2; min-height: 3.25rem; display: grid; grid-template-columns: 1.8rem minmax(0, 1fr) auto auto; align-items: center; gap: .45rem; padding: .42rem .7rem; border-bottom: 1px solid #e8eee8; background: rgba(252,253,251,.97); box-shadow: 0 .2rem .5rem rgba(25,65,40,.04); }
.disclosure-button { width: 1.75rem; height: 1.75rem; display: grid; place-items: center; border-radius: .28rem; background: #edf4ee; color: #37644a; font-size: 1.2rem; }
.disclosure-button span { display: inline-block; transform: rotate(0deg); transition: transform .16s ease; }
.disclosure-button span.expanded { transform: rotate(90deg); }
.area-title { min-width: 0; padding: 0; background: transparent; text-align: left; }
.area-title.static { display: block; }
.area-title strong { display: block; overflow: hidden; color: #204630; text-overflow: ellipsis; white-space: nowrap; font-size: .78rem; }
.area-title small { display: block; margin-top: .02rem; color: #738077; font-size: .62rem; }
.area-actions { display: flex; align-items: center; gap: .24rem; opacity: .72; transition: opacity .15s ease; }
.area-header:hover .area-actions, .area-header:focus-within .area-actions { opacity: 1; }
.area-content { background: #f8faf7; }
.stall-table-heading, .stall-table-row { display: grid; align-items: center; gap: .5rem; }
.stall-table-heading { grid-template-columns: minmax(8rem, 1.35fr) minmax(5rem, .8fr) 4.5rem minmax(6rem, .75fr) minmax(8rem, auto); }
.stall-table-row { grid-template-columns: 1.5rem minmax(8rem, 1.35fr) minmax(5rem, .8fr) 4.5rem minmax(6rem, .75fr) minmax(8rem, auto); }
.stall-table-heading { min-height: 1.8rem; padding: .25rem .7rem; border-bottom: 1px solid #e8eee8; color: #7b877f; font-size: .59rem; font-weight: 720; }
.stall-block { border-bottom: 1px solid #e8eee8; }
.stall-block:last-child { border-bottom: 0; }
.stall-block.is-selected > .stall-table-row { background: #edf6ee; box-shadow: inset 3px 0 #1f7a4d; }
.stall-table-row { min-height: 3rem; padding: .38rem .7rem; background: #fff; color: #4d5f53; font-size: .67rem; }
.stall-table-row.expanded { background: #f8fbf7; }
.stall-disclosure { display: inline-grid; width: 1.5rem; height: 1.5rem; place-items: center; border: 1px solid #d8e4da; border-radius: .28rem; background: #fff; color: #45644f; }
.stall-disclosure span { font-size: 1rem; line-height: 1; transition: transform .18s ease; }
.stall-disclosure span.expanded { transform: rotate(90deg); }
.stall-table-row.legacy { padding-left: 1.25rem; background: #fffaf0; }
.stall-name-cell { min-width: 0; display: flex; align-items: center; gap: .35rem; padding: 0; background: transparent; text-align: left; }
.stall-name-cell > span:last-child { min-width: 0; }
.stall-name-cell strong { display: block; overflow: hidden; color: #284a35; text-overflow: ellipsis; white-space: nowrap; font-size: .72rem; }
.stall-name-cell small { display: flex; align-items: center; gap: .3rem; color: #829087; font-size: .59rem; }
.stall-name-cell em { border-radius: .2rem; padding: .05rem .22rem; background: #fff0cc; color: #8a5e13; font-style: normal; }
.tree-branch { color: #b08b43; font-size: .9rem; }
.stall-category { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-dot { display: inline-block; width: .42rem; height: .42rem; margin-right: .28rem; border-radius: 50%; background: #9ca59f; }
.status-dot.open { background: #2d965b; }
.status-dot.closed { background: #ae7771; }
.stall-actions, .dish-actions { display: flex; justify-content: flex-end; gap: .22rem; opacity: .68; transition: opacity .15s ease; }
.stall-table-row:hover .stall-actions, .stall-table-row:focus-within .stall-actions, .dish-table-row:hover .dish-actions, .dish-table-row:focus-within .dish-actions { opacity: 1; }
.dish-rows { border-top: 1px dashed #dce7dd; background: #f8fbf7; }
.stall-load-more { display: flex; width: calc(100% - 1.4rem); min-height: 2.5rem; margin: .45rem .7rem .7rem; align-items: center; justify-content: center; border: 1px solid #cfdfd2; border-radius: .35rem; background: #fff; color: #245c3b; font-size: .67rem; font-weight: 700; }
.dish-table-row { min-height: 2.8rem; display: grid; grid-template-columns: minmax(10rem, 1fr) 4rem 4rem minmax(5.8rem, auto); align-items: center; gap: .45rem; padding: .35rem .7rem .35rem 2rem; border-bottom: 1px solid #eaf0ea; color: #526258; font-size: .66rem; }
.dish-table-row:last-child { border-bottom: 0; }
.dish-table-row.is-selected { background: #edf6ee; box-shadow: inset 3px 0 #1f7a4d; }
.dish-name { min-width: 0; display: flex; align-items: center; gap: .48rem; padding: 0; background: transparent; text-align: left; }
.dish-thumb { position: relative; flex: 0 0 auto; width: 2rem; height: 2rem; display: grid; place-items: center; overflow: hidden; border: 1px solid #dce7dd; border-radius: .32rem; background: #fff; color: #356248; font-size: .68rem; }
.dish-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: cover; }
.dish-name > span:last-child { min-width: 0; }
.dish-name strong { display: block; overflow: hidden; color: #31513b; text-overflow: ellipsis; white-space: nowrap; font-size: .7rem; }
.dish-name small { display: block; overflow: hidden; color: #879188; text-overflow: ellipsis; white-space: nowrap; font-size: .58rem; }
.dish-name .dish-search-match { color: #8a6114; }
.dish-price { color: #825d1a; font-weight: 760; font-variant-numeric: tabular-nums; }
.inline-empty { min-height: 2.6rem; display: flex; align-items: center; justify-content: center; gap: .55rem; padding: .45rem .7rem; color: #7b887f; font-size: .66rem; }
.inline-empty.roomy { min-height: 4rem; }
.direct-stalls-section { border-left: 3px solid var(--primary); }
.warning-header { grid-template-columns: 1.8rem minmax(0, 1fr) auto; background: #fffaf0; }
.warning-symbol { width: 1.45rem; height: 1.45rem; display: grid; place-items: center; border-radius: 50%; background: #f4c76d; color: #62420a; font-weight: 850; }
.direct-stalls-table .stall-table-row { background: #fff; }
.venue-stats-view { min-height: 100%; display: flex; flex-direction: column; padding: .75rem; }
.stats-total-line { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .4rem; padding-bottom: .65rem; border-bottom: 1px solid #e1e9e1; }
.stats-total-line div { text-align: center; }
.stats-total-line strong, .stats-total-line span { display: block; }
.stats-total-line strong { color: #234e36; font-size: 1.08rem; font-variant-numeric: tabular-nums; }
.stats-total-line span { color: #758178; font-size: .61rem; }
.area-chart { display: grid; gap: .18rem; padding: .55rem 0; }
.chart-row { width: 100%; min-height: 3.15rem; display: grid; grid-template-columns: minmax(6rem, .7fr) minmax(8rem, 1.3fr) 1rem; align-items: center; gap: .55rem; border-bottom: 1px solid #e7ede7; padding: .35rem .2rem; background: transparent; text-align: left; }
.chart-row:hover { background: #f0f6f0; transform: none; }
.chart-label { min-width: 0; }
.chart-label b, .chart-label small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chart-label b { color: #2c5038; font-size: .68rem; }
.chart-label small { color: #7d8980; font-size: .57rem; }
.chart-bars { display: grid; gap: .25rem; }
.bar-line { position: relative; height: .72rem; display: block; overflow: hidden; border-radius: .16rem; background: #edf1ed; }
.bar { display: block; height: 100%; border-radius: .16rem; }
.bar.stalls { background: #4a8f66; }
.bar.dishes { background: #c08a35; }
.bar-line em { position: absolute; inset: 50% .25rem auto auto; transform: translateY(-50%); color: #334c3b; font-size: .52rem; font-style: normal; font-weight: 760; }
.chart-arrow { color: #66806f; font-size: 1.15rem; }
.chart-legend { display: flex; justify-content: flex-end; gap: .75rem; margin-top: auto; padding-top: .35rem; color: #748178; font-size: .58rem; }
.chart-legend span { display: inline-flex; align-items: center; gap: .25rem; }
.chart-legend i { width: .55rem; height: .55rem; border-radius: .12rem; }
.legend-stalls { background: #4a8f66; }
.legend-dishes { background: #c08a35; }
.catalog-empty { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .5rem; padding: 1.25rem; color: #718077; text-align: center; }
.catalog-empty.compact { min-height: 8rem; }
.catalog-empty strong { color: #385443; font-size: .82rem; }
.catalog-empty span { font-size: .68rem; }
.catalog-empty button { border: 1px solid #d1e2d3; border-radius: .35rem; padding: .4rem .65rem; background: #fff; color: #27623f; font-weight: 720; font-size: .68rem; }
.empty-symbol { width: 2.4rem; height: 2.4rem; display: grid; place-items: center; border: 1px dashed #a9c6ae; border-radius: .45rem; background: #f0f6ef; color: #4b805d; font-size: 1.2rem !important; }
mark { border-radius: .12rem; padding: 0 .08rem; background: #ffe19a; color: inherit; }
@keyframes catalog-spin { to { transform: rotate(360deg); } }
@keyframes catalog-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
@keyframes node-highlight { 0%, 24% { background: #fff0b8; box-shadow: inset 4px 0 #d49a2d; } 100% { background: inherit; box-shadow: none; } }

:global(.main-panel:has(.catalog-page)) { max-width: none; min-height: 100dvh; overflow: auto; }

@media (max-width: 1180px) {
  .catalog-toolbar { grid-template-columns: minmax(13rem, auto) minmax(14rem, 1fr); }
  .catalog-toolbar-actions { grid-column: 1 / -1; justify-content: flex-end; margin-top: -.35rem; }
  .stall-table-heading { display: none; }
  .stall-table-row { grid-template-columns: 1.5rem minmax(8rem, 1fr) 4rem minmax(6rem, auto); }
  .stall-category { display: none; }
  .stall-table-row > span:nth-of-type(2) { display: none; }
}

@media (max-width: 1020px) and (min-width: 821px) {
  .catalog-page { min-height: calc(100dvh - 8rem); }
}

@media (max-width: 900px) {
  :global(.main-panel:has(.catalog-page)) { height: auto; overflow: visible; }
  .catalog-page { height: auto; min-height: 0; display: block; }
  .catalog-notice { top: 4rem; right: .75rem; width: calc(100% - 1.5rem); }
  .catalog-toolbar { position: static; grid-template-columns: 1fr; gap: .65rem; margin-bottom: .75rem; }
  .catalog-search { width: 100%; justify-self: stretch; }
  .catalog-toolbar-actions { grid-column: auto; justify-content: stretch; margin-top: 0; }
  .tool-button { flex: 1; min-width: 0; }
  .introduction-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .introduction-preview { grid-template-columns: 1fr; }
  .introduction-table { max-height: none; }
  .venue-grid { display: grid; grid-template-columns: 1fr; grid-template-rows: none; gap: .75rem; }
  .venue-panel { height: 60dvh; min-height: 20rem; max-height: 36rem; }
  .venue-header-actions .icon-action { display: inline-flex; }
  .area-actions, .stall-actions, .dish-actions { opacity: 1; }
}

@media (max-width: 560px) {
  .catalog-title-row { align-items: flex-start; flex-direction: column; gap: .25rem; }
  .tenant-badge { max-width: 100%; }
  .catalog-toolbar-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .tool-button { padding-inline: .35rem; }
  .introduction-filters { grid-template-columns: 1fr; }
  .venue-panel-header { padding-inline: .62rem; }
  .venue-heading-row { align-items: flex-start; }
  .venue-header-actions { flex-wrap: wrap; justify-content: flex-end; }
  .venue-identity small { max-width: 11rem; }
  .venue-summary span { flex-direction: column; align-items: center; gap: 0; }
  .area-header { grid-template-columns: 1.7rem minmax(0, 1fr) auto; }
  .area-header > .operation-state { display: none; }
  .area-actions { grid-column: 2 / -1; justify-content: flex-end; }
  .stall-table-row { grid-template-columns: 1.5rem minmax(8rem, 1fr) auto; row-gap: .25rem; padding-block: .5rem; }
  .stall-table-row > span:nth-of-type(1), .stall-table-row > span:nth-of-type(2) { display: none; }
  .stall-actions { justify-content: flex-end; }
  .dish-table-row { grid-template-columns: minmax(8rem, 1fr) auto; padding-left: 1rem; }
  .dish-table-row > .dish-state { display: none; }
  .dish-actions { grid-column: 1 / -1; }
  .chart-row { grid-template-columns: minmax(5.5rem, .65fr) minmax(7rem, 1.35fr); }
  .chart-arrow { display: none; }
}

@media (hover: none), (pointer: coarse) {
  .area-actions, .stall-actions, .dish-actions { opacity: 1; }
  .icon-action, .area-actions button, .stall-actions button, .dish-actions button { min-width: 2.75rem; min-height: 2.75rem; padding-inline: .65rem; }
}

@media (prefers-reduced-motion: reduce) {
  .catalog-page *, .catalog-page *::before, .catalog-page *::after { scroll-behavior: auto !important; animation: none !important; transition: none !important; }
}
</style>
