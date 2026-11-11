import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = 'C:/Users/L/AppData/Local/Temp/opencode'
const TIPOS = { '.pdf': 'application/pdf', '.png': 'image/png', '.html': 'text/html; charset=utf-8' }

createServer(async (req, res) => {
  if (req.method === 'POST') {
    const trozos = []
    for await (const t of req) trozos.push(t)
    const nombre = (new URL(req.url, 'http://x').searchParams.get('n') ?? 's.png').replace(/[^\w.-]/g, '')
    await writeFile(join(ROOT, nombre), Buffer.concat(trozos))
    res.writeHead(200).end('ok')
    return
  }
  const rel = decodeURIComponent((req.url ?? '/').split('?')[0])
  const destino = join(ROOT, normalize(rel === '/' ? '/prob/pie.pdf' : rel).replace(/^([/\\])+/, ''))
  let datos
  try { datos = await readFile(destino) } catch { res.writeHead(404).end('no'); return }
  res.writeHead(200, { 'content-type': TIPOS[extname(destino)] ?? 'application/octet-stream' })
  res.end(datos)
}).listen(8935, () => console.log('probe 8935'))