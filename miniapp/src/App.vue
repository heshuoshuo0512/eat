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

page {
  min-height: 100%;
  background: #f3fbf5;
  color: #20342b;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', 'Hiragino Sans GB', 'Helvetica Neue', Arial, sans-serif;
}
</style>
