import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { rimrafSync } from 'rimraf'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default function deleteSourceMaps() {
    const rootPath = path.join(__dirname, '../..')
    const distMainPath = path.join(rootPath, 'release/app/dist/main')
    const distRendererPath = path.join(rootPath, 'release/app/dist/renderer')

    if (fs.existsSync(distMainPath))
        rimrafSync(path.join(distMainPath, '*.js.map'), {
            glob: true,
        })
    if (fs.existsSync(distRendererPath))
        rimrafSync(path.join(distRendererPath, '*.js.map'), {
            glob: true,
        })
}
