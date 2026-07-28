<template>
  <sc-page-shell hide-nav tone="neutral">
    <view class="login-screen">
      <view class="login-content">
        <view class="login-brand">
          <sc-illustration class="login-mark" name="brand" size="small" label="智慧食堂品牌标记" />
          <text class="login-brandline">智慧食堂</text>
          <text class="login-title">认真吃好校园里的每一餐</text>
          <text class="login-subtitle">真实校园目录、到店预约与个人饮食限制同步更新</text>
        </view>

        <view class="login-card panel-card">
          <view class="auth-tabs">
            <button v-for="item in modes" :key="item.value" :class="{ active:mode===item.value }" @tap="switchMode(item.value)"><view>{{ item.label }}</view></button>
          </view>

          <view v-if="mode==='login'" class="auth-form">
            <text class="form-title">登录智慧食堂</text>
            <button class="wechat-btn" open-type="getPhoneNumber" :loading="loadingMode==='wechat'" :disabled="Boolean(loadingMode)" @getphonenumber="loginWithWechat"><sc-icon name="user" :size="18" tone="current" /><text>微信授权手机号登录</text></button>
            <view class="divider"><text></text><text>或使用手机号密码</text><text></text></view>
            <label><text>手机号或账号</text><input v-model="loginForm.identifier" class="input" maxlength="32" placeholder="请输入手机号或账号" /></label>
            <label><text>密码</text><input v-model="loginForm.password" class="input" password maxlength="72" placeholder="请输入密码" /></label>
            <button class="primary-btn" :loading="loadingMode==='account'" :disabled="Boolean(loadingMode)" @tap="loginWithAccount">登录</button>
          </view>

          <view v-else-if="mode==='register'" class="auth-form">
            <text class="form-title">手机号注册</text>
            <label><text>手机号</text><input v-model="registerForm.phone" class="input" type="number" maxlength="11" placeholder="请输入手机号" /></label>
            <label><text>验证码</text><view class="code-row"><input v-model="registerForm.verificationCode" class="input" type="number" maxlength="6" placeholder="6 位验证码" /><button :disabled="codeSending" @tap="sendCode('register')"><view>{{ codeSending?'发送中':'获取验证码' }}</view></button></view></label>
            <label><text>昵称（可选）</text><input v-model="registerForm.nickname" class="input" maxlength="32" placeholder="如何称呼你" /></label>
            <label><text>密码</text><input v-model="registerForm.password" class="input" password maxlength="72" placeholder="8-72 位，包含字母和数字" /></label>
            <label><text>确认密码</text><input v-model="registerForm.confirmPassword" class="input" password maxlength="72" placeholder="再次输入密码" /></label>
            <button class="primary-btn" :loading="loadingMode==='register'" :disabled="Boolean(loadingMode)" @tap="registerAccount">注册并登录</button>
          </view>

          <view v-else class="auth-form">
            <text class="form-title">找回密码</text>
            <label><text>手机号</text><input v-model="resetForm.phone" class="input" type="number" maxlength="11" placeholder="请输入注册手机号" /></label>
            <label><text>验证码</text><view class="code-row"><input v-model="resetForm.verificationCode" class="input" type="number" maxlength="6" placeholder="6 位验证码" /><button :disabled="codeSending" @tap="sendCode('reset_password')"><view>{{ codeSending?'发送中':'获取验证码' }}</view></button></view></label>
            <label><text>新密码</text><input v-model="resetForm.password" class="input" password maxlength="72" placeholder="8-72 位，包含字母和数字" /></label>
            <label><text>确认新密码</text><input v-model="resetForm.confirmPassword" class="input" password maxlength="72" placeholder="再次输入新密码" /></label>
            <button class="primary-btn" :disabled="Boolean(loadingMode)" @tap="resetPassword">确认重设</button>
          </view>

          <checkbox-group class="consent" @change="consentAccepted=$event.detail.value.includes('accepted')">
            <label class="consent-check"><checkbox class="consent-box" value="accepted" :checked="consentAccepted" color="#181A1F" /><text>我已阅读并同意</text></label>
            <view class="consent-links"><button @tap="openPrivacy">《隐私保护指引》</button><text>与</text><button @tap="openTerms">《用户服务协议》</button></view>
          </checkbox-group>
          <text v-if="message" class="login-message" :class="{ error:isError }">{{ message }}</text>
        </view>
      </view>
    </view>
  </sc-page-shell>
