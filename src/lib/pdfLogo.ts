import logoAssetUrl from '../../Logo.jpeg?url'

export type PdfLogoCache = {
  dataUrl: string
  format: 'JPEG'
  aspect: number
  /** Para dibujar en canvas del encabezado sin esperas async. */
  image: HTMLImageElement
}

let cachedLogo: PdfLogoCache | null = null
let loadPromise: Promise<PdfLogoCache | null> | null = null

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function imageAspect(dataUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      if (img.naturalHeight <= 0) resolve(1)
      else resolve(img.naturalWidth / img.naturalHeight)
    }
    img.onerror = () => reject(new Error('No se pudo leer el logo'))
    img.src = dataUrl
  })
}

/** Carga Logo.jpeg una vez (raíz del proyecto, vía Vite). */
export function preloadPdfLogo(): Promise<PdfLogoCache | null> {
  if (cachedLogo) return Promise.resolve(cachedLogo)
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const res = await fetch(logoAssetUrl)
        if (!res.ok) return null
        const dataUrl = await blobToDataUrl(await res.blob())
        const aspect = await imageAspect(dataUrl)
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('No se pudo leer el logo'))
          img.src = dataUrl
        })
        cachedLogo = { dataUrl, format: 'JPEG', aspect, image }
        return cachedLogo
      } catch {
        return null
      }
    })()
  }
  return loadPromise
}

export function getPdfLogo(): PdfLogoCache | null {
  return cachedLogo
}
