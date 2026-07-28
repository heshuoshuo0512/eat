<template>
  <sc-page-shell back title="发布帖子" subtitle="关联真实食堂或菜品" tone="community">
    <view class="publish-form panel-card">
      <view class="form-main">
        <sc-segmented-control v-model="form.targetType" :options="targetOptions" block />
        <view class="form-stack">
        <label><text>食堂</text><picker :range="store.canteens.value" range-key="name" :value="canteenIndex" @change="selectCanteen"><view class="picker-box">{{ selectedCanteen?.name||'请选择食堂' }}<text>⌄</text></view></picker></label>
        <label v-if="form.targetType==='dish'"><text>档口</text><picker :range="availableStalls" range-key="name" :value="stallIndex" @change="selectStall"><view class="picker-box">{{ selectedStall?.name||'请选择档口' }}<text>⌄</text></view></picker></label>
        <label v-if="form.targetType==='dish'"><text>菜品</text><picker :range="availableDishes" range-key="name" :value="dishIndex" @change="selectDish"><view class="picker-box">{{ selectedDish?.name||'请选择菜品' }}<text>⌄</text></view></picker></label>
        <label><text>帖子内容</text><textarea v-model="form.content" class="content-input" maxlength="600" placeholder="味道、份量、排队体验或搭配建议" /><text class="ui-small">{{ form.content.length }}/600</text></label>
        </view>
      </view>
      <view class="form-media">
        <view v-if="form.targetType==='dish'" class="rating-field"><text>菜品评分（可选）</text><view><button v-for="score in 5" :key="score" :class="{active:form.rating===score}" @tap="form.rating=form.rating===score?0:score">{{ score }}</button></view></view>
        <view class="image-field"><text>图片（可选）</text><image v-if="imagePath" class="image-preview" :src="imagePath" mode="aspectFill" /><view v-else class="image-empty"><sc-icon name="camera" :size="20" tone="muted" /><text>添加现场照片</text></view><view class="image-actions"><button class="secondary-btn" @tap="chooseImage">{{ imagePath?'重新选择':'选择图片' }}</button><button v-if="imagePath" class="ghost-btn" @tap="imagePath=''">移除图片</button></view></view>
        <button class="primary-btn submit-button" :loading="submitting" :disabled="submitting" @tap="submit">提交审核</button>
        <text v-if="message" class="message" :class="{error:isError}">{{ message }}</text>
      </view>
    </view>
  </sc-page-shell>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { imageToBase64 } from '../../utils/format.js';
