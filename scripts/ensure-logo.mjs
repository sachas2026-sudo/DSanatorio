/**

 * Asegura Logo.jpeg en src/assets y public/ antes del build.

 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'

import { dirname, join } from 'node:path'

import { fileURLToPath } from 'node:url'



const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const sources = [

  join(root, 'Logo.jpeg'),

  join(root, 'src', 'assets', 'Logo.jpeg'),

]



let src = sources.find((p) => existsSync(p))

if (!src) {

  console.error('No se encontró Logo.jpeg. Coloque el archivo en la raíz del proyecto.')

  process.exit(1)

}



const targets = [

  join(root, 'src', 'assets', 'Logo.jpeg'),

  join(root, 'public', 'Logo.jpeg'),

]



for (const dest of targets) {

  mkdirSync(dirname(dest), { recursive: true })

  copyFileSync(src, dest)

}



console.log(`Logo copiado desde ${src}`)

