import { clientBundle } from '../../client/tsdown.client.ts'
import { pnpmCommand, runConcurrent } from '../../../scripts/release/process.ts'

/** Build the existing iframe separately while sharing the official plugin bundler. */
export default clientBundle(import.meta.dirname, ['lib/types/index.js'], {
  lib: {
    copy: [{ from: 'guidance', to: 'lib' }],
    hooks: {
      'build:done': async () => {
        const [command, ...args] = pnpmCommand()
        await runConcurrent(command, [...args, '--dir', 'canvas-app', 'run', 'build'], { cwd: import.meta.dirname })
      },
    },
  },
})
