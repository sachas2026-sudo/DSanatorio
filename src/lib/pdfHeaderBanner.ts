/// <reference path=\
import bannerAssetUrl from '../../public/pdf-header-plain.png?url'

const PX_PER_MM = 4

/** Zona celeste (sin logo) donde va el título dinámico. */
const TITLE_ZONE = {
  left: 0.22,
  width: 0.76,
}

const TITLE_COLOR = '#1a2744'

/** Recorte extra del marco gris del PNG (además del archivo ya recortado). */
const PNG_BORDER_CROP_X = 0.008
const PNG_BORDER_CROP_Y = 0.01

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function drawBannerWithoutFrame(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  w: number,
  h: number,
): void {
  const sx = image.naturalWidth
  const sy = image.naturalHeight
  if (sx <= 0 || sy <= 0) return

  const cropX = Math.max(1, Math.round(sx * PNG_BORDER_CROP_X))
  const cropY = Math.max(1, Math.round(sy * PNG_BORDER_CROP_Y))
  const srcW = sx - cropX * 2
  const srcH = sy - cropY * 2
  if (srcW <= 0 || srcH <= 0) return

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)

  const radius = Math.round(h * 0.1)
  const edgeInset = Math.max(1, Math.round(w * 0.003))
  ctx.save()
  roundRect(
    ctx,
    edgeInset,
    edgeInset,
    w - edgeInset * 2,
    h - edgeInset * 2,
    Math.max(2, radius - edgeInset),
  )
  ctx.clip()
  ctx.drawImage(image, cropX, cropY, srcW, srcH, 0, 0, w, h)
  ctx.restore()
}

type BannerCache = {
  dataUrl: string
  image: HTMLImageElement
  aspect: number
}

let cached: BannerCache | null = null
let loadPromise: Promise<BannerCache | null> | null = null

/** Fuerza recarga del PNG (p. ej. tras actualizar el arte). */
export function clearPdfHeaderBannerCache(): void {
  cached = null
  loadPromise = null
}

export function getPdfHeaderBanner(): BannerCache | null {
  return cached
}

export function preloadPdfHeaderBanner(): Promise<BannerCache | null> {
  if (cached) return Promise.resolve(cached)
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const res = await fetch(bannerAssetUrl)
        if (!res.ok) return null
        const blob = await res.blob()
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('Encabezado PDF'))
          img.src = dataUrl
        })
        const aspect =
          image.naturalHeight > 0
            ? image.naturalWidth / image.naturalHeight
            : 7.5
        cached = { dataUrl, image, aspect }
        return cached
      } catch {
        return null
      }
    })()
  }
  return loadPromise
}

function fitTitleFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  basePx: number,
): number {
  let fs = basePx
  while (fs >= 10) {
    ctx.font = `700 ${fs}px Helvetica, "Segoe UI", Arial, sans-serif`
    if (ctx.measureText(text).width <= maxWidth) return fs
    fs -= 0.5
  }
  return 10
}

export function plainHeaderHeightForWidth(widthMm: number): number {
  const banner = getPdfHeaderBanner()
  if (!banner?.aspect) return 20
  const natural = widthMm / banner.aspect
  return Math.max(16, Math.min(26, natural * 0.88))
}

/** Arte del encabezado (logo + fondo) + título dinámico (y opcional segunda línea). */
export function renderPlainHeaderFromBanner(
  widthMm: number,
  heightMm: number,
  title: string,
  baseFontSizePt: number,
  secondLine?: string,
): string | null {
  const banner = getPdfHeaderBanner()
  if (!banner?.image) return null

  const w = Math.round(widthMm * PX_PER_MM)
  const h = Math.round(heightMm * PX_PER_MM)
  if (w < 10 || h < 10) return null

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  drawBannerWithoutFrame(ctx, banner.image, w, h)

  const padX = 10
  const tx = Math.round(w * TITLE_ZONE.left) + padX
  const tw = Math.round(w * TITLE_ZONE.width) - padX * 2
  const cx = tx + tw / 2
  const basePx = baseFontSizePt * (PX_PER_MM / 2.83)
  const second = secondLine?.trim()

  ctx.fillStyle = TITLE_COLOR
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (second) {
    const fsMain = fitTitleFontSize(ctx, title, tw, basePx)
    const fsSub = fitTitleFontSize(ctx, second, tw, basePx * 0.98)
    const fs = Math.min(fsMain, fsSub)
    const lineGap = fs * 0.38
    const cy = h / 2
    ctx.font = `700 ${fs}px Helvetica, "Segoe UI", Arial, sans-serif`
    ctx.fillText(title, cx, cy - (fs + lineGap) / 2 + fs * 0.04)
    ctx.font = `700 ${Math.round(fs * 0.98)}px Helvetica, "Segoe UI", Arial, sans-serif`
    ctx.fillText(second, cx, cy + (fs + lineGap) / 2 + fs * 0.18)
  } else {
    const fs = fitTitleFontSize(ctx, title, tw, basePx)
    ctx.font = `700 ${fs}px Helvetica, "Segoe UI", Arial, sans-serif`
    ctx.fillText(title, cx, h / 2)
  }

  return canvas.toDataURL('image/png')
}
