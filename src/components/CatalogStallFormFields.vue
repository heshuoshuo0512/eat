<template>
  <fieldset :class="['catalog-stall-fields', { compact }]">
    <legend>档口信息</legend>
    <p class="field-intro">档口统一直属餐厅或楼层餐区</p>
    <label>所属{{ areaLabel }}
      <select v-model="form.canteenId" name="canteenId" required @change="$emit('area-change')">
        <option value="">请选择{{ areaLabel }}</option>
        <option v-for="area in areas" :key="area.id" :value="area.id">{{ area.name }}</option>
      </select>
    </label>
    <label>档口名称<input v-model.trim="form.name" name="name" required maxlength="40" /></label>
    <div class="stall-field-grid two">
      <label>楼层<input v-model.trim="form.floor" name="floor" required maxlength="10" placeholder="1F" /></label>
      <label>品类<input v-model.trim="form.category" name="category" required maxlength="30" placeholder="健康轻食" /></label>
      <label>评分<input v-model.number="form.rating" name="rating" type="number" min="1" max="5" step="0.1" required /></label>
      <label>人均价格<input v-model.number="form.avgPrice" name="avgPrice" type="number" min="1" max="200" required /></label>
    </div>
    <label class="stall-switch-row"><input v-model="form.open" name="open" type="checkbox" /><span>当前营业</span></label>
    <label>简介<textarea v-model.trim="form.description" name="description" rows="4" maxlength="300"></textarea></label>
  </fieldset>
</template>

<script setup>
defineProps({
  form: { type: Object, required: true },
  areas: { type: Array, default: () => [] },
  areaLabel: { type: String, default: '餐饮分区' },
  compact: { type: Boolean, default: false }
});
defineEmits(['area-change']);
</script>

<style scoped>
.catalog-stall-fields { min-width: 0; display: grid; gap: .85rem; margin: 0; border: 0; padding: 0; }
.catalog-stall-fields legend { padding: 0; color: #173f2a; font-size: .96rem; font-weight: 750; }
.field-intro { margin: -.55rem 0 0; color: #6b776e; font-size: .78rem; }
.catalog-stall-fields label { display: grid; gap: .38rem; color: #344a3b; font-size: .82rem; font-weight: 650; }
.catalog-stall-fields input:not([type="checkbox"]), .catalog-stall-fields select, .catalog-stall-fields textarea { width: 100%; border: 1px solid rgba(31,122,77,.18); border-radius: .42rem; background: #fff; color: #183f2a; padding: .72rem .76rem; }
.catalog-stall-fields input:focus, .catalog-stall-fields select:focus, .catalog-stall-fields textarea:focus { border-color: rgba(31,122,77,.68); box-shadow: 0 0 0 3px rgba(31,122,77,.1); outline: 0; }
.catalog-stall-fields textarea { resize: vertical; }
.stall-field-grid { display: grid; gap: .75rem; }
.stall-field-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.stall-switch-row { display: flex !important; align-items: center; gap: .55rem !important; }
.stall-switch-row input { width: 1.1rem; height: 1.1rem; accent-color: #1f7a4d; }
@media (max-width: 560px) { .stall-field-grid.two { grid-template-columns: 1fr; } }
</style>
