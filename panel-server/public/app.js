const loginView = document.getElementById('login-view')
const dashboardView = document.getElementById('dashboard-view')
const loginForm = document.getElementById('login-form')
const loginError = document.getElementById('login-error')
const logoutBtn = document.getElementById('logout-btn')
const refreshBtn = document.getElementById('refresh-btn')
const updatedAt = document.getElementById('updated-at')
const mesLabel = document.getElementById('mes-label')
const mesTotalFacturado = document.getElementById('mes-total-facturado')
const mesTotal = document.getElementById('mes-total')
const mesCount = document.getElementById('mes-count')
const diaLabel = document.getElementById('dia-label')
const diaTotalFacturado = document.getElementById('dia-total-facturado')
const diaTotalNeto = document.getElementById('dia-total-neto')
const diaCount = document.getElementById('dia-count')
const chartTitle = document.getElementById('chart-title')
const pagosBarChart = document.getElementById('pagos-bar-chart')
const chartEmpty = document.getElementById('chart-empty')
const turnosTitle = document.getElementById('turnos-title')
const turnosBody = document.getElementById('turnos-body')
const turnosEmpty = document.getElementById('turnos-empty')

/** Recarga automática cada 30 s (pestaña visible). */
const AUTO_REFRESH_MS = 30_000

let loadingSnapshot = false

function formatMoney(n) {
  const value = Number(n)
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0)
}

