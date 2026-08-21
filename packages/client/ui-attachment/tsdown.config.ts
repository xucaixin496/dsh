import { clientBundle } from '../tsdown.client.ts'

/**
 * Browser-only atoms: the Node half stays a no-op (the loader imports it
 * through the web profile include), while the client half ships the React
 * components with CSS inlined the same way every other UI plugin bundle does.
 */
export default clientBundle(
  '@deepseek-ai/dsh-client-ui-attachment',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
