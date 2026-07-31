<template>
  <sc-page-shell hide-nav tone="neutral">
    <view class="login-screen">
      <view class="login-content">
        <view class="login-brand">
          <text class="login-brandline">智慧食堂</text>
          <text class="login-subtitle">校园每一餐，都有真实依据</text>
        </view>

        <view class="login-card panel-card">
          <view class="auth-tabs">
            <button v-for="item in modes" :key="item.value" class="auth-tab" :class="{ active:mode===item.value }" @tap="switchMode(item.value)">{{ item.label }}</button>
          </view>

          <view class="panel-wrapper">
            <view v-if="mode==='login'" class="auth-form login-form">
              <label class="input-group"><text class="form-label">手机号或账号</text><view class="input-wrap"><input v-model="loginForm.identifier" class="input auth-input" maxlength="32" placeholder="请输入手机号或账号" /></view></label>
              <label class="input-group"><text class="form-label">密码</text><view class="input-wrap"><input v-model="loginForm.password" class="input auth-input" password maxlength="72" placeholder="请输入密码" /></view></label>
              <button class="primary-btn" :loading="loadingMode==='account'" :disabled="Boolean(loadingMode)" @tap="loginWithAccount">登录</button>
              <view class="aux-row"><button class="forgot-button" @tap="switchMode('reset')">忘记密码？</button></view>
            </view>

            <view v-else-if="mode==='register'" class="auth-form">
              <text class="form-title">手机号注册</text>
              <label class="input-group"><text class="form-label">手机号</text><view class="input-wrap"><text class="phone-prefix">+86</text><input v-model="registerForm.phone" class="input auth-input" type="number" maxlength="11" placeholder="请输入手机号码" /></view></label>
              <label class="input-group"><text class="form-label">注册码（可选）</text><view class="input-wrap"><input v-model="registerForm.invitationCode" class="input auth-input" maxlength="64" placeholder="填写后无需短信验证码" /></view></label>
              <label class="input-group"><text class="form-label">短信验证码（未填注册码时必填）</text><view class="code-row"><view class="input-wrap"><input v-model="registerForm.verificationCode" class="input auth-input" type="number" maxlength="6" placeholder="6 位验证码" /></view><button class="code-button" :disabled="codeSending || Boolean(registerForm.invitationCode)" @tap="sendCode('register')">{{ codeSending?'发送中':'获取验证码' }}</button></view></label>
              <label class="input-group"><text class="form-label">昵称（可选）</text><view class="input-wrap"><input v-model="registerForm.nickname" class="input auth-input" maxlength="32" placeholder="如何称呼你" /></view></label>
              <label class="input-group"><text class="form-label">密码</text><view class="input-wrap"><input v-model="registerForm.password" class="input auth-input" password maxlength="72" placeholder="8-72 位，包含字母和数字" /></view></label>
              <label class="input-group"><text class="form-label">确认密码</text><view class="input-wrap"><input v-model="registerForm.confirmPassword" class="input auth-input" password maxlength="72" placeholder="再次输入密码" /></view></label>
              <button class="primary-btn" :loading="loadingMode==='register'" :disabled="Boolean(loadingMode)" @tap="registerAccount">注册并登录</button>
            </view>

            <view v-else class="auth-form">
              <text class="form-title">找回密码</text>
              <label class="input-group"><text class="form-label">手机号</text><view class="input-wrap"><text class="phone-prefix">+86</text><input v-model="resetForm.phone" class="input auth-input" type="number" maxlength="11" placeholder="请输入注册手机号" /></view></label>
              <label class="input-group"><text class="form-label">验证码</text><view class="code-row"><view class="input-wrap"><input v-model="resetForm.verificationCode" class="input auth-input" type="number" maxlength="6" placeholder="6 位验证码" /></view><button class="code-button" :disabled="codeSending" @tap="sendCode('reset_password')">{{ codeSending?'发送中':'获取验证码' }}</button></view></label>
              <label class="input-group"><text class="form-label">新密码</text><view class="input-wrap"><input v-model="resetForm.password" class="input auth-input" password maxlength="72" placeholder="8-72 位，包含字母和数字" /></view></label>
              <label class="input-group"><text class="form-label">确认新密码</text><view class="input-wrap"><input v-model="resetForm.confirmPassword" class="input auth-input" password maxlength="72" placeholder="再次输入密码" /></view></label>
              <button class="primary-btn" :disabled="Boolean(loadingMode)" @tap="resetPassword">确认重设</button>
              <button class="back-button" @tap="switchMode('login')"><sc-icon name="arrow-left" :size="16" tone="muted" /><text>返回登录</text></button>
            </view>
          </view>

          <checkbox-group class="consent" @change="setConsent">
            <label class="consent-check"><checkbox class="consent-box" value="accepted" :checked="consentAccepted" color="#181A1F" /><text>我已阅读并同意</text></label>
            <view class="consent-links"><button @tap="openTerms">《用户协议》</button><text>和</text><button @tap="openPrivacy">《隐私声明》</button></view>
          </checkbox-group>

          <view v-if="mode==='login'" class="social-login">
            <view class="social-divider"><text></text><text>其他方式登录</text><text></text></view>
            <button class="wechat-btn" aria-label="微信登录" @tap="openWechatSheet"><sc-icon name="message" :size="20" tone="current" /></button>
          </view>
          <text v-if="message" class="login-message" :class="{ error:isError }">{{ message }}</text>
        </view>
      </view>

      <view v-if="wechatSheetOpen" class="sheet-layer">
        <button class="sheet-mask" aria-label="关闭微信登录" @tap="wechatSheetOpen=false"></button>
        <view class="bottom-sheet">
          <view class="sheet-handle"></view>
          <text class="sheet-title">微信登录</text>
          <button class="wechat-login-btn" open-type="getPhoneNumber" :loading="loadingMode==='wechat'" :disabled="Boolean(loadingMode)" @getphonenumber="loginWithWechat"><sc-icon name="message" :size="20" tone="inverted" /><text>微信授权手机号登录</text></button>
          <checkbox-group class="sheet-consent" @change="setConsent"><label><checkbox value="accepted" :checked="consentAccepted" color="#07C160" /><text>已阅读并同意用户协议和隐私声明</text></label></checkbox-group>
        </view>
      </view>
    </view>
  </sc-page-shell>
