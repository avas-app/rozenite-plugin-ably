/**
 * React Native entry point.
 *
 * Built to `dist/react-native/index.{js,cjs,d.ts}` and consumed as
 * `import { useAblyDevTools } from '@avasapp/rozenite-plugin-ably'`.
 *
 * Note there is no `ably` dependency anywhere in this package — the client is
 * typed structurally, so the plugin works against whatever ably-js version the
 * host app has installed, and adds nothing to the app's dependency graph.
 */

export { useAblyDevTools } from './src/sdk/use-ably-devtools'
export type {
  AblyDevToolsOptions,
  AblyDevToolsLabelSource,
} from './src/sdk/use-ably-devtools'
export type { ClientLike as AblyClientLike } from './src/sdk/instrument'
export type {
  AblyEvent,
  ChannelSnapshot,
  ConnectionSnapshot,
  SerializedPayload,
  SessionStats,
} from './src/shared/types'
