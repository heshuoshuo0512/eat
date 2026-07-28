import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import uniPlugin from '@dcloudio/vite-plugin-uni';

const uni = typeof uniPlugin === 'function' ? uniPlugin : uniPlugin.default;
const uniVueBase = fileURLToPath(new URL('./node_modules/@dcloudio/uni-cli-shared/lib/vapor/@vue/', import.meta.url));

export default defineConfig(({ command }) => {
  const isH5 = process.env.UNI_PLATFORM === 'h5';
  const isMiniappBuild = command === 'build' && process.env.UNI_PLATFORM === 'mp-weixin';
  const apiBaseUrl = String(process.env.VITE_API_BASE_URL || '');
  if (isMiniappBuild && !/^https:\/\//i.test(apiBaseUrl) && process.env.ALLOW_INSECURE_MINIAPP_BUILD !== '1') {
    throw new Error('Production miniapp build requires an HTTPS VITE_API_BASE_URL. Use ALLOW_INSECURE_MINIAPP_BUILD=1 only for WeChat DevTools testing.');
  }
  const uiTestProxy = process.env.VITE_UI_TEST_PROXY === '1';
  return {
    resolve: isH5 ? undefined : {
      alias: {
        vue: `${uniVueBase}vue/dist/vue.runtime.esm-bundler.js`,
        '@vue/shared': `${uniVueBase}shared/dist/shared.esm-bundler.js`,
        '@vue/runtime-core': `${uniVueBase}runtime-core/dist/runtime-core.esm-bundler.js`,
        '@vue/runtime-dom': `${uniVueBase}runtime-dom/dist/runtime-dom.esm-bundler.js`,
        '@vue/reactivity': `${uniVueBase}reactivity/dist/reactivity.esm-bundler.js`,
        '@vue/runtime-vapor': `${uniVueBase}runtime-vapor/dist/runtime-vapor.esm-bundler.js`
      }
    },
    optimizeDeps: isH5 ? undefined : {
      exclude: ['vue', '@vue/shared', '@vue/runtime-core', '@vue/runtime-dom', '@vue/reactivity', '@vue/runtime-vapor']
    },
    plugins: [uni()],
    preview: uiTestProxy ? {
      proxy: {
        '/api': {
          target: process.env.VITE_UI_TEST_API_BASE_URL || 'http://127.0.0.1:8787',
          changeOrigin: true
        }
      }
    } : undefined
  };
});
