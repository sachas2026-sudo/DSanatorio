import { useState } from 'react'

export type AgendaMenuItem = {
  id: string
  label: string
  onClick: () => void
}

export function AgendaMenu({
  items,
  triggerLabel = 'Menú',
}: {
  items: AgendaMenuItem[]
  triggerLabel?: string
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="agenda-menu">
      <button
        type="button"
        className="agenda-menu__trigger"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        style={{ transform: 'translateY(-2px)' }}
      >
        {triggerLabel}
        <span className="agenda-menu__chevron">▼</span>
      </button>
      {isOpen && (
        <div
          className="agenda-menu__dropdown"
          role="menu"
          onMouseLeave={() => setIsOpen(false)}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="agenda-menu__item"
              onClick={() => {
                item.onClick()
                setIsOpen(false)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}