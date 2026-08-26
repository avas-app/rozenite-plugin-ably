#!/usr/bin/env node
/**
 * Verifies the *published* shape of this package against a real install.
 *
 * The plugin's bridge imports stay external in the build, so they are resolved
 * from wherever the consuming app puts them. If they ever resolve to a copy
 * nested under the plugin instead of the app's own, there are two bridge
 * instances and the panel silently never connects — the failure this package's
 * peerDependencies exist to prevent.
 *
 * The example app cannot catch this: its metro.config puts the plugin's own
 * node_modules on `nodeModulesPaths`, so the bridge always resolves from the
 * plugin's devDependencies there. Only a from-the-registry install exercises
 * the real path, which is what this does.
 *
 *   node scripts/check-peer-resolution.mjs [rozenite-version]   # default: latest
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const PEERS = [
  '@rozenite/plugin-bridge',
  '@rozenite/agent-bridge',
  '@rozenite/agent-shared',
]

const version = process.argv[2] ?? 'latest'
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { name: packageName } = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
)

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rozenite-peer-check-'))
let failed = false

try {
  console.log(`> packing ${packageName}`)
  const tarball = run('npm', ['pack', '--pack-destination', tmp], repoRoot).trim().split('\n').pop()

  const app = path.join(tmp, 'consumer')
  fs.mkdirSync(app)
  fs.writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify(
      {
        name: 'peer-resolution-consumer',
        version: '1.0.0',
        private: true,
        dependencies: {
          rozenite: version,
          '@rozenite/metro': version,
          react: '19.2.0',
          'react-native': '0.83.1',
        },
      },
      null,
      2,
    ) + '\n',
  )

  console.log(`> installing a consumer app on rozenite@${version}`)
  run('npm', ['install', '--no-audit', '--no-fund'], app)

  console.log(`> installing ${packageName} from the packed tarball`)
  run('npm', ['install', '--save-dev', '--no-audit', '--no-fund', path.join(tmp, tarball)], app)

  const plugin = path.join(app, 'node_modules', ...packageName.split('/'))
  const nested = path.join(plugin, 'node_modules')

  console.log('')
  if (fs.existsSync(nested)) {
    const dupes = fs.readdirSync(nested)
    console.error(`FAIL  nested node_modules under the plugin: ${dupes.join(', ')}`)
    failed = true
  } else {
    console.log('ok    no nested node_modules under the plugin')
  }

  // `require.resolve` from each location: the app's own root, and the installed
  // plugin directory. A published plugin is only correct when they agree.
  const fromApp = createRequire(path.join(app, 'index.js'))
  const fromPlugin = createRequire(path.join(plugin, 'index.js'))

  for (const peer of PEERS) {
    let a
    let p
    try {
      a = fromApp.resolve(peer)
    } catch (error) {
      a = `unresolved (${error.code})`
    }
    try {
      p = fromPlugin.resolve(peer)
    } catch (error) {
      p = `unresolved (${error.code})`
    }

    if (a === p && !a.startsWith('unresolved')) {
      console.log(`ok    ${peer} -> single shared instance`)
    } else {
      console.error(`FAIL  ${peer} resolves to two different copies`)
      console.error(`        from app:    ${a}`)
      console.error(`        from plugin: ${p}`)
      failed = true
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('')
console.log(failed ? 'peer resolution check FAILED' : 'peer resolution check passed')
process.exit(failed ? 1 : 0)
