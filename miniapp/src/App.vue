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

page { min-height:100%; background:#f4f7f5; color:#18251f; font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',Arial,sans-serif; }
button::after { border:0; }
.uni-tabbar { height:112rpx !important; padding-bottom:env(safe-area-inset-bottom); background:#fff !important; border-top:1rpx solid #e7ede9; box-shadow:0 -10rpx 32rpx rgba(24,37,31,.06); }
.uni-tabbar__item { padding-top:10rpx !important; }
.uni-tabbar__label { font-size:21rpx !important; font-weight:700; }
</style>
