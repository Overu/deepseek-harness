/** Compose Insight sign-in with the same local native renderer and theme as Desktop Welcome. */
import '@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import '@insight-ai/desktop-integration/client/login.css'
import './insight-login.css'
import { createRoot } from 'react-dom/client'
import { LoginPage, type InsightLoginApi } from '@insight-ai/desktop-integration/client/login'

declare global { interface Window { insightLogin: InsightLoginApi } }
const container = document.getElementById('root')
if (container === null) throw new Error('Insight login root is missing')
const root = createRoot(container)
root.render(<LoginPage api={window.insightLogin} logoUrl="../lib/insight-login/brand-mark.svg" />)
window.addEventListener('pagehide', () => { root.unmount() }, { once: true })
