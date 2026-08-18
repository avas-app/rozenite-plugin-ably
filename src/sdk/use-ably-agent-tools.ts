/**
 * Registers the `rozenite agent` tool surface for a live session.
 *
 * This file is only wiring — the behaviour lives in `agent-handlers.ts`, which
 * is plain functions over a `Session`. All that happens here is binding each
 * contract to its handler and resolving the session.
 *
 * The session is reached through a ref rather than passed as a value because
 * `useAblyDevTools` creates it inside an effect. Registration happens on mount;
 * by the time a tool is actually called, the ref is populated.
 */

import type { RefObject } from 'react'
import { useRozenitePluginAgentTool } from '@rozenite/agent-bridge'

import { PLUGIN_ID } from '../shared/types'
import { ablyToolDefinitions } from '../shared/agent-tools'
import * as handlers from './agent-handlers'
import type { Session } from './session'

export type UseAblyAgentToolsOptions = {
  /** Populated by `useAblyDevTools`'s instrumentation effect. */
  sessionRef: RefObject<Session | null>
  enabled: boolean
}

/**
 * Resolves the session or explains why it is absent. An agent calling a tool
 * against an app that never mounted the hook should get that sentence, not
 * `undefined is not an object`.
 */
function requireSession(ref: RefObject<Session | null>): Session {
  const session = ref.current
  if (!session) {
    throw new Error(
      'Ably DevTools is not capturing. useAblyDevTools() must be mounted with a non-null client, in a development build.',
    )
  }
  return session
}

export function useAblyAgentTools({
  sessionRef,
  enabled,
}: UseAblyAgentToolsOptions): void {
  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: ablyToolDefinitions.getConnection,
    enabled,
    handler: () => handlers.getConnection(requireSession(sessionRef)),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: ablyToolDefinitions.listChannels,
    enabled,
    handler: (args) => handlers.listChannels(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: ablyToolDefinitions.readChannel,
    enabled,
    handler: (args) => handlers.readChannel(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: ablyToolDefinitions.listEvents,
    enabled,
    handler: (args) => handlers.listEvents(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: ablyToolDefinitions.readEvent,
    enabled,
    handler: (args) => handlers.readEvent(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: ablyToolDefinitions.getStats,
    enabled,
    handler: () => handlers.getStats(requireSession(sessionRef)),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: ablyToolDefinitions.setOptions,
    enabled,
    handler: (args) => handlers.setOptions(requireSession(sessionRef), args),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: ablyToolDefinitions.clear,
    enabled,
    handler: () => handlers.clear(requireSession(sessionRef)),
  })

  useRozenitePluginAgentTool({
    pluginId: PLUGIN_ID,
    tool: ablyToolDefinitions.channelAction,
    enabled,
    handler: (args) => handlers.channelAction(requireSession(sessionRef), args),
  })
}