function formatDiaLabel(label) {
  if (typeof label !== 'string' || !label.trim()) return '—'
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function formatMontoCompact(n) {
  const value = Number(n)
  if (!Number.isFinite(value) || value <= 0) return ''
  return new Intl.NumberFormat('es-AR', {
    maximumFractionDigits: 0,
  }).format(value)
}

function formatMesLabel(label) {
  if (typeof label !== 'string' || !label.trim()) return '—'
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function formatUpdated(iso, fetchedAt, dataSource) {
  const parts = []
  try {
    parts.push(`Publicado: ${new Date(iso).toLocaleString('es-AR')}`)
  } catch {
    /* ignore */
  }
  if (fetchedAt) {
    try {
      parts.push(`Consultado: ${new Date(fetchedAt).toLocaleString('es-AR')}`)
    } catch {
      /* ignore */
    }
  }
  if (dataSource === 'live') {
    parts.push('datos en vivo')
  }
  return parts.join(' · ')
}

function setRefreshLoading(on) {
  if (!refreshBtn) return
  refreshBtn.disabled = on
  refreshBtn.textContent = on ? 'Actualizando…' : 'Actualizar'
  refreshBtn.setAttribute('aria-busy', on ? 'true' : 'false')
}

function showLogin(msg) {
  dashboardView.hidden = true
  loginView.hidden = false
  loginError.hidden = !msg
  if (msg) loginError.textContent = msg
}

function showDashboard() {
  loginView.hidden = true
  dashboardView.hidden = false
  loginError.hidden = true
}

function renderPagosBarChart(pagosPorDia, mesLabelText) {
  if (!pagosBarChart || !chartEmpty) return

  const rows = Array.isArray(pagosPorDia) ? pagosPorDia : []
  const maxTotal = rows.reduce((max, row) => Math.max(max, Number(row.total) || 0), 0)
  const hasData = rows.some((row) => Number(row.total) > 0)

  if (chartTitle && mesLabelText) {
    chartTitle.textContent = `Pagos del mes por día — ${formatMesLabel(mesLabelText)}`
  }

  pagosBarChart.replaceChildren()
  pagosBarChart.setAttribute('aria-hidden', hasData ? 'false' : 'true')
  chartEmpty.hidden = hasData

  if (!hasData) return

  pagosBarChart.setAttribute(
    'aria-label',
    `Gráfico de barras con cobranzas diarias del mes (${rows.length} días)`,
  )

  const BAR_MAX_PX = 96
  const plot = document.createElement('div')
  plot.className = 'bar-chart__plot'
  pagosBarChart.appendChild(plot)

  for (const row of rows) {
    const total = Number(row.total) || 0
    const barPx =
      total > 0 && maxTotal > 0
        ? Math.max(4, Math.round((total / maxTotal) * BAR_MAX_PX))
        : 2
    const col = document.createElement('div')
    col.className = `bar-chart__col${total <= 0 ? ' bar-chart__col--zero' : ''}`

    const value = document.createElement('span')
    value.className = 'bar-chart__value'
    value.textContent = formatMontoCompact(total)
    value.title = total > 0 ? formatMoney(total) : ''

    const barWrap = document.createElement('div')
    barWrap.className = 'bar-chart__bar-wrap'

    const bar = document.createElement('div')
    bar.className = 'bar-chart__bar'
    bar.style.height = `${barPx}px`

    const label = document.createElement('span')
    label.className = 'bar-chart__label'
    label.textContent = row.dia ?? '—'

    barWrap.appendChild(bar)
    col.append(value, barWrap, label)
    plot.appendChild(col)
  }
}

function renderSnapshot(data) {
  updatedAt.textContent = formatUpdated(
    data.updatedAt,
    data.fetchedAt,
    data.dataSource,
  )
  const pagos = data.pagosMes ?? {}
  const cantidad = Number(pagos.cantidad) || 0
  mesLabel.textContent = formatMesLabel(pagos.mesLabel)
  mesTotalFacturado.textContent = formatMoney(pagos.totalFacturado)
  mesTotal.textContent = formatMoney(pagos.total)
  mesCount.textContent = `${cantidad} pago${cantidad === 1 ? '' : 's'}`

  const pagosDia = data.pagosDia ?? {}
  const cantidadDia = Number(pagosDia.cantidad) || 0
  diaLabel.textContent = formatDiaLabel(pagosDia.diaLabel)
  diaTotalFacturado.textContent = formatMoney(pagosDia.totalFacturado)
  diaTotalNeto.textContent = formatMoney(pagosDia.totalConDescuentos)
  diaCount.textContent = `${cantidadDia} pago${cantidadDia === 1 ? '' : 's'}`

  renderPagosBarChart(data.pagosPorDia, pagos.mesLabel)

  turnosTitle.textContent = `Turnos — ${data.turnosHoyFecha}`

  turnosBody.replaceChildren()
  if (!data.turnosHoy?.length) {
    turnosEmpty.hidden = false
    turnosEmpty.textContent = 'Sin turnos para hoy.'
    return
  }
  turnosEmpty.hidden = true
  for (const t of data.turnosHoy) {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${t.hora}</td><td>${escapeHtml(t.paciente)}</td><td>${escapeHtml(t.medico)}</td><td>${escapeHtml(t.estado)}</td>`
    turnosBody.appendChild(tr)
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function loadSnapshot(options = {}) {
  const fresh = options.fresh === true
  if (loadingSnapshot) return false
  loadingSnapshot = true
  if (fresh) setRefreshLoading(true)

  try {
    const qs = fresh ? `fresh=1&_=${Date.now()}` : `_=${Date.now()}`
    const res = await fetch(`/api/snapshot?${qs}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    })
    if (res.status === 401) {
      showLogin()
      return false
    }
    if (!res.ok) {
      if (res.status === 401) {
        showLogin()
        return false
      }
      const body = await res.json().catch(() => ({}))
      showDashboard()
      turnosEmpty.hidden = false
      turnosEmpty.textContent =
        body.error || 'Sin datos publicados aún desde la clínica.'
      return true
    }
    const data = await res.json()
    showDashboard()
    renderSnapshot(data)
    return true
  } catch {
    showDashboard()
    turnosEmpty.hidden = false
    turnosEmpty.textContent =
      'No se pudo actualizar. Verificá que el panel esté encendido.'
    return false
  } finally {
    loadingSnapshot = false
    setRefreshLoading(false)
  }
}

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const password = document.getElementById('password').value
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    if (res.status === 429) {
      showLogin(body.error || 'Demasiados intentos. Esperá unos minutos.')
      return
    }
    if (res.status === 503) {
      showLogin(body.error || 'Panel sin contraseña configurada en la clínica.')
      return
    }
    showLogin(body.error || 'Contraseña incorrecta')
    return
  }
  const loaded = await loadSnapshot({ fresh: true })
  if (!loaded) {
    showLogin(
      'Contraseña correcta, pero no se abrió la sesión. Usá el link https del panel (Mantenimiento → Abrir panel).',
    )
  }
})

logoutBtn?.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
  showLogin()
})

refreshBtn?.addEventListener('click', () => {
  void loadSnapshot({ fresh: true })
})

void loadSnapshot({ fresh: true })

window.setInterval(() => {
  if (document.hidden || dashboardView.hidden) return
  void loadSnapshot({ fresh: true })
}, AUTO_REFRESH_MS)

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !dashboardView.hidden) {
    void loadSnapshot({ fresh: true })
  }
})