</template>

<script setup>
import { onShow } from '@dcloudio/uni-app';
import { reactive, ref } from 'vue';
import { validateLoginForm, validatePhoneAuthForm, validateRegistrationForm } from '../../domain/validation.js';
import { useCanteenStore } from '../../stores/canteenStore.js';

const store = useCanteenStore();
const modes = [{value:'login',label:'登录'},{value:'register',label:'注册'}];
const mode = ref('login');
const loginForm = reactive({identifier:'',password:''});
const registerForm = reactive({phone:'',invitationCode:'',verificationCode:'',nickname:'',password:'',confirmPassword:''});
const resetForm = reactive({phone:'',verificationCode:'',password:'',confirmPassword:''});
const consentAccepted = ref(false);
const loadingMode = ref('');
const codeSending = ref(false);
const message = ref('');
const isError = ref(false);
const wechatSheetOpen = ref(false);
onShow(async()=>{
  try { await store.refreshIfStale(); if(store.user.value)uni.switchTab({url:'/pages/home/home'}); } catch {}
});
function switchMode(value){mode.value=['register','reset'].includes(value)?value:'login';wechatSheetOpen.value=false;message.value='';isError.value=false;}
function setConsent(event){consentAccepted.value=event.detail.value.includes('accepted');}
function openWechatSheet(){wechatSheetOpen.value=true;message.value='';isError.value=false;}
function requireConsent(){if(consentAccepted.value)return true;isError.value=true;message.value='请先同意隐私声明和用户协议。';return false;}
async function runAuth(type,action){if(!requireConsent())return;loadingMode.value=type;message.value='';isError.value=false;try{await action();uni.switchTab({url:'/pages/home/home'});}catch(error){isError.value=true;message.value=error?.message||'操作失败，请稍后重试。';}finally{loadingMode.value='';}}
function loginWithWechat(event){const phoneCode=event?.detail?.code||'';if(!phoneCode){wechatSheetOpen.value=false;mode.value='register';isError.value=true;message.value='未授权微信手机号，可改用手机号注册。';return;}return runAuth('wechat',()=>store.wechatLogin({phoneCode,agreementVersion:'2026-07'}));}
function loginWithAccount(){const error=validateLoginForm(loginForm);if(error){isError.value=true;message.value=error;return;}return runAuth('account',()=>store.login({...loginForm}));}
async function sendCode(purpose){if(!requireConsent())return;if(purpose==='register'&&registerForm.invitationCode.trim()){isError.value=true;message.value='已填写注册码，无需短信验证码。';return;}const phone=purpose==='register'?registerForm.phone:resetForm.phone;if(!/^1[3-9]\d{9}$/.test(phone)){isError.value=true;message.value='请输入有效的中国大陆手机号。';return;}codeSending.value=true;message.value='';try{await store.sendVerificationCode({phone,purpose});message.value='验证码已发送，请在 5 分钟内使用。';isError.value=false;}catch(error){isError.value=true;message.value=error.message;}finally{codeSending.value=false;}}
function registerAccount(){const error=validateRegistrationForm(registerForm);if(error){isError.value=true;message.value=error;return;}const payload={phone:registerForm.phone,password:registerForm.password,nickname:registerForm.nickname||undefined,agreementVersion:'2026-07'};if(registerForm.invitationCode.trim())payload.invitationCode=registerForm.invitationCode.trim();else payload.verificationCode=registerForm.verificationCode.trim();return runAuth('register',()=>store.register(payload));}
async function resetPassword(){if(!requireConsent())return;const error=validatePhoneAuthForm(resetForm);if(error){isError.value=true;message.value=error;return;}loadingMode.value='reset';try{await store.resetPassword({phone:resetForm.phone,verificationCode:resetForm.verificationCode,newPassword:resetForm.password});Object.assign(loginForm,{identifier:resetForm.phone,password:''});switchMode('login');message.value='密码已重设，请使用新密码登录。';}catch(err){isError.value=true;message.value=err.message;}finally{loadingMode.value='';}}
function openPrivacy(){uni.navigateTo({url:'/pages/privacy/privacy'});}
function openTerms(){uni.navigateTo({url:'/pages/terms/terms'});}
</script>

