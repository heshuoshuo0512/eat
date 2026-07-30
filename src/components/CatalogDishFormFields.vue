<template>
  <div :class="['catalog-dish-fields', { compact }]">
    <fieldset class="dish-field-group">
      <legend>基础信息</legend>
      <label>所属档口
        <select v-model="form.stallId" name="stallId" required @change="$emit('stall-change')">
          <option value="">请选择档口</option>
          <option v-for="stall in stalls" :key="stall.id" :value="stall.id">{{ stall.legacyInputTarget ? `历史层级（仅保留原位编辑） · ${stall.name}` : stall.name }}</option>
        </select>
      </label>
      <label>菜名<input v-model.trim="form.name" name="name" required maxlength="40" /></label>
      <div class="dish-field-grid two">
        <label>目录类型
          <select v-model="form.catalogItemType" name="catalogItemType">
            <option value="meal">餐食</option>
            <option value="snack">小吃单品</option>
            <option value="beverage">饮品</option>
            <option value="addon">加购项</option>
            <option value="fee">费用项</option>
          </select>
        </label>
        <label>展示分类<input v-model.trim="form.catalogCategory" name="catalogCategory" maxlength="30" placeholder="如：火锅配菜、汉堡小吃" /></label>
        <label>价格<input v-model.number="form.price" name="price" type="number" min="1" max="200" step="0.1" required /></label>
        <label>口味<input v-model.trim="form.taste" name="taste" required maxlength="20" /></label>
        <label>菜系<input v-model.trim="form.cuisine" name="cuisine" required maxlength="30" /></label>
        <label>餐次<input v-model.trim="form.mealTypes" name="mealTypes" placeholder="lunch, dinner" /></label>
      </div>
      <label>食材<input v-model="form.ingredients" name="ingredients" required placeholder="鸡肉, 米饭, 西兰花" /></label>
      <label>调味料<input v-model="form.seasonings" name="seasonings" placeholder="盐, 生抽, 花生油" /></label>
      <label>添加物<input v-model="form.additives" name="additives" placeholder="如无可留空" /></label>
      <label>标签<input v-model="form.tags" name="tags" required placeholder="高蛋白, 低脂" /></label>
    </fieldset>

    <fieldset class="dish-field-group">
      <legend>营养与安全</legend>
      <div class="dish-field-grid nutrition">
        <label>热量<input v-model.number="form.calories" name="calories" type="number" min="0" /></label>
        <label>蛋白质<input v-model.number="form.protein" name="protein" type="number" min="0" /></label>
        <label>脂肪<input v-model.number="form.fat" name="fat" type="number" min="0" /></label>
        <label>碳水<input v-model.number="form.carbs" name="carbs" type="number" min="0" /></label>
      </div>
      <label class="dish-switch-row"><input v-model="form.halal" name="halal" type="checkbox" /><span>清真菜品</span></label>
      <label>过敏原<input v-model="form.allergens" name="allergens" placeholder="花生, 牛奶" /></label>
      <div class="dish-field-grid two">
        <label>过敏原声明状态
          <select v-model="form.allergenDeclarationStatus" name="allergenDeclarationStatus">
            <option value="unknown">尚未确认</option>
            <option value="confirmed_present">确认含有</option>
            <option value="confirmed_absent">确认不含</option>
            <option value="cross_contact_possible">可能交叉接触</option>
          </select>
        </label>
        <label>辣度等级
          <select v-model.number="form.spiceLevel" name="spiceLevel">
            <option :value="null">未知</option>
            <option v-for="level in 6" :key="level - 1" :value="level - 1">{{ level - 1 }}</option>
          </select>
        </label>
      </div>
      <label>饮食模式标签<input v-model="form.dietaryLabels" name="dietaryLabels" placeholder="pescatarian, vegetarian, vegan" /></label>
      <small class="field-help">“未登记”不等于“确认不含”。只有经过配方或供应商核验后才能选择确认状态。</small>
    </fieldset>

    <details class="dish-advanced-fields">
      <summary>扩展营养、图片与展示</summary>
      <div class="dish-field-grid nutrition">
        <label>膳食纤维<input v-model.number="form.fiber" name="fiber" type="number" min="0" /></label>
        <label>钠<input v-model.number="form.sodium" name="sodium" type="number" min="0" /></label>
        <label>糖<input v-model.number="form.sugar" name="sugar" type="number" min="0" /></label>
        <label>钙<input v-model.number="form.calcium" name="calcium" type="number" min="0" /></label>
        <label>铁<input v-model.number="form.iron" name="iron" type="number" min="0" step="0.1" /></label>
      </div>
      <div class="dish-field-grid two">
        <label>展示状态
          <select v-model="form.status" name="status">
            <option value="active">上架中</option>
            <option value="hidden">已隐藏</option>
          </select>
        </label>
        <label>图片 URL<input v-model.trim="form.imageUrl" name="imageUrl" type="url" placeholder="https://..." /></label>
        <label>事实来源<input v-model.trim="form.factSource" name="factSource" placeholder="recipe_audit / supplier" /></label>
        <label>数据版本<input v-model.trim="form.dataVersion" name="dataVersion" placeholder="2026.07" /></label>
      </div>
      <div class="dish-field-grid two">
        <label>目录发布状态
          <select v-model="form.reviewStatus" name="reviewStatus">
            <option value="approved">已发布到学生端</option>
            <option value="pending">待人工核验</option>
            <option value="excluded">仅保留在管理目录</option>
          </select>
        </label>
        <label class="dish-switch-row"><input v-model="form.retrievalEligible" name="retrievalEligible" type="checkbox" /><span>允许作为 RAG 检索证据</span></label>
      </div>
      <small class="field-help">加料、收费、规格和栏目行会由服务端强制隔离，不能发布或进入 RAG。小吃、饮品和完整餐食可在人工核验后发布。</small>
      <div class="dish-field-grid nutrition">
        <label v-for="entry in factStatusFields" :key="entry.key">{{ entry.label }}
          <select v-model="form[entry.key]" :name="entry.key">
            <option value="unknown">未知</option>
            <option value="estimated">估算</option>
            <option value="verified">已核验</option>
          </select>
        </label>
      </div>
      <slot name="image-actions"></slot>
      <div v-if="form.imageUrl" class="dish-image-preview"><img :src="form.imageUrl" :alt="form.name || '菜品图片'" /></div>
      <label>描述<textarea v-model.trim="form.description" name="description" rows="4" maxlength="300"></textarea></label>
      <slot name="vision-actions"></slot>
    </details>
  </div>
