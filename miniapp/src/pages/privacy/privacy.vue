<template>
  <sc-page-shell title="隐私保护指引" subtitle="Privacy Notice" :back="true" status="必读">
    <view class="panel-card legal-card">
      <sc-section eyebrow="PRIVACY" title="智慧食堂隐私保护指引" desc="说明学生端小程序如何收集、使用和保护个人信息。" />
      <view class="legal-section">
        <text class="legal-title">1. 收集的信息</text>
        <text class="legal-text">为提供微信登录、菜单推荐、拍照识餐和智能顾问服务，小程序会处理微信登录标识、账号信息、健康偏好、预算、忌口、评价内容、用户主动上传的餐食图片和接口访问记录。</text>
      </view>
      <view class="legal-section">
        <text class="legal-title">2. 使用目的</text>
        <text class="legal-text">信息仅用于身份识别、展示真实菜单、生成健康餐单、识别餐食营养、提供带菜品引用的建议、保障账号安全和排查服务异常。</text>
      </view>
      <view class="legal-section">
        <text class="legal-title">3. 图片和 AI 服务</text>
        <text class="legal-text">拍照识餐只处理用户主动选择的餐食图片。智能顾问只基于真实菜品引用和健康档案回答，不用于生成与菜品无关的用户画像。</text>
      </view>
      <view class="legal-section">
        <text class="legal-title">4. 信息保护</text>
        <text class="legal-text">服务端使用登录鉴权、角色权限、请求追踪、租户隔离和审计日志保护数据。小程序端不会保存或展示后端 AI 密钥、微信 AppSecret 等敏感配置。</text>
      </view>
      <view class="legal-section">
        <text class="legal-title">5. 用户权利</text>
        <text class="legal-text">用户可以在“我的”和“健康推荐”中查看或修改健康偏好。需要删除账号、删除评价或导出个人数据时，应联系系统管理员按学校或食堂运营方流程处理。</text>
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