</template>

<script setup>
import { onShow } from '@dcloudio/uni-app';
import { reactive, ref } from 'vue';
import { validateLoginForm, validatePhoneAuthForm } from '../../domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const modes = [{value:'login',label:'登录'},{value:'register',label:'注册'},{value:'reset',label:'找回'}];
const mode = ref('login');
const loginForm = reactive({identifier:'',password:''});
const registerForm = reactive({phone:'',verificationCode:'',nickname:'',password:'',confirmPassword:''});
const resetForm = reactive({phone:'',verificationCode:'',password:'',confirmPassword:''});
const consentAccepted = ref(false); const loadingMode = ref(''); const codeSending = ref(false); const message = ref(''); const isError = ref(false);

onShow(async()=>{try{await store.refreshIfStale();if(store.user.value)uni.switchTab({url:'/pages/home/home'});}catch{}});
function switchMode(value){mode.value=value;message.value='';isError.value=false;}
function requireConsent(){if(consentAccepted.value)return true;isError.value=true;message.value='请先同意隐私保护指引和用户服务协议。';return false;}
async function runAuth(type,action){if(!requireConsent())return;loadingMode.value=type;message.value='';isError.value=false;try{await action();uni.switchTab({url:'/pages/home/home'});}catch(error){isError.value=true;message.value=error?.message||'操作失败，请稍后重试。';}finally{loadingMode.value='';}}
function loginWithWechat(event){const phoneCode=event?.detail?.code||'';if(!phoneCode){mode.value='register';isError.value=true;message.value='未授权微信手机号，可改用手机号注册。';return;}return runAuth('wechat',()=>store.wechatLogin({phoneCode,agreementVersion:'2026-07'}));}
function loginWithAccount(){const error=validateLoginForm(loginForm);if(error){isError.value=true;message.value=error;return;}return runAuth('account',()=>store.login({...loginForm}));}
async function sendCode(purpose){if(!requireConsent())return;const phone=purpose==='register'?registerForm.phone:resetForm.phone;if(!/^1[3-9]\d{9}$/.test(phone)){isError.value=true;message.value='请输入有效的中国大陆手机号。';return;}codeSending.value=true;message.value='';try{await store.sendVerificationCode({phone,purpose});message.value='验证码已发送，请在 5 分钟内使用。';isError.value=false;}catch(error){isError.value=true;message.value=error.message;}finally{codeSending.value=false;}}
function registerAccount(){const error=validatePhoneAuthForm(registerForm);if(error){isError.value=true;message.value=error;return;}return runAuth('register',()=>store.register({phone:registerForm.phone,verificationCode:registerForm.verificationCode,password:registerForm.password,nickname:registerForm.nickname||undefined,agreementVersion:'2026-07'}));}
async function resetPassword(){if(!requireConsent())return;const error=validatePhoneAuthForm(resetForm);if(error){isError.value=true;message.value=error;return;}loadingMode.value='reset';try{await store.resetPassword({phone:resetForm.phone,verificationCode:resetForm.verificationCode,newPassword:resetForm.password});Object.assign(loginForm,{identifier:resetForm.phone,password:''});switchMode('login');message.value='密码已重设，请使用新密码登录。';}catch(err){isError.value=true;message.value=err.message;}finally{loadingMode.value='';}}
function openPrivacy(){uni.navigateTo({url:'/pages/privacy/privacy'});} function openTerms(){uni.navigateTo({url:'/pages/terms/terms'});}
</script>

