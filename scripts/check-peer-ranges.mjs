#!/usr/bin/env node
/**
 * Asserts that every Rozenite peer range still agrees with the version this
 * package is built against.
 *
 * The bridge packages appear twice in the manifest: in `devDependencies`, which
 * is what the panel and the type checker build against, and in
 * `peerDependencies`, which is what consumers actually resolve. Dependabot only
 * updates the first (dependabot/dependabot-core#1242), so a Rozenite major
 * arrives as a PR that builds perfectly green while still declaring the old
 * peer range — publishing that would refuse to install on the very version it
 * was built for.
 *
 * The rule: same major, and the peer floor no higher than what we build and
 * test against. Widening the peer floor deliberately (say `^2.0.0` while
 * building on `^2.2.0`) stays allowed; drifting across a major does not.
 *
 *   node scripts/check-peer-ranges.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))

const peers = pkg.peerDependencies ?? {}
const dev = pkg.devDependencies ?? {}

/** `^2.2.0` -> { major: 2, minor: 2, patch: 0 }. Anything else is unparsed. */
const parseCaret = (range) => {
  const match = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range ?? '')
  if (!match) return null
  const [, major, minor, patch] = match
  return { major: Number(major), minor: Number(minor), patch: Number(patch) }
}

const rank = ({ major, minor, patch }) => major * 1e6 + minor * 1e3 + patch

const rozenitePeers = Object.keys(peers).filter(
  (name) => name === 'rozenite' || name.startsWith('@rozenite/'),
)

let failed = false

if (rozenitePeers.length === 0) {
  console.error('FAIL  no @rozenite/* entries in peerDependencies — did they get dropped?')
  failed = true
}

for (const name of rozenitePeers) {
  const peerRange = peers[name]
  const devRange = dev[name]

  if (!devRange) {
    console.error(`FAIL  ${name} is a peer but not a devDependency`)
    console.error('        nothing builds or tests against the version consumers resolve')
    failed = true
    continue
  }

  const peer = parseCaret(peerRange)
  const built = parseCaret(devRange)

  if (!peer || !built) {
    console.error(`FAIL  ${name} needs caret ranges in both places`)
    console.error(`        peer: ${peerRange}   dev: ${devRange}`)
    failed = true
    continue
  }

  if (peer.major !== built.major) {
    console.error(`FAIL  ${name} peer range and build version disagree on the major`)
    console.error(`        peer: ${peerRange}   built against: ${devRange}`)
    console.error(`        bump peerDependencies["${name}"] to match, then re-test`)
    failed = true
    continue
  }

  if (rank(peer) > rank(built)) {
    console.error(`FAIL  ${name} peer floor is above the version built against`)
    console.error(`        peer: ${peerRange}   built against: ${devRange}`)
    failed = true
    continue
  }

  const note = rank(peer) === rank(built) ? '' : `  (widened from ${devRange})`
  console.log(`ok    ${name} ${peerRange}${note}`)
}

console.log('')
console.log(failed ? 'peer range check FAILED' : 'peer range check passed')
process.exit(failed ? 1 : 0)
