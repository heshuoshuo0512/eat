import { ref } from 'vue';

function canUseUni(method) {
  return typeof uni !== 'undefined' && typeof uni[method] === 'function';
}

export function triggerHaptic(type = 'light') {
  if (!canUseUni('vibrateShort')) return;
  try { uni.vibrateShort({ type, fail() {} }); } catch {}
}

export function showFeedback(title, { icon = 'none', haptic = '' } = {}) {
  if (haptic) triggerHaptic(haptic);
  if (canUseUni('showToast')) uni.showToast({ title, icon, duration: 1600 });
}

export function useInteractionFeedback() {
  const actionLocked = ref(false);
  async function runLocked(task, { successText = '', haptic = 'light' } = {}) {
    if (actionLocked.value) return undefined;
    actionLocked.value = true;
    try {
      const result = await task();
      if (successText) showFeedback(successText, { haptic });
      else if (haptic) triggerHaptic(haptic);
      return result;
    } finally {
      actionLocked.value = false;
    }
  }
  return { actionLocked, runLocked, triggerHaptic, showFeedback };
}
