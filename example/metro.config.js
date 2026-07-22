const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')
const { withRozenite } = require('@rozenite/metro')

const projectRoot = __dirname
const pluginRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

// Metro must watch the plugin so edits to its SDK trigger a reload.
config.watchFolders = [pluginRoot]

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(pluginRoot, 'node_modules'),
]

// Resolve the plugin to its TypeScript source rather than to `dist`. Keeps the
// import in App.tsx reading like a real install while making SDK edits hot
// reload with no build step in between.
const pluginEntry = path.resolve(pluginRoot, 'react-native.ts')

/**
 * Packages that must have exactly one instance in the bundle.
 *
 * The plugin keeps its own React on disk (a devDependency, for building the
 * panel), and Metro resolves a file's imports starting from that file's own
 * directory and walking up — so the plugin's copy wins and the app ends up with
 * two Reacts. The symptom is every hook throwing
 * "Cannot read property 'useRef' of null".
 *
 * `extraNodeModules` does not fix this: it is only consulted when normal
 * resolution *fails*, and here it succeeds with the wrong copy. Re-resolving
 * from the example root is what actually forces a single instance.
 */
const SINGLETONS = ['react', 'react-dom', 'react-native']
const exampleOrigin = path.join(projectRoot, 'index.ts')

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'rozenite-plugin-ably') {
    return { type: 'sourceFile', filePath: pluginEntry }
  }

  if (
    SINGLETONS.some(
      (name) => moduleName === name || moduleName.startsWith(`${name}/`),
    )
  ) {
    return context.resolveRequest(
      { ...context, originModulePath: exampleOrigin },
      moduleName,
      platform,
    )
  }

  return context.resolveRequest(context, moduleName, platform)
}

// Rozenite normally discovers plugins by walking this project's *declared*
// package.json dependencies. The plugin lives one directory up rather than in
// the registry, so it is named explicitly here; `include` resolves it through
// the symlink created by scripts/link-plugin.mjs.
module.exports = withRozenite(config, {
  enabled: true,
  include: ['rozenite-plugin-ably'],
})
