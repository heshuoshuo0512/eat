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

  <!-- ═══════════════════════════════════════════════════════════════
       MANAGE PAGE (/admin) — 评价管理 + 数据资产 + 运营概览
       ═══════════════════════════════════════════════════════════════ -->

  <template v-if="isAdmin && isManagePage">
    <!-- 今日菜单概览 -->
    <section class="card admin-form">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Today</p>
          <h2>今日菜单概览</h2>
        </div>
        <div class="table-actions">
          <button class="ghost" type="button" @click="refreshMenus">刷新</button>
          <button class="primary" type="button" @click="publishTodayMenu">一键发布今日菜单</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>日期</th><th>餐段</th><th>食堂</th><th>菜品</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="menu in todayMenus" :key="menu.id">
              <td>{{ menu.date }}</td>
              <td>{{ menu.mealType === 'lunch' ? '午餐' : menu.mealType === 'dinner' ? '晚餐' : menu.mealType === 'breakfast' ? '早餐' : menu.mealType }}</td>
              <td>{{ menu.canteenName || menu.canteenId }}</td>
              <td>{{ menu.items.map((item) => item.dishName || item.dishId).join(' / ') || '未配置' }}</td>
              <td><span class="pill">{{ menu.status === 'published' ? '已发布' : menu.status === 'draft' ? '草稿' : '已下架' }}</span></td>
              <td class="table-actions">
                <button v-if="menu.status !== 'published'" class="primary" type="button" @click="publishSingleMenu(menu.id)">发布</button>
                <button v-if="menu.status === 'published'" class="ghost" type="button" @click="archiveMenu(menu.id)">下架</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!todayMenus.length" class="muted">今日暂无菜单，请在数据录入页面新增。</p>
    </section>

    <!-- 评价审核 -->
    <section class="card admin-form">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Review Moderation</p>
          <h2>评价审核</h2>
        </div>
        <div class="table-actions">
          <span class="pill">共 {{ store.adminReviewTotal }} 条</span>
          <button class="ghost" type="button" @click="refreshReviews">刷新</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>用户</th><th>菜品</th><th>评分</th><th>内容</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="review in store.adminReviews" :key="review.id">
              <td>{{ review.createdAt?.slice(0, 10) }}</td>
              <td>{{ review.user }}</td>
              <td>{{ dishNameById(review.targetId) }}</td>
              <td><span class="pill">{{ review.rating }} ★</span></td>
              <td>{{ review.content }}</td>
              <td>
                <span v-if="review.status === 'pending'" class="table-actions">
                  <button class="ghost" type="button" @click="approveReview(review.id)">批准</button>
                  <button class="ghost danger" type="button" @click="rejectReview(review.id)">拒绝</button>
                </span>
                <span v-else class="pill">{{ review.status === 'approved' ? '已批准' : review.status === 'rejected' ? '已拒绝' : review.status }}</span>
                <button class="ghost danger" type="button" @click="removeReview(review.id)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination" v-if="store.adminReviewTotal > reviewPageSize">
        <button class="ghost" type="button" :disabled="reviewPage === 0" @click="reviewPage--; refreshReviews()">上一页</button>
        <span>{{ reviewPage + 1 }} / {{ Math.ceil(store.adminReviewTotal / reviewPageSize) }}</span>
        <button class="ghost" type="button" :disabled="(reviewPage + 1) * reviewPageSize >= store.adminReviewTotal" @click="reviewPage++; refreshReviews()">下一页</button>
      </div>
      <p v-if="reviewMessage" class="form-message">{{ reviewMessage }}</p>
    </section>

    <!-- 运营数据概览 -->
    <section class="card admin-form">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Operations Dashboard</p>
          <h2>运营数据概览</h2>
        </div>
        <button class="ghost" type="button" @click="refreshAnalytics">刷新</button>
      </div>
      <div class="metric-grid">
        <article>
          <strong>{{ store.adminAnalytics.dishes }}</strong>
          <span>活跃菜品</span>
        </article>
        <article>
          <strong>{{ store.adminAnalytics.menus }}</strong>
          <span>菜单总数</span>
        </article>
        <article>
          <strong>{{ store.adminAnalytics.todayPublished }}</strong>
          <span>今日已发布</span>
        </article>
        <article>
          <strong>{{ store.adminAnalytics.reviews }}</strong>
          <span>评价总数</span>
        </article>
        <article>
          <strong>{{ store.adminAnalytics.users }}</strong>
          <span>注册用户</span>
        </article>
        <article>
          <strong>{{ store.adminAnalytics.avgRating }}</strong>
          <span>平均评分</span>
        </article>
      </div>
      <div v-if="store.adminAnalytics.recentDishes?.length" class="table-wrap">
        <table>
          <thead><tr><th>最近新增菜品</th><th>档口</th><th>价格</th><th>热量</th></tr></thead>
          <tbody>
            <tr v-for="dish in store.adminAnalytics.recentDishes" :key="dish.id">
              <td>{{ dish.name }}</td>
              <td>{{ stallName(dish.stallId) }}</td>
              <td>¥{{ dish.price }}</td>
              <td>{{ dish.nutrition?.calories || 0 }} kcal</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 数据资产 -->
    <section class="grid two-columns align-start">
      <article class="card">
        <div class="section-title horizontal">
          <div>
            <p class="eyebrow">当前数据资产</p>
            <h2>食堂库</h2>
          </div>
          <span class="pill">{{ store.canteens.length }} 个食堂</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>食堂</th><th>位置</th><th>标签</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="canteen in store.canteens" :key="canteen.id">
                <td>{{ canteen.name }}</td>
                <td>{{ canteen.location }}</td>
                <td>{{ canteen.tags.join(' / ') }}</td>
                <td class="table-actions">
                  <button class="ghost" type="button" @click="editCanteen(canteen)">编辑</button>
                  <button class="ghost danger" type="button" @click="removeCanteen(canteen.id)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="card">
        <div class="section-title horizontal">
          <div>
            <p class="eyebrow">当前数据资产</p>
            <h2>菜品营养库</h2>
          </div>
          <span class="pill">{{ store.dishes.length }} 道菜</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>菜品</th><th>档口</th><th>价格</th><th>热量</th><th>标签</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="dish in store.dishes" :key="dish.id">
                <td>{{ dish.name }}</td>
                <td>{{ stallName(dish.stallId) }}</td>
                <td>¥{{ dish.price }}</td>
                <td>{{ dish.nutrition.calories }}</td>
                <td>{{ dish.tags.join(' / ') }}</td>
                <td class="table-actions">
                  <button class="ghost" type="button" @click="editDish(dish)">编辑</button>
                  <button class="ghost danger" type="button" @click="removeDish(dish.id)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>

    <!-- 用户管理与审计日志 -->
    <section class="grid two-columns align-start">
      <article class="card">
        <div class="section-title horizontal">
          <div>
            <p class="eyebrow">User Management</p>
            <h2>用户管理</h2>
          </div>
          <button class="ghost" type="button" @click="refreshUsers">刷新</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>用户名</th><th>昵称</th><th>角色</th><th>注册时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="u in store.adminUsers" :key="u.id">
                <td>{{ u.username }}</td>
                <td>{{ u.nickname }}</td>
                <td><span class="pill">{{ u.role }}</span></td>
                <td>{{ u.createdAt?.slice(0, 10) }}</td>
                <td class="table-actions">
                  <select :value="u.role" @change="changeRole(u.id, $event.target.value)">
                    <option value="student">学生</option>
                    <option value="operator">录入员</option>
                    <option value="stall_admin">档口管理员</option>
                    <option value="canteen_admin">食堂管理员</option>
                    <option value="auditor">审计员</option>
                    <option value="finance">财务</option>
                    <option value="tenant_admin">租户管理员</option>
                    <option value="admin">平台管理员</option>
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="userMessage" class="form-message">{{ userMessage }}</p>
      </article>

      <article class="card">
        <div class="section-title horizontal">
          <div>
            <p class="eyebrow">Audit Trail</p>
            <h2>审计日志</h2>
          </div>
          <span class="pill">共 {{ store.adminAuditTotal }} 条</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>时间</th><th>用户</th><th>操作</th><th>实体</th><th>实体 ID</th></tr></thead>
            <tbody>
              <tr v-for="log in store.adminAuditLogs" :key="log.id">
                <td>{{ log.createdAt?.slice(0, 19).replace('T', ' ') }}</td>
                <td>{{ log.user || '—' }}</td>
                <td><span class="pill">{{ log.action }}</span></td>
                <td>{{ log.entity }}</td>
                <td>{{ log.entityId || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pagination" v-if="store.adminAuditTotal > auditPageSize">
          <button class="ghost" type="button" :disabled="auditPage === 0" @click="auditPage--; refreshAuditLogs()">上一页</button>
          <span>{{ auditPage + 1 }} / {{ Math.ceil(store.adminAuditTotal / auditPageSize) }}</span>
          <button class="ghost" type="button" :disabled="(auditPage + 1) * auditPageSize >= store.adminAuditTotal" @click="auditPage++; refreshAuditLogs()">下一页</button>
        </div>
      </article>
    </section>
  </template>

  <!-- ═══════════════════════════════════════════════════════════════
       ENTRY PAGE (/admin/input) — 数据录入与维护
       ═══════════════════════════════════════════════════════════════ -->

  <template v-if="isAdmin && isEntryPage">
    <!-- 食堂与档口 CRUD -->
    <section class="grid two-columns align-start">
      <form class="card admin-form" @submit.prevent="saveCanteen">
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
        <div v-if="canteenForm.imageUrl" class="vision-preview" style="max-width:200px;margin-bottom:8px;"><img :src="canteenForm.imageUrl" :alt="canteenForm.name || '食堂图片'" /></div>
        <button class="primary" type="submit">{{ canteenForm.id ? '更新食堂' : '保存食堂' }}</button>
      </form>

      <form class="card admin-form" @submit.prevent="saveStall">
        <div class="section-title horizontal">
          <div>
            <p class="eyebrow">Stall CRUD</p>
            <h2>{{ stallForm.id ? '编辑档口' : '新增档口' }}</h2>
          </div>
          <button v-if="stallForm.id" class="ghost" type="button" @click="resetStallForm">取消编辑</button>
        </div>
        <label>所属食堂<select v-model="stallForm.canteenId"><option value="">请选择子食堂</option><option v-for="c in subCanteens" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
        <label>名称<input v-model="stallForm.name" required /></label>
        <label>楼层<input v-model="stallForm.floor" placeholder="1F" required /></label>
        <label>品类<input v-model="stallForm.category" placeholder="健康轻食" required /></label>
        <label>评分<input v-model.number="stallForm.rating" type="number" min="1" max="5" step="0.1" /></label>
        <label>均价<input v-model.number="stallForm.avgPrice" type="number" min="1" /></label>
        <label>描述<textarea v-model="stallForm.description" /></label>
        <label class="check-label"><input v-model="stallForm.open" type="checkbox" /> 营业中</label>
        <button class="primary" type="submit">{{ stallForm.id ? '更新档口' : '保存档口' }}</button>
        <div class="table-wrap" style="margin-top:12px;">
          <table>
            <thead><tr><th>档口</th><th>食堂</th><th>楼层</th><th>品类</th><th>评分</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="stall in store.stalls" :key="stall.id">
                <td>{{ stall.name }}</td>
                <td>{{ canteenNameById(stall.canteenId) }}</td>
                <td>{{ stall.floor }}</td>
                <td>{{ stall.category }}</td>
                <td>{{ stall.rating }}</td>
                <td class="table-actions">
                  <button class="ghost" type="button" @click="editStall(stall)">编辑</button>
                  <button class="ghost danger" type="button" @click="removeStall(stall.id)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </form>
    </section>

    <!-- 菜品 CRUD + 扩展营养 -->
    <section class="grid two-columns align-start">
      <form class="card admin-form" @submit.prevent="saveDish">
        <div class="section-title horizontal">
          <div>
            <p class="eyebrow">Dish + Nutrition</p>
            <h2>{{ dishForm.id ? '编辑菜品' : '新增菜品' }}</h2>
          </div>
          <button v-if="dishForm.id" class="ghost" type="button" @click="resetDishForm">取消编辑</button>
        </div>
        <label>所属档口
          <select v-model="dishForm.stallId">
            <option v-for="stall in store.stalls" :key="stall.id" :value="stall.id">{{ stall.name }}</option>
          </select>
        </label>
        <label>菜名<input v-model="dishForm.name" required /></label>
        <label>价格<input v-model.number="dishForm.price" type="number" min="1" required /></label>
        <label>口味<input v-model="dishForm.taste" required /></label>
        <label>菜系<input v-model="dishForm.cuisine" required /></label>
        <label>食材<input v-model="dishForm.ingredients" placeholder="鸡胸肉, 西兰花" required /></label>
        <label>标签<input v-model="dishForm.tags" placeholder="高蛋白, 减脂推荐" required /></label>
        <label>图片地址<input v-model="dishForm.imageUrl" placeholder="上传后自动填充" /></label>
        <label>上传图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="handleImageFile" /></label>
        <div class="form-grid">
          <label>热量 (kcal)<input v-model.number="dishForm.calories" type="number" required /></label>
          <label>蛋白 (g)<input v-model.number="dishForm.protein" type="number" required /></label>
          <label>脂肪 (g)<input v-model.number="dishForm.fat" type="number" required /></label>
          <label>碳水 (g)<input v-model.number="dishForm.carbs" type="number" required /></label>
        </div>
        <div class="form-grid">
          <label>膳食纤维 (g)<input v-model.number="dishForm.fiber" type="number" min="0" /></label>
          <label>钠 (mg)<input v-model.number="dishForm.sodium" type="number" min="0" /></label>
          <label>糖 (g)<input v-model.number="dishForm.sugar" type="number" min="0" /></label>
          <label>钙 (mg)<input v-model.number="dishForm.calcium" type="number" min="0" /></label>
        </div>
        <div class="form-grid">
          <label>铁 (mg)<input v-model.number="dishForm.iron" type="number" min="0" step="0.1" /></label>
        </div>
        <label class="check-label"><input v-model="dishForm.halal" type="checkbox" /> 清真</label>
        <label>过敏原提示<input v-model="dishForm.allergens" placeholder="花生, 乳制品, 麸质" /></label>
        <div v-if="dishForm.imageUrl" class="vision-preview" style="max-width:240px;margin-bottom:8px;">
          <img :src="dishForm.imageUrl" :alt="dishForm.name || '菜品图片'" />
        </div>
        <button class="primary" type="submit">{{ dishForm.id ? '更新菜品' : '保存菜品' }}</button>
        <p v-if="message" class="form-message">{{ message }}</p>
      </form>

      <!-- 视觉拍照导入 -->
      <div class="card admin-form">
        <div class="section-title horizontal">
          <div>
            <p class="eyebrow">Vision Import</p>
            <h2>视觉拍照导入</h2>
          </div>
          <span class="pill">AI 预填 · 人工确认</span>
        </div>
        <label>拍照/上传菜品图<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" capture="environment" @change="handleVisionFile" /></label>
        <div v-if="visionPreview" class="vision-preview"><img :src="visionPreview" alt="待识别菜品图" /></div>
        <div class="table-actions">
          <button class="primary" type="button" :disabled="visionLoading || !visionFile" @click="identifyVisionDish">{{ visionLoading ? '识别中...' : 'AI 识别并填入表单' }}</button>
          <button class="ghost" type="button" @click="resetVisionImport">清空图片</button>
        </div>
        <article v-if="visionSuggestion" class="mini-card">
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
        <p class="muted">识别结果只用于预填，不会自动入库；请确认价格、档口、营养值后再点击"保存菜品"。</p>
        <p v-if="visionMessage" class="form-message">{{ visionMessage }}</p>
      </div>
    </section>

    <!-- 批量导入 -->
    <section class="card admin-form">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Bulk Import</p>
          <h2>批量导入菜品</h2>
        </div>
        <span class="pill">JSON 数组</span>
      </div>
      <textarea v-model="bulkInput" placeholder='[{"stallId":"stall-1","name":"低脂鸡胸饭","price":16,"taste":"清爽","cuisine":"轻食","ingredients":["鸡胸肉"],"tags":["高蛋白"],"nutrition":{"calories":520,"protein":38,"fat":9,"carbs":68}}]'></textarea>
      <button class="secondary" type="button" @click="importBulkDishes">导入菜品</button>
    </section>

    <!-- CSV 导入 -->
    <section class="card admin-form">
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
    </section>

    <!-- 校园环境 -->
    <section class="card admin-form">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">Campus Environment</p>
          <h2>校园环境数据</h2>
        </div>
        <div class="table-actions">
          <button class="ghost" type="button" @click="refreshEnvironment">刷新环境</button>
          <button class="ghost" type="button" @click="refreshAnalytics">刷新统计</button>
        </div>
      </div>
      <div class="metric-grid">
        <article>
          <strong>{{ environment.temperature }}°C</strong>
          <span>当前温度</span>
        </article>
        <article>
          <strong>{{ environment.weatherLabel }}</strong>
          <span>当前天气</span>
        </article>
        <article>
          <strong>{{ store.adminAnalytics.todayPublished }}</strong>
          <span>今日已发布菜单</span>
        </article>
        <article>
          <strong>{{ store.adminAnalytics.dishes }}</strong>
          <span>活跃菜品</span>
        </article>
      </div>
      <div class="grid two-columns" style="margin-top:12px;">
        <label>温度 (°C)<input v-model.number="environmentForm.temperature" type="number" min="-20" max="50" /></label>
        <label>天气描述<input v-model="environmentForm.weatherLabel" placeholder="晴、多云、小雨、高温" /></label>
      </div>
      <div class="table-actions" style="margin-top:8px;">
        <button class="primary" type="button" @click="saveCampusEnvironment">保存环境数据</button>
      </div>
      <div class="metric-grid" style="margin-top:12px;">
        <article v-for="canteen in store.canteens" :key="canteen.id">
          <strong>{{ canteen.crowdLevel || 0 }}%</strong>
          <span>{{ canteen.name }} 拥挤度</span>
        </article>
      </div>
      <p class="muted">校园温度和天气会实时影响推荐算法（高温推荐消暑菜品，低温推荐暖胃菜品）。</p>
      <p v-if="environmentMessage" class="form-message">{{ environmentMessage }}</p>
    </section>

    <!-- 菜单运营 -->
    <section class="grid two-columns align-start">
      <form class="card admin-form" @submit.prevent="saveMenu">
        <div class="section-title horizontal">
          <div>
            <p class="eyebrow">Menu Ops</p>
            <h2>菜单运营</h2>
          </div>
          <button class="ghost" type="button" @click="refreshMenus">刷新</button>
        </div>
        <label>菜单 ID<input v-model="menuForm.id" placeholder="留空自动生成" /></label>
        <label>食堂<select v-model="menuForm.canteenId"><option v-for="canteen in store.canteens" :key="canteen.id" :value="canteen.id">{{ canteen.name }}</option></select></label>
        <label>日期<input v-model="menuForm.date" type="date" /></label>
        <label>餐段<select v-model="menuForm.mealType"><option value="breakfast">早餐</option><option value="lunch">午餐</option><option value="dinner">晚餐</option></select></label>
        <label>状态<select v-model="menuForm.status"><option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已下架</option></select></label>
        <label>菜品<select v-model="menuItemForm.dishId"><option value="">选择菜品</option><option v-for="dish in store.dishes" :key="dish.id" :value="dish.id">{{ dish.name }}</option></select></label>
        <div class="grid two-columns">
          <label>当日价格<input v-model.number="menuItemForm.price" type="number" min="0" step="0.1" /></label>
          <label>供应数量<input v-model.number="menuItemForm.supplyLimit" type="number" min="0" /></label>
        </div>
        <button class="secondary" type="button" @click="addMenuItem">加入菜单</button>
        <button class="primary" type="submit">保存菜单</button>
        <div v-if="selectedMenuIds.size" class="table-actions" style="margin-top:8px;">
          <span class="pill">已选 {{ selectedMenuIds.size }} 项</span>
          <button class="primary" type="button" @click="batchPublishMenus">批量发布</button>
          <button class="ghost danger" type="button" @click="batchArchiveMenus">批量下架</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th><input type="checkbox" :checked="allMenusSelected" @change="toggleAllMenus" /></th><th>菜单</th><th>菜品</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="menu in store.adminMenus" :key="menu.id">
                <td><input type="checkbox" :checked="selectedMenuIds.has(menu.id)" @change="toggleMenuSelection(menu.id)" /></td>
                <td>{{ menu.date }} {{ menu.mealType }}<br /><span class="muted">{{ menu.canteenName || menu.canteenId }}</span></td>
                <td>{{ menu.items.map((item) => item.dishName || item.dishId).join(' / ') || '未配置' }}</td>
                <td><span class="pill">{{ menu.status }}</span></td>
                <td class="table-actions"><button class="ghost" type="button" @click="editMenu(menu)">编辑</button><button class="ghost danger" type="button" @click="archiveMenu(menu.id)">下架</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </form>

      <!-- 租户管理 -->
      <form class="card admin-form" @submit.prevent="saveTenant">
        <div class="section-title horizontal">
          <div>
            <p class="eyebrow">Tenant Ops</p>
            <h2>租户管理</h2>
          </div>
          <button class="ghost" type="button" @click="refreshTenants">刷新</button>
        </div>
        <label>租户 ID<input v-model="tenantForm.id" placeholder="留空自动生成" /></label>
        <label>名称<input v-model="tenantForm.name" placeholder="例如：未来校园" /></label>
        <label>状态<select v-model="tenantForm.status"><option value="active">启用</option><option value="disabled">停用</option></select></label>
        <label>套餐<input v-model="tenantForm.plan" /></label>
        <label>AI 月额度<input v-model.number="tenantForm.aiQuota" type="number" min="0" /></label>
        <label>存储额度 MB<input v-model.number="tenantForm.storageQuotaMb" type="number" min="0" /></label>
        <button class="primary" type="submit">保存租户</button>
        <div class="table-wrap">
          <table>
            <thead><tr><th>租户</th><th>状态</th><th>套餐</th><th>额度</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="tenant in store.adminTenants" :key="tenant.id">
                <td>{{ tenant.name }}<br /><span class="muted">{{ tenant.id }}</span></td>
                <td><span class="pill">{{ tenant.status }}</span></td>
                <td>{{ tenant.plan }}</td>
                <td>{{ tenant.aiQuota }} AI / {{ tenant.storageQuotaMb }}MB</td>
                <td><button class="ghost" type="button" @click="editTenant(tenant)">编辑</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </form>
    </section>
  </template>

  <!-- ═══════════════════════════════════════════════════════════════
       AI PAGE (/admin/ai) — AI 配置
       ═══════════════════════════════════════════════════════════════ -->

  <template v-if="isAdmin && isAiPage">
    <!-- AI 提供商配置 -->
    <section ref="aiSection" class="card admin-form">
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
          <strong>{{ store.aiStatus.hasKey ? '已配置' : '未配置' }}</strong>
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
      <label>API Key<input v-model="aiForm.apiKey" autocomplete="off" type="password" placeholder="sk-...；留空保存会清空管理员配置的 key" /></label>
      <div class="table-actions">
        <button class="primary" type="button" @click="saveAiProvider">保存并启用</button>
        <button class="secondary" type="button" @click="testAiProvider">测试连接</button>
        <button class="ghost danger" type="button" @click="clearAiProvider">清空配置</button>
      </div>
      <p class="muted">保存后智能体会优先走真实 LLM；检索和推荐仍只基于真实菜品库，AI 失败会自动回退本地模板。</p>
      <p v-if="aiMessage" class="form-message">{{ aiMessage }}</p>
    </section>

    <!-- 测试状态 -->
    <section class="card admin-form">
      <div class="section-title">
        <p class="eyebrow">Test Status</p>
        <h2>连接测试状态</h2>
      </div>
      <div class="metric-grid">
        <article>
          <strong>{{ store.aiStatus?.enabled ? '可用' : '不可用' }}</strong>
          <span>服务状态</span>
        </article>
        <article>
          <strong>{{ store.aiStatus?.chatModel || '—' }}</strong>
          <span>Chat 模型</span>
        </article>
        <article>
          <strong>{{ store.aiStatus?.embeddingModel || '—' }}</strong>
          <span>Embedding 模型</span>
        </article>
        <article>
          <strong>{{ store.aiStatus?.visionModel || '—' }}</strong>
          <span>Vision 模型</span>
        </article>
      </div>
      <p class="muted">使用上方"测试连接"按钮验证 API Key 和模型是否可用。测试会发送一个简单请求并返回模型响应。</p>
    </section>

    <!-- 配额与使用量 -->
    <section class="card admin-form">
      <div class="section-title horizontal">
        <div>
          <p class="eyebrow">AI Governance</p>
          <h2>AI 使用量与成本</h2>
        </div>
        <button class="ghost" type="button" @click="refreshAiUsage">刷新</button>
      </div>
      <article class="mini-card">
        <strong>{{ store.aiQuotaStatus.period }} 月额度</strong>
        <p>{{ store.aiQuotaStatus.used }} / {{ store.aiQuotaStatus.quota }} 次已用</p>
        <p class="muted">剩余 {{ store.aiQuotaStatus.remaining }} 次；额度为 0 表示不限量。</p>
      </article>
      <div class="stats-grid">
        <article v-for="item in store.aiUsageSummary" :key="`${item.feature}-${item.status}`" class="mini-card">
          <strong>{{ item.feature }} · {{ item.status === 'success' ? '成功' : '失败' }}</strong>
          <p>{{ item.count }} 次 · 图像 {{ item.imageCount }} · Token {{ item.inputTokens + item.outputTokens }}</p>
          <p class="muted">均耗时 {{ item.avgLatencyMs }}ms · 估算成本 ¥{{ item.estimatedCost.toFixed(4) }}</p>
        </article>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>功能</th><th>模型</th><th>状态</th><th>Token/图像</th><th>耗时</th></tr></thead>
          <tbody>
            <tr v-for="log in store.aiUsageLogs" :key="log.id">
              <td>{{ log.createdAt?.slice(0, 19).replace('T', ' ') }}</td>
              <td>{{ log.feature }}<br /><span class="muted">{{ log.provider }}</span></td>
              <td>{{ log.model || 'fallback' }}</td>
              <td><span class="pill">{{ log.status }}</span></td>
              <td>{{ log.inputTokens + log.outputTokens }} / {{ log.imageCount }}</td>
              <td>{{ log.latencyMs }}ms</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 部署就绪度 -->
    <section v-if="deploymentReadiness" class="card admin-form">
      <div class="section-title">
        <p class="eyebrow">Deployment Readiness</p>
        <h2>部署就绪度</h2>
      </div>
      <div class="metric-grid">
        <article v-for="(check, key) in deploymentReadiness.checks || {}" :key="key">
          <strong>{{ check.pass ? '✓' : '✗' }}</strong>
          <span>{{ check.label || key }}</span>
        </article>
      </div>
      <p v-if="deploymentReadiness.summary" class="muted">{{ deploymentReadiness.summary }}</p>
    </section>
  </template>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { assertNumber, assertText, parseList, validateImageFile } from '../domain/validation.js';
import { useRoute } from 'vue-router';
import { useCanteenStore } from '../stores/canteenStore.js';

const store = useCanteenStore();
const route = useRoute();
const adminRoleSet = new Set(['operator', 'stall_admin', 'canteen_admin', 'auditor', 'finance', 'tenant_admin', 'admin', 'super_admin']);
const isAdmin = computed(() => store.user && adminRoleSet.has(store.user.role));
const isAiPage = computed(() => route.path === '/admin/ai' || route.query.panel === 'ai');
const isEntryPage = computed(() => route.path === '/admin/input');
const isManagePage = computed(() => route.path === '/admin');
const pageMeta = computed(() => {
  if (isAiPage.value) return { eyebrow: 'AI 配置', title: 'AI 提供商与部署配置', description: '配置 OpenAI-compatible API，查看模型状态、连接测试、使用量、配额和部署就绪度。' };
  if (isEntryPage.value) return { eyebrow: '数据录入与维护', title: '数据录入与维护', description: '录入食堂、档口、菜品（含扩展营养）、CSV/视觉拍照批量导入、校园环境数据和菜单发布。' };
  return { eyebrow: '评价管理', title: '评价管理与运营概览', description: '评价审核（批准/拒绝/删除）、数据资产查看、用户管理和审计日志。' };
});
const message = ref('');
const bulkInput = ref('');
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
const visionFile = ref(null);
const visionPreview = ref('');
const visionSuggestion = ref(null);
const visionMessage = ref('');
const visionLoading = ref(false);
const tenantForm = reactive(defaultTenantForm());
const menuForm = reactive(defaultMenuForm());
const menuItemForm = reactive(defaultMenuItemForm());
const deploymentReadiness = ref(null);
const environmentMessage = ref('');

const environment = computed(() => store.adminEnvironment || { temperature: 25, weatherLabel: '晴' });
const primaryCanteens = computed(() => store.canteens.filter((c) => c.canteenType === 'primary' || (!c.canteenType && !c.parentId)));
const subCanteens = computed(() => store.canteens.filter((c) => c.canteenType === 'sub' || c.parentId));
const environmentForm = reactive({ temperature: 25, weatherLabel: '晴' });

const selectedMenuIds = ref(new Set());
const reviewPage = ref(0);
const reviewPageSize = 20;
const reviewMessage = ref('');

const auditPage = ref(0);
const auditPageSize = 20;
const aiUsagePage = ref(0);
const aiUsagePageSize = 50;

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
  return { id: '', canteenId: '', name: '', floor: '1F', category: '', rating: 4.5, avgPrice: 15, description: '', open: true };
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

function stallName(id) {
  return store.stalls.find((stall) => stall.id === id)?.name || '未绑定';
}

function dishNameById(id) {
  const dish = store.dishes.find((d) => d.id === id);
  return dish ? dish.name : id || '—';
}

function canteenNameById(id) {
  const canteen = store.canteens.find((c) => c.id === id);
  return canteen ? canteen.name : id || '—';
}

function resetCanteenForm() {
  Object.assign(canteenForm, defaultCanteenForm());
}

function resetDishForm() {
  Object.assign(dishForm, defaultDishForm());
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

async function saveCanteen() {
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
    resetCanteenForm();
    message.value = '食堂已保存到数据库。';
  } catch (error) {
    message.value = error.message;
  }
}

async function saveStall() {
  try {
    const payload = {
      id: stallForm.id || undefined,
      canteenId: stallForm.canteenId,
      name: assertText(stallForm.name, '档口名称', 2, 40),
      floor: assertText(stallForm.floor, '楼层', 1, 10),
      category: assertText(stallForm.category, '品类', 2, 30),
      rating: assertNumber(stallForm.rating, '评分', 1, 5),
      avgPrice: assertNumber(stallForm.avgPrice, '均价', 1, 200),
      description: stallForm.description || '',
      open: stallForm.open
    };
    await store.upsertStall(payload);
    resetStallForm();
    message.value = '档口已保存到数据库。';
  } catch (error) {
    message.value = error.message;
  }
}

function editStall(stall) {
  Object.assign(stallForm, stall);
}

async function removeStall(id) {
  try {
    await store.deleteStall(id);
    message.value = '档口已删除。';
  } catch (error) {
    message.value = error.message;
  }
}

function resetStallForm() {
  Object.assign(stallForm, defaultStallForm());
}

async function saveDish() {
  try {
    if (!dishForm.stallId) throw new Error('请选择所属档口。');
    await store.upsertDish(dishPayload());
    resetDishForm();
    message.value = '菜品和营养数据已保存到数据库。';
  } catch (error) {
    message.value = error.message;
  }
}

function editCanteen(canteen) {
  Object.assign(canteenForm, { ...canteen, tags: canteen.tags.join(', ') });
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
  Object.assign(dishForm, {
    ...dish,
    ingredients: dish.ingredients.join(', '),
    tags: dish.tags.join(', '),
    imageUrl: dish.imageUrl || '',
    calories: dish.nutrition.calories,
    protein: dish.nutrition.protein,
    fat: dish.nutrition.fat,
    carbs: dish.nutrition.carbs,
    fiber: dish.nutrition.fiber || 0,
    sodium: dish.nutrition.sodium || 0,
    sugar: dish.nutrition.sugar || 0,
    calcium: dish.nutrition.calcium || 0,
    iron: dish.nutrition.iron || 0
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

async function importBulkDishes() {
  try {
    const dishes = JSON.parse(bulkInput.value);
    if (!Array.isArray(dishes) || !dishes.length) throw new Error('批量导入内容必须是非空 JSON 数组。');
    const imported = await store.importDishes(dishes);
    bulkInput.value = '';
    message.value = `已导入 ${imported} 道菜。`;
  } catch (error) {
    message.value = error.message;
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

async function refreshEnvironment() {
  try {
    await store.loadEnvironment();
    const env = store.adminEnvironment || { temperature: 25, weatherLabel: '晴' };
    environmentForm.temperature = env.temperature ?? 25;
    environmentForm.weatherLabel = env.weatherLabel || '晴';
    environmentMessage.value = '';
  } catch (error) {
    environmentMessage.value = error.message;
  }
}

async function saveCampusEnvironment() {
  try {
    await store.saveEnvironment({
      temperature: assertNumber(environmentForm.temperature, '温度', -20, 50),
      weatherLabel: assertText(environmentForm.weatherLabel, '天气描述', 1, 20)
    });
    environmentMessage.value = '校园环境数据已保存。';
  } catch (error) {
    environmentMessage.value = error.message;
  }
}

async function refreshReviews() {
  try {
    await store.loadReviewsAdmin(reviewPageSize, reviewPage.value * reviewPageSize);
    reviewMessage.value = '';
  } catch (error) {
    reviewMessage.value = error.message;
  }
}

async function approveReview(id) {
  try {
    await store.approveReviewAdmin(id);
    reviewMessage.value = '评价已批准。';
    await refreshReviews();
  } catch (error) {
    reviewMessage.value = error.message;
  }
}

async function rejectReview(id) {
  try {
    await store.rejectReviewAdmin(id);
    reviewMessage.value = '评价已拒绝。';
    await refreshReviews();
  } catch (error) {
    reviewMessage.value = error.message;
  }
}

async function removeReview(id) {
  try {
    await store.deleteReviewAdmin(id);
    reviewMessage.value = '评价已删除。';
  } catch (error) {
    reviewMessage.value = error.message;
  }
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
    aiMessage.value = '';
  } catch (error) {
    aiMessage.value = error.message;
  }
}

async function saveAiProvider() {
  try {
    const payload = { ...aiForm, timeoutMs: assertNumber(aiForm.timeoutMs, 'AI 超时', 1000, 60000) };
    await store.saveAiSettings(payload);
    aiForm.apiKey = '';
    aiMessage.value = 'AI 配置已保存，智能体将优先使用真实模型。';
    await refreshAiSettings();
  } catch (error) {
    aiMessage.value = error.message;
  }
}

async function testAiProvider() {
  try {
    const result = await store.testAiSettings({ ...aiForm, timeoutMs: assertNumber(aiForm.timeoutMs, 'AI 超时', 1000, 60000) });
    aiMessage.value = `连接成功：${result.model} 返回 ${result.sample}`;
  } catch (error) {
    aiMessage.value = error.message;
  }
}

async function clearAiProvider() {
  try {
    await store.clearAiSettings();
    applyAiSettings({});
    aiMessage.value = 'AI 配置已清空，已回退本地模板。';
  } catch (error) {
    aiMessage.value = error.message;
  }
}

async function refreshAiUsage() {
  try {
    await store.loadAiUsage(aiUsagePageSize, aiUsagePage.value * aiUsagePageSize);
  } catch (error) {
    aiMessage.value = error.message;
  }
}

async function refreshTenants() {
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
  aiSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function initializeAdminPage() {
  if (!isAdmin.value) return;
  if (isAiPage.value) {
    await refreshAiSettings();
    await refreshAiUsage();
    try {
      deploymentReadiness.value = await store.loadDeploymentReadiness();
    } catch { /* silent */ }
    await scrollToRequestedPanel();
    return;
  }
  if (isEntryPage.value) {
    refreshMenus();
    refreshAnalytics();
    refreshEnvironment();
    return;
  }
  // Manage page
  refreshTenants();
  refreshMenus();
  refreshUsers();
  refreshAuditLogs();
  refreshAnalytics();
  refreshReviews();
}

onBeforeUnmount(resetVisionImport);

onMounted(initializeAdminPage);

watch(() => [route.path, route.query.panel, store.user?.role], initializeAdminPage);
</script>