import { useCanteenStore } from '../../stores/canteenStore.js';
const store=useCanteenStore();const targetOptions=[{value:'dish',label:'关联菜品'},{value:'canteen',label:'关联食堂'}];const form=reactive({targetType:'dish',content:'',rating:0});const canteenId=ref('');const stallId=ref('');const dishId=ref('');const imagePath=ref('');const imageSize=ref(0);const submitting=ref(false);const message=ref('');const isError=ref(false);
const selectedCanteen=computed(()=>store.canteens.value.find((item)=>item.id===canteenId.value));const canteenIndex=computed(()=>Math.max(0,store.canteens.value.findIndex((item)=>item.id===canteenId.value)));const availableStalls=computed(()=>store.stalls.value.filter((item)=>item.canteenId===canteenId.value));const selectedStall=computed(()=>availableStalls.value.find((item)=>item.id===stallId.value));const stallIndex=computed(()=>Math.max(0,availableStalls.value.findIndex((item)=>item.id===stallId.value)));const availableDishes=computed(()=>store.dishes.value.filter((item)=>item.stallId===stallId.value));const selectedDish=computed(()=>availableDishes.value.find((item)=>item.id===dishId.value));const dishIndex=computed(()=>Math.max(0,availableDishes.value.findIndex((item)=>item.id===dishId.value)));
onShow(async()=>{try{await store.refreshIfStale();if(!store.user.value)uni.reLaunch({url:'/pages/login/login'});}catch{}});watch(()=>form.targetType,()=>{stallId.value='';dishId.value='';form.rating=0;});
function selectCanteen(event){canteenId.value=store.canteens.value[Number(event.detail.value)]?.id||'';stallId.value='';dishId.value='';}function selectStall(event){stallId.value=availableStalls.value[Number(event.detail.value)]?.id||'';dishId.value='';}function selectDish(event){dishId.value=availableDishes.value[Number(event.detail.value)]?.id||'';}
function chooseImage(){uni.chooseImage({count:1,sizeType:['compressed'],sourceType:['camera','album'],success(result){const file=result.tempFiles?.[0];if(file?.size>4*1024*1024){message.value='请选择 4MB 以内的图片。';isError.value=true;return;}imagePath.value=result.tempFilePaths[0];imageSize.value=file?.size||0;message.value='';}});}
async function submit(){const targetId=form.targetType==='dish'?dishId.value:canteenId.value;if(!targetId||form.content.trim().length<2){message.value='请选择关联对象，并填写至少 2 个字符。';isError.value=true;return;}submitting.value=true;message.value='';isError.value=false;try{let imageUrl='';if(imagePath.value){const extension=String(imagePath.value).split('.').pop()?.toLowerCase();const contentType=extension==='png'?'image/png':extension==='webp'?'image/webp':'image/jpeg';const upload=await store.uploadImage({filename:`campus-post.${extension||'jpg'}`,contentType,dataBase64:await imageToBase64(imagePath.value),sizeBytes:imageSize.value});imageUrl=upload.url||upload.publicUrl||'';}await store.createPost({targetType:form.targetType,targetId,content:form.content.trim(),imageUrl,rating:form.targetType==='dish'&&form.rating?form.rating:null});store.openCommunitySection('posts');message.value='帖子已提交审核。';setTimeout(()=>uni.navigateBack(),700);}catch(error){message.value=error.message||'发布失败';isError.value=true;}finally{submitting.value=false;}}
</script>

<style scoped>
.publish-form { display:grid; gap:20px; padding:16px; }
.form-main,.form-media { min-width:0; }
.form-stack { display:flex; flex-direction:column; gap:16px; margin-top:16px; }
.form-stack label>text,.rating-field>text,.image-field>text { display:block; margin-bottom:7px; color:var(--ink-2); font-size:14px; font-weight:500; }
.picker-box { display:flex; min-height:44px; padding:0 12px; align-items:center; justify-content:space-between; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink); background:var(--surface); font-size:14px; box-sizing:border-box; }
.content-input { width:100%; min-height:160px; padding:12px; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink); background:var(--surface); font-size:14px; line-height:1.58; box-sizing:border-box; }
.form-stack label .ui-small { margin-top:4px; font-size:12px; text-align:right; }
.rating-field { margin-bottom:16px; }
.rating-field>view { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:6px; }
.rating-field button { display:flex; min-height:44px; align-items:center; justify-content:center; border:1px solid var(--line); border-radius:var(--radius); color:var(--muted); background:var(--surface-soft); font-size:14px; font-weight:500; }
.rating-field button.active { color:#fff; border-color:var(--module-accent); background:var(--module-accent); }
.image-field { display:flex; flex-direction:column; }
.image-preview,.image-empty { width:100%; height:220px; border-radius:var(--radius); background:var(--surface-soft); }
.image-preview { display:block; }
.image-empty { display:flex; align-items:center; justify-content:center; gap:8px; border:1px dashed var(--line); color:var(--muted); font-size:14px; box-sizing:border-box; }
.image-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px; }
.submit-button { width:100%; margin-top:16px; }
.message { display:block; margin-top:12px; color:var(--ink-2); font-size:14px; text-align:center; }
.message.error { color:var(--danger); }
@media (min-width:768px) {
  .publish-form { grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr); gap:24px; padding:24px; align-items:start; }
  .form-media { position:sticky; top:72px; }
}
</style>
