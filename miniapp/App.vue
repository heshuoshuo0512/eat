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
  background: #f4f8f4;
  color: #172126;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', Arial, sans-serif;
}
</style>
