export function money(value) {
  return `¥${Number(value || 0).toFixed(0)}`;
}

export function score(value) {
  return Number(value || 0).toFixed(1);
}

export function mealTypeLabel(value) {
  return ({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐' })[value] || '午餐';
}

export function goalLabel(value) {
  return ({ fatLoss: '减脂控卡', muscleGain: '增肌高蛋白', maintain: '均衡维持', healthy: '健康饮食' })[value] || '健康饮食';
}

export function imageToBase64(path) {
  return new Promise((resolve, reject) => {
    const manager = uni.getFileSystemManager();
    manager.readFile({
      filePath: path,
      encoding: 'base64',
      success: (result) => resolve(result.data),
      fail: (error) => reject(new Error(error?.errMsg || '读取图片失败。'))
    });
  });
}