<style scoped>
.login-screen { display:flex; width:auto; min-height:100vh; margin:0 calc(-1 * var(--page-gutter)); padding:32px var(--page-gutter) calc(40px + env(safe-area-inset-bottom)); align-items:flex-start; justify-content:center; background:var(--bg); box-sizing:border-box; }
.login-content { width:100%; max-width:440px; margin:auto; }
.login-brand { margin-bottom:24px; text-align:center; }
.login-mark { margin:0 auto 12px; }
.login-brandline,.login-title,.login-subtitle { display:block; }
.login-brandline { color:var(--brand); font-size:16px; font-weight:600; }
.login-title { margin-top:10px; color:var(--ink); font-size:28px; font-weight:600; line-height:1.35; }
.login-subtitle { margin-top:8px; color:var(--ink-2); font-size:14px; line-height:1.5; }
.login-card { margin:0; padding:20px; border:1px solid var(--line); border-radius:var(--radius-large); background:var(--surface); box-shadow:none; }
.auth-tabs { display:grid; grid-template-columns:repeat(3,1fr); gap:4px; min-height:44px; padding:4px; border-radius:var(--radius); background:var(--surface-soft); }
.auth-tabs button { display:flex; align-items:center; justify-content:center; background:transparent; }
.auth-tabs button view { display:flex; width:100%; height:36px; align-items:center; justify-content:center; border-radius:6px; color:var(--muted); font-size:14px; }
.auth-tabs button.active view { color:var(--ink); background:var(--surface); }
.auth-form { display:grid; gap:12px; margin-top:18px; }
.form-title { display:block; color:var(--ink); font-size:16px; font-weight:600; }
.auth-form label>text { display:block; margin-bottom:6px; color:var(--ink-2); font-size:14px; font-weight:500; }
.wechat-btn { display:flex; min-height:44px; align-items:center; justify-content:center; gap:8px; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink); background:var(--surface-soft); font-size:14px; }.wechat-btn:active { background:var(--surface-strong); transform:translateY(1px); }
.divider { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:12px; }
.divider text:first-child,.divider text:last-child { height:1px; flex:1; background:var(--line); }
.code-row { display:grid; grid-template-columns:minmax(0,1fr) 112px; gap:8px; }
.code-row button { display:flex; min-height:44px; align-items:center; padding:0; }
.code-row button view { display:flex; width:100%; height:44px; align-items:center; justify-content:center; border:1px solid var(--line); border-radius:var(--radius); color:var(--ink); background:var(--surface-soft); font-size:12px; box-sizing:border-box; }
.demo-btn { min-height:44px; color:var(--ink-2); background:transparent; font-size:14px; }
.consent { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; justify-content:center; gap:2px 3px; margin-top:16px; color:var(--muted); font-size:12px; }
.consent label,.consent-links { display:flex; align-items:center; }
.consent-links { min-width:0; flex-wrap:wrap; }
.consent checkbox { transform:scale(.82); }
.consent button { display:inline-flex; min-height:44px; padding:0 1px; align-items:center; color:var(--ink); background:transparent; font-size:12px; }
.login-message { display:block; margin-top:10px; color:var(--ink-2); font-size:14px; text-align:center; }
.login-message.error { color:var(--danger); }
@media (max-width:359px) { .login-card { padding:16px; } .code-row { grid-template-columns:minmax(0,1fr) 104px; } }
@media (max-width:479px) { .consent { grid-template-columns:1fr; }.consent-check,.consent-links { justify-content:center; } }
@media (min-width:768px) { .login-screen { align-items:center; }.login-content { display:grid; max-width:920px; grid-template-columns:minmax(0,.85fr) minmax(420px,1.15fr); gap:24px; align-items:stretch; }.login-brand { display:flex; min-height:520px; flex-direction:column; justify-content:center; margin:0; padding:24px; border:1px solid var(--line); border-radius:var(--radius-large); background:#fbfbfc; text-align:left; box-sizing:border-box; }.login-mark { margin:0 0 18px; }.login-card { align-self:center; }.login-title { font-size:24px; } }
@media (min-width:900px) { .login-content { gap:36px; }.login-brand { padding:40px; }.login-title { font-size:28px; } }
</style>
