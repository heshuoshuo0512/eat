import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import uniPlugin from '@dcloudio/vite-plugin-uni';

const uni = typeof uniPlugin === 'function' ? uniPlugin : uniPlugin.default;
const uniVueBase = fileURLToPath(new URL('./node_modules/@dcloudio/uni-cli-shared/lib/vapor/@vue/', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      vue: `${uniVueBase}vue/dist/vue.runtime.esm-bundler.js`,
      '@vue/shared': `${uniVueBase}shared/dist/shared.esm-bundler.js`,
      '@vue/runtime-core': `${uniVueBase}runtime-core/dist/runtime-core.esm-bundler.js`,
      '@vue/runtime-dom': `${uniVueBase}runtime-dom/dist/runtime-dom.esm-bundler.js`,
      '@vue/reactivity': `${uniVueBase}reactivity/dist/reactivity.esm-bundler.js`,
      '@vue/runtime-vapor': `${uniVueBase}runtime-vapor/dist/runtime-vapor.esm-bundler.js`
    }
  },
  optimizeDeps: {
    exclude: ['vue', '@vue/shared', '@vue/runtime-core', '@vue/runtime-dom', '@vue/reactivity', '@vue/runtime-vapor']
  },
  plugins: [uni()]
});
