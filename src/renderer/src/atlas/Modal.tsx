import { useEffect, useRef, type ReactNode } from 'react'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null), close = useRef(onClose); close.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current!; dialog.showModal()
    const handle = () => close.current()
    dialog.addEventListener('cancel', handle)
    return () => { dialog.removeEventListener('cancel', handle); dialog.close(); previous?.focus() }
  }, [])
  return <dialog ref={ref} className="atlas-modal" aria-labelledby="atlas-modal-title" onClick={e => { if (e.target === ref.current) onClose() }}>
    <header><h2 id="atlas-modal-title">{title}</h2><button className="atlas-icon-button" aria-label="Close dialog" onClick={onClose}>×</button></header>{children}
  </dialog>
}
