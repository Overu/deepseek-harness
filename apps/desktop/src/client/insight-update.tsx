/** Boot the dedicated native Insight update page. */

import '@deepseek-ai/dsh-client-ui-theme/src/styles/base.css'
import { createRoot } from 'react-dom/client'
import { UpdatePage, type InsightUpdateApi } from '@insight-ai/desktop-integration/client/update'

declare global { interface Window { insightUpdate: InsightUpdateApi } }

const container = document.getElementById('root')
if (container === null) throw new Error('Insight update root is missing')
const root = createRoot(container)
root.render(<UpdatePage api={window.insightUpdate} logoUrl="../lib/insight-update/brand-mark.svg" />)
window.addEventListener('pagehide', () => { root.unmount() }, { once: true })
