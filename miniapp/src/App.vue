<script setup>
import { onLaunch } from '@dcloudio/uni-app';
import { useCanteenStore } from './stores/canteenStore.js';

const store = useCanteenStore();

onLaunch(() => {
  store.load().catch(() => {});
});
</script>

<style>
@import './styles/main.css';

page { min-height:100%; background:#f7f8fa; color:#181a1f; font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',Arial,sans-serif; font-size:14px; }
button { box-sizing:border-box; font-family:inherit; }
button::after { border:0; }
.uni-tabbar { padding-bottom:env(safe-area-inset-bottom); background:#ffffff !important; border-top:1px solid #e6e8ec; box-shadow:0 -6px 24px rgba(24,26,31,.06); }
.uni-tabbar__label { font-weight:500; letter-spacing:0; }
/* #ifdef H5 */
.uni-tabbar { display:none !important; }
/* #endif */
</style>
