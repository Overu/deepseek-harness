import { clientBundle } from '../../client/tsdown.client.ts'

/** Build the Host tool and plugin-owned result cards in their respective faces. */
export default clientBundle(import.meta.dirname, ['lib/types/index.js'], { hostPhase: true })
