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
  return (
    <div className="agenda-menu">
      <select
        className="agenda-menu__select"
        value=""
        aria-label={triggerLabel}
        onChange={(event) => {
          const item = items.find((candidate) => candidate.id === event.target.value)
          item?.onClick()
        }}
      >
        <option value="" disabled>{triggerLabel}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>{item.label}</option>
        ))}
      </select>
      <span className="agenda-menu__chevron" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
    </div>
  )
}
