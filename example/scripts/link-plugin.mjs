import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Symlinks the plugin into the example's `node_modules`.
 *
 * Rozenite discovers plugins by crawling `node_modules` for `dist/rozenite.json`,
 * so the package has to be present there or the Ably panel never appears
 * ("[Rozenite] No plugins found."). A declared `file:..` dependency does not
 * work: bun *copies* the directory, so the copy's `dist/` goes stale the moment
 * the plugin is rebuilt.
 *
 * A symlink keeps discovery pointed at the live plugin directory. Metro
 * separately aliases the bare specifier to the plugin's TypeScript source (see
 * metro.config.js) so SDK edits hot reload without a build.
 */
const exampleRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pluginRoot = path.resolve(exampleRoot, '..')
const target = path.join(exampleRoot, 'node_modules', 'rozenite-plugin-ably')

fs.mkdirSync(path.dirname(target), { recursive: true })

if (fs.existsSync(target) || fs.lstatSync(target, { throwIfNoEntry: false })) {
  fs.rmSync(target, { recursive: true, force: true })
}

fs.symlinkSync(pluginRoot, target, 'dir')

const manifest = path.join(pluginRoot, 'dist', 'rozenite.json')
if (!fs.existsSync(manifest)) {
  console.warn(
    '[example] linked, but the plugin is not built yet — run `bun run build` in the repo root, or the Ably panel will not appear.',
  )
} else {
  console.log('[example] linked rozenite-plugin-ably ->', pluginRoot)
}
