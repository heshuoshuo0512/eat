import { computed, onMounted, onUnmounted, readonly, ref } from 'vue';

function readWindowWidth() {
  try {
    const info = typeof uni.getWindowInfo === 'function' ? uni.getWindowInfo() : uni.getSystemInfoSync();
    return Number(info?.windowWidth || 375);
  } catch {
    return 375;
  }
}

export function useResponsiveLayout(breakpoint = 768) {
  const windowWidth = ref(readWindowWidth());
  const handleResize = (event = {}) => {
    windowWidth.value = Number(event.size?.windowWidth || event.windowWidth || readWindowWidth());
  };

  onMounted(() => uni.onWindowResize?.(handleResize));
  onUnmounted(() => uni.offWindowResize?.(handleResize));

  return {
    windowWidth: readonly(windowWidth),
    isWide: computed(() => windowWidth.value >= breakpoint)
  };
}