<style scoped>
.login-screen { position:relative; display:flex; width:auto; min-height:100vh; margin:0 calc(-1 * var(--page-gutter)); padding:64px 32px calc(32px + env(safe-area-inset-bottom)); align-items:flex-start; justify-content:center; overflow:hidden; background:var(--bg); box-sizing:border-box; }
.login-content { display:flex; width:100%; max-width:440px; min-height:calc(100vh - 96px - env(safe-area-inset-bottom)); flex-direction:column; }
.login-brand { margin-bottom:44px; text-align:center; animation:brand-in 360ms var(--ease-standard) both; }
.login-brandline,.login-subtitle { display:block; }
.login-brandline { color:var(--ink); font-size:28px; font-weight:600; line-height:1.25; }
.login-subtitle { margin-top:8px; color:var(--muted); font-size:14px; line-height:1.5; }
.login-card { display:flex; flex:1; flex-direction:column; margin:0; padding:0; border:0; border-radius:0; background:transparent; box-shadow:none; }
.auth-tabs { display:flex; min-height:44px; align-items:center; margin-bottom:24px; }
.auth-tab { position:relative; min-height:44px; padding:0; color:var(--muted); background:transparent; font-size:16px; font-weight:600; }
.auth-tab+.auth-tab { margin-left:36px; }
.auth-tab+.auth-tab::before { position:absolute; left:-22px; color:var(--line-strong); font-weight:400; content:'/'; }
.auth-tab.active { color:var(--ink); }
.panel-wrapper { min-width:0; }
.auth-form { display:grid; gap:12px; animation:panel-in 240ms var(--ease-standard) both; }
.login-form { padding-top:24px; }
.form-title { display:block; margin-bottom:2px; color:var(--ink); font-size:16px; font-weight:600; }
.input-group { display:flex; min-width:0; flex-direction:column; }
.form-label { display:block; margin-bottom:5px; color:var(--ink-2); font-size:12px; font-weight:500; }
.input-wrap { display:flex; min-width:0; min-height:52px; align-items:center; overflow:hidden; border:1px solid var(--line); border-radius:14px; background:var(--surface-soft); transition:border-color var(--motion-fast) ease,background-color var(--motion-fast) ease; }
.input-wrap:focus-within { border-color:var(--ink); background:var(--surface-strong); }
.auth-input { min-width:0; min-height:52px; flex:1; padding:0 16px; border:0; border-radius:0; background:transparent; font-size:14px; }
.phone-prefix { display:flex; height:22px; flex:0 0 auto; align-items:center; padding:0 14px; border-right:1px solid var(--line-strong); color:var(--ink); font-size:14px; font-weight:500; }
.primary-btn { width:100%; min-height:52px; margin-top:4px; border-radius:14px; color:#fff; background:var(--ink); font-size:16px; font-weight:600; }
.primary-btn:active { transform:scale(.985); background:#33363c; }
.aux-row { display:flex; justify-content:flex-end; margin-top:-2px; }
.forgot-button,.back-button { display:flex; min-height:44px; align-items:center; justify-content:center; color:var(--ink-2); background:transparent; font-size:12px; }
.back-button { justify-self:start; gap:4px; }
.code-row { display:grid; min-width:0; grid-template-columns:minmax(0,1fr) 112px; gap:10px; }
.code-button { min-height:52px; padding:0 12px; border:1px solid var(--line); border-radius:14px; color:var(--ink); background:var(--surface); font-size:12px; font-weight:500; }
.consent { display:flex; min-height:44px; flex-wrap:wrap; align-items:center; justify-content:center; gap:0 3px; margin-top:12px; color:var(--muted); font-size:12px; }
.consent-check,.consent-links { display:flex; align-items:center; justify-content:center; }
.consent-box { transform:scale(.76); }
.consent button { display:inline-flex; min-height:44px; padding:0 1px; align-items:center; color:var(--ink-2); background:transparent; font-size:12px; }
.social-login { display:flex; flex-direction:column; align-items:center; gap:14px; margin-top:auto; padding-top:24px; }
.social-divider { display:flex; width:100%; align-items:center; gap:14px; color:var(--muted); font-size:12px; }
.social-divider text:first-child,.social-divider text:last-child { height:1px; flex:1; background:var(--line); }
.wechat-btn { display:flex; width:48px; height:48px; min-height:48px; align-items:center; justify-content:center; border:1px solid var(--line); border-radius:50%; color:#07a94f; background:var(--surface); }
.wechat-btn:active { transform:translateY(1px); background:var(--surface-soft); }
.login-message { display:block; min-height:20px; margin-top:10px; color:var(--ink-2); font-size:12px; line-height:20px; text-align:center; }
.login-message.error { color:var(--danger); }
.sheet-layer { position:fixed; inset:0; z-index:80; }
.sheet-mask { position:absolute; inset:0; width:100%; height:100%; background:rgba(0,0,0,.4); }
.bottom-sheet { position:absolute; right:0; bottom:0; left:0; z-index:1; padding:12px 24px calc(32px + env(safe-area-inset-bottom)); border-radius:20px 20px 0 0; background:var(--surface); animation:sheet-in 260ms cubic-bezier(.32,.72,0,1) both; }
.sheet-handle { width:40px; height:4px; margin:0 auto 22px; border-radius:2px; background:var(--line-strong); }
.sheet-title { display:block; margin-bottom:22px; color:var(--ink); font-size:20px; font-weight:600; text-align:center; }
.wechat-login-btn { display:flex; width:100%; min-height:52px; align-items:center; justify-content:center; gap:8px; border-radius:14px; color:#fff; background:#07c160; font-size:16px; font-weight:600; }
.wechat-login-btn:active { transform:scale(.985); background:#06ad56; }
.sheet-consent { display:flex; min-height:44px; align-items:center; justify-content:center; margin-top:10px; color:var(--muted); font-size:12px; }
.sheet-consent label { display:flex; align-items:center; justify-content:center; }
.sheet-consent checkbox { transform:scale(.76); }
@keyframes brand-in { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:none; } }
@keyframes panel-in { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
@keyframes sheet-in { from { transform:translateY(100%); } to { transform:none; } }
@media (max-width:359px) { .login-screen { padding-right:20px; padding-left:20px; }.login-brand { margin-bottom:32px; }.auth-tab+.auth-tab { margin-left:30px; }.code-row { grid-template-columns:minmax(0,1fr) 104px; gap:8px; } }
@media (max-width:479px) and (max-height:760px) { .login-screen { padding-top:40px; }.login-content { min-height:calc(100vh - 72px - env(safe-area-inset-bottom)); }.login-brand { margin-bottom:24px; }.login-form { padding-top:8px; }.social-login { padding-top:14px; } }
@media (min-width:768px) { .login-screen { align-items:center; padding-top:48px; padding-bottom:48px; }.login-content { min-height:680px; padding:44px 48px; border:1px solid var(--line); border-radius:14px; background:var(--surface); box-sizing:border-box; }.login-brand { margin-bottom:40px; }.bottom-sheet { right:50%; left:50%; width:440px; box-sizing:border-box; animation:sheet-in-wide 260ms cubic-bezier(.32,.72,0,1) both; } }
@keyframes sheet-in-wide { from { transform:translate(-50%,100%); } to { transform:translate(-50%,0); } }
</style>
