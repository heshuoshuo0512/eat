<template>
  <sc-page-shell title="用户服务协议" subtitle="Terms of Service" :back="true" status="必读">
    <view class="panel-card legal-card">
      <sc-section eyebrow="TERMS" title="智慧食堂用户服务协议" desc="使用学生端小程序前，请先了解服务边界和用户责任。" />
      <view class="legal-section">
        <text class="legal-title">1. 服务内容</text>
        <text class="legal-text">智慧食堂学生端提供菜单浏览、菜品检索、健康推荐、拍照识餐、智能顾问和评价等校园餐饮辅助服务。</text>
      </view>
      <view class="legal-section">
        <text class="legal-title">2. 账号使用</text>
        <text class="legal-text">用户应使用本人账号或微信授权登录，不得冒用他人身份、共享账号或绕过学校、食堂运营方的权限管理。</text>
      </view>
      <view class="legal-section">
        <text class="legal-title">3. 推荐说明</text>
        <text class="legal-text">健康推荐、拍照识餐和智能顾问为辅助决策工具，结果基于真实菜品数据、用户偏好和模型分析生成，不能替代医生、营养师或学校相关管理要求。</text>
      </view>
      <view class="legal-section">
        <text class="legal-title">4. 用户内容</text>
        <text class="legal-text">用户提交评价、问题或餐食图片时，应确保内容真实、合法、与校园餐饮相关，不得上传违法、侵权或与服务无关的内容。</text>
      </view>
      <view class="legal-section">
        <text class="legal-title">5. 服务变更</text>
        <text class="legal-text">学校或食堂运营方可根据运营、合规和安全需要调整菜单、功能、权限、AI 能力和服务范围，并在必要时提示用户。</text>
      </view>
    </view>
  </sc-page-shell>
</template>

<style scoped>
.legal-card { margin-bottom: 80rpx; }
.legal-section { padding: 22rpx 0; border-bottom: 1rpx solid var(--line); }
.legal-section:last-child { border-bottom: 0; }
.legal-title { display:block; color:var(--ink); font-size:30rpx; font-weight:600; }
.legal-text { display:block; margin-top:12rpx; color:var(--ink-2); font-size:26rpx; line-height:1.7; }
</style>
