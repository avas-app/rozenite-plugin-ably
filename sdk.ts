/**
 * Agent SDK entry point.
 *
 * Built to `dist/sdk/index.{js,cjs,d.ts}` and consumed as
 * `import { ablyTools } from '@avasapp/rozenite-plugin-ably/sdk'`, which gives
 * `@rozenite/agent-sdk` callers typed descriptors instead of stringly-typed
 * tool names:
 *
 * ```ts
 * const channels = await session.callTool(ablyTools.listChannels, {
 *   onlyErrored: true,
 * })
 * ```
 *
 * This entry deliberately pulls in nothing from `src/sdk/` or `src/panel/` — it
 * is imported from Node, where React and the React Native bridge do not exist.
 */

import { defineAgentToolDescriptors } from '@rozenite/agent-shared'

import { ablyToolDefinitions } from './src/shared/agent-tools'
import { PLUGIN_ID } from './src/shared/types'

export { ablyToolDefinitions, PLUGIN_ID }

/** Tool descriptors bound to this plugin's domain, for `session.callTool`. */
export const ablyTools = defineAgentToolDescriptors(PLUGIN_ID, ablyToolDefinitions)

export {
  CHANNEL_ACTIONS,
  DIRECTIONS,
  EVENT_KINDS,
} from './src/shared/agent-tools'

export type {
  AblyChannelRow,
  AblyEventRow,
  ChannelActionArgs,
  ChannelActionResult,
  ClearArgs,
  ClearResult,
  GetConnectionArgs,
  GetConnectionResult,
  GetStatsArgs,
  GetStatsResult,
  ListChannelsArgs,
  ListChannelsResult,
  ListEventsArgs,
  ListEventsResult,
  ReadChannelArgs,
  ReadChannelResult,
  ReadEventArgs,
  ReadEventResult,
  SetOptionsArgs,
  SetOptionsResult,
  SortOrder,
} from './src/shared/agent-tools'

export type {
  AblyEvent,
  Capabilities,
  ChannelAction,
  ChannelSnapshot,
  ChannelState,
  ConnectionSnapshot,
  ConnectionState,
  Direction,
  EventKind,
  SdkOptions,
  SerializedError,
  SerializedPayload,
  SessionStats,
} from './src/shared/types'
