// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs';

export default withNuxt({
  ignores: ['.output/**', '.nuxt/**', 'node_modules/**'],
});
