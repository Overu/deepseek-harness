/** Read-only bundled agreements inside the Insight sign-in window. */
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './legal-dialog.module.css'

interface Props {
  title: string
  /** Trusted HTML imported from the product's bundled legal resources. */
  html: string
  onClose: () => void
}

/**
 * Display a bundled agreement with fixed controls and a scrolling document.
 * @param props - Document title, trusted bundled HTML, and dismissal callback.
 * @returns The modal reading view.
 */
export function LegalDocumentDialog({ title, html, onClose }: Props) {
  return <Modal open headless title={title} onClose={onClose} className={css.dialog as string}>
    <header className={css.header}>
      <h2>{title}</h2>
      <button type="button" className={css.dismiss} aria-label="关闭协议" data-modal-autofocus onClick={onClose}>
        ×
      </button>
    </header>
    <div className={css.body} tabIndex={0} role="region" aria-label={`${title}正文`}>
      <article className={css.document} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
    <footer className={css.footer}>
      <button type="button" className={css.confirm} onClick={onClose}>关闭</button>
    </footer>
  </Modal>
}
