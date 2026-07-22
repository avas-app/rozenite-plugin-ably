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

// The plugin and the example each have their own React on disk. Without
// pinning, the app would load two copies and every hook would throw.
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
}

// Resolve the plugin to its TypeScript source rather than to `dist`. Keeps the
// import in App.tsx reading like a real install while making SDK edits hot
// reload with no build step in between.
const pluginEntry = path.resolve(pluginRoot, 'react-native.ts')
const defaultResolveRequest = config.resolver.resolveRequest

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'rozenite-plugin-ably') {
    return { type: 'sourceFile', filePath: pluginEntry }
  }
  return (defaultResolveRequest ?? context.resolveRequest)(
    context,
    moduleName,
    platform,
  )
}

// Rozenite normally discovers plugins by walking this project's *declared*
// package.json dependencies. The plugin lives one directory up rather than in
// the registry, so it is named explicitly here; `include` resolves it through
// the symlink created by scripts/link-plugin.mjs.
module.exports = withRozenite(config, {
  enabled: true,
  include: ['rozenite-plugin-ably'],
})
