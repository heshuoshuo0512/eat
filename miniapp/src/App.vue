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

page { min-height:100%; background:#f6f7f5; color:#17211b; font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',Arial,sans-serif; font-size:28rpx; }
button { box-sizing:border-box; font-family:inherit; }
button::after { border:0; }
.uni-tabbar { padding-bottom:env(safe-area-inset-bottom); background:#fff !important; border-top:1rpx solid #e5eae7; }
.uni-tabbar__label { font-weight:500; }
</style>
