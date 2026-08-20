import { clientOnly } from '../tsdown.client.ts'

/**
 * ui-attachment is browser-only, but its lib bundle IS imported under plain
 * Node (dsh-client-web / the host reads the lib). CSS imports are therefore
 * stubbed to empty modules: the hashed class maps only matter in bundler
 * contexts (vite / web shell), which compile src directly and never read lib.
 * `clientOnly` emits only the Node-side lib and skips a client plugin entry —
 * this package has no client-half in the custom fork (attachment rendering
 * lives in ui-conversation, not as a separate plugin).
 */
const cssStub = {
  name: 'dsh-css-stub',
  resolveId(source: string) {
    if (!source.endsWith('.css')) return null
    return `\0dsh-css-stub:${source}.mjs`
  },
  load(id: string) {
    if (!id.startsWith('\0dsh-css-stub:')) return null
    return 'export default {};'
  },
}

export default clientOnly([{
  name: '@deepseek-ai/dsh-client-ui-attachment',
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  plugins: [cssStub],
}])