</template>

<script setup>
const factStatusFields = [
  { key: 'nutritionFactStatus', label: '营养状态' },
  { key: 'recipeFactStatus', label: '配方状态' },
  { key: 'halalFactStatus', label: '清真状态' },
  { key: 'dietaryFactStatus', label: '饮食模式状态' },
  { key: 'spiceFactStatus', label: '辣度状态' }
];

defineProps({
  form: { type: Object, required: true },
  stalls: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false }
});
defineEmits(['stall-change']);
</script>

<style scoped>
.catalog-dish-fields { display: grid; gap: 1rem; }
.catalog-dish-fields label { display: grid; gap: .38rem; color: #344a3b; font-size: .82rem; font-weight: 650; }
.catalog-dish-fields input:not([type="checkbox"]), .catalog-dish-fields select, .catalog-dish-fields textarea { width: 100%; border: 1px solid rgba(31,122,77,.18); border-radius: .42rem; background: #fff; color: #183f2a; padding: .72rem .76rem; }
.catalog-dish-fields input:focus, .catalog-dish-fields select:focus, .catalog-dish-fields textarea:focus { border-color: rgba(31,122,77,.68); box-shadow: 0 0 0 3px rgba(31,122,77,.1); outline: 0; }
.catalog-dish-fields textarea { resize: vertical; }
.dish-field-group { min-width: 0; display: grid; gap: .85rem; margin: 0; border: 0; border-bottom: 1px solid rgba(31,122,77,.12); padding: 0 0 1rem; }
.dish-field-group legend { margin-bottom: .7rem; padding: 0; color: #173f2a; font-size: .96rem; font-weight: 750; }
.dish-field-grid { display: grid; gap: .75rem; }
.dish-field-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.dish-field-grid.nutrition { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.dish-switch-row { display: flex !important; align-items: center; gap: .55rem !important; }
.dish-switch-row input { width: 1.1rem; height: 1.1rem; accent-color: #1f7a4d; }
.field-help { color: #718078; font-size: .75rem; line-height: 1.45; }
.dish-advanced-fields { display: grid; gap: .85rem; border: 1px solid rgba(31,122,77,.13); border-radius: .45rem; background: #fff; padding: .85rem; }
.dish-advanced-fields summary { cursor: pointer; color: #27593c; font-weight: 750; }
.dish-advanced-fields:not([open]) > :not(summary) { display: none; }
.dish-image-preview { overflow: hidden; aspect-ratio: 16 / 9; border: 1px solid rgba(31,122,77,.14); border-radius: .45rem; background: #edf4ee; }
.dish-image-preview img { width: 100%; height: 100%; display: block; object-fit: cover; }
.compact .dish-field-grid.nutrition { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 720px) {
  .dish-field-grid.two, .dish-field-grid.nutrition, .compact .dish-field-grid.nutrition { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 420px) {
  .dish-field-grid.two, .dish-field-grid.nutrition, .compact .dish-field-grid.nutrition { grid-template-columns: 1fr; }
}
</style>
