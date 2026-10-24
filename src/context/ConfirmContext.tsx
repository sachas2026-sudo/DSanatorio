import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import logoUrl from '../assets/Logo.jpeg?url'
import { APP_DISPLAY_NAME } from '../lib/pdfBranding'
import '../shared/components/confirm-dialog.css'

type ConfirmOptions = {
  message: string
  title?: string
  /** Muestra el logo institucional en lugar del título en rojo. */
  titleLogo?: boolean
  confirmLabel?: string
  cancelLabel?: string
}

type Pending = ConfirmOptions & {
  resolve: (value: boolean) => void
}

type Ctx = {
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = createContext<Ctx | null>(null)

function ConfirmModal({
  title,
  titleLogo,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmOptions & { onConfirm: () => void; onCancel: () => void }) {
  const labelledBy = titleLogo ? undefined : 'confirm-title'

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby="confirm-message"
        aria-label={titleLogo ? APP_DISPLAY_NAME : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {titleLogo ? (
          <div className="confirm-dialog__logo-wrap">
            <img
              src={logoUrl}
              alt=""
              className="confirm-dialog__logo"
              width={128}
              height={128}
              draggable={false}
            />
          </div>
        ) : (
          <h2 id="confirm-title" className="confirm-dialog__title">
            {title ?? 'ATENCION'}
          </h2>
        )}
        <p id="confirm-message" className="confirm-dialog__message">
          {message}
        </p>
        <div className="confirm-dialog__actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel ?? 'Cancelar'}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            {confirmLabel ?? 'Aceptar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve })
    })
  }, [])

  const close = useCallback((result: boolean) => {
    setPending((current) => {
      current?.resolve(result)
      return null
    })
  }, [])

  const value = useMemo(() => ({ confirm }), [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && (
        <ConfirmModal
          title={pending.title}
          titleLogo={pending.titleLogo}
          message={pending.message}
          confirmLabel={pending.confirmLabel}
          cancelLabel={pending.cancelLabel}
          onConfirm={() => close(true)}
          onCancel={() => close(false)}
        />
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm debe usarse dentro de ConfirmProvider')
  }
  return ctx
}
