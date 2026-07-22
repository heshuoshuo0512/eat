<template>
  <fieldset :class="['catalog-area-fields', { compact }]">
    <legend>{{ entityLabel }}信息</legend>
    <p class="field-intro">名称、位置、营业时间和展示信息</p>
    <label>名称<input v-model.trim="form.name" required maxlength="40" /></label>
    <div class="area-field-grid two">
      <label>位置<input v-model.trim="form.location" required maxlength="80" /></label>
      <label>营业时间<input v-model.trim="form.hours" required placeholder="07:00 - 21:00" /></label>
    </div>
    <label>标签<input v-model="form.tags" placeholder="早餐, 清真, 夜宵" /></label>
    <label>简介<textarea v-model.trim="form.description" rows="4" required maxlength="300"></textarea></label>
    <details class="area-advanced-fields">
      <summary>图片与客流设置</summary>
      <div class="area-field-grid two">
        <label>拥挤度<input v-model.number="form.crowdLevel" type="number" min="0" max="100" /></label>
        <label>图片 URL<input v-model.trim="form.imageUrl" type="url" placeholder="https://..." /></label>
      </div>
      <div v-if="form.imageUrl" class="area-image-preview"><img :src="form.imageUrl" :alt="form.name || entityLabel" /></div>
      <slot name="image-actions"></slot>
    </details>
  </fieldset>
</template>

<script setup>
defineProps({
  form: { type: Object, required: true },
  entityLabel: { type: String, default: '餐饮分区' },
  compact: { type: Boolean, default: false }
});
</script>

<style scoped>
.catalog-area-fields { min-width: 0; display: grid; gap: .85rem; margin: 0; border: 0; padding: 0; }
.catalog-area-fields legend { padding: 0; color: #173f2a; font-size: .96rem; font-weight: 750; }
.field-intro { margin: -.55rem 0 0; color: #6b776e; font-size: .78rem; }
.catalog-area-fields label { display: grid; gap: .38rem; color: #344a3b; font-size: .82rem; font-weight: 650; }
.catalog-area-fields input, .catalog-area-fields textarea { width: 100%; border: 1px solid rgba(31,122,77,.18); border-radius: .42rem; background: #fff; color: #183f2a; padding: .72rem .76rem; }
.catalog-area-fields input:focus, .catalog-area-fields textarea:focus { border-color: rgba(31,122,77,.68); box-shadow: 0 0 0 3px rgba(31,122,77,.1); outline: 0; }
.catalog-area-fields textarea { resize: vertical; }
.area-field-grid { display: grid; gap: .75rem; }
.area-field-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.area-advanced-fields { display: grid; gap: .85rem; border: 1px solid rgba(31,122,77,.13); border-radius: .45rem; background: #fff; padding: .85rem; }
.area-advanced-fields summary { cursor: pointer; color: #27593c; font-weight: 750; }
.area-advanced-fields:not([open]) > :not(summary) { display: none; }
.area-image-preview { overflow: hidden; aspect-ratio: 16 / 9; border-radius: .42rem; background: #edf4ee; }
.area-image-preview img { width: 100%; height: 100%; display: block; object-fit: cover; }
@media (max-width: 560px) { .area-field-grid.two { grid-template-columns: 1fr; } }
</style>
