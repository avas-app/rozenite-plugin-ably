import { Chip, Separator, Surface } from '@rozenite/ui'
import { AlertTriangle } from 'lucide-react'

import type { ConnectionSnapshot, SessionStats } from '../../shared/types'
import { connectionTone, formatDuration, toneChipColor } from '../format'
import { MetaItem, WithTooltip } from './primitives'

type ConnectionBarProps = {
  connection: ConnectionSnapshot
  stats: SessionStats
  channelCount: number
  attachedCount: number
}

/**
 * The always-visible status strip. Its job is to answer "is realtime healthy
 * right now?" at a glance, so the connection state and any error reason are the
 * only things allowed to be visually loud.
 *
 * Capture controls used to live here; they now sit in the `PluginHeader`
 * actions slot so this strip is purely a readout.
 */
export function ConnectionBar({
  connection,
  stats,
  channelCount,
  attachedCount,
}: ConnectionBarProps) {
  const tone = connectionTone(connection.state)
  const elapsed = formatDuration(Date.now() - connection.since)

  return (
    <Surface
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2"
      variant="secondary"
    >
      <div className="flex items-center gap-2">
        <Chip color={toneChipColor(tone)} size="sm" variant="soft">
          {connection.state}
        </Chip>
        <WithTooltip content="Time in current state">
          <span className="text-xs tabular-nums text-muted">{elapsed}</span>
        </WithTooltip>
      </div>

      <Separator className="h-4" orientation="vertical" />

      {connection.id ? (
        <MetaItem label="id" mono>
          {connection.id}
        </MetaItem>
      ) : null}

      {connection.clientId ? (
        <MetaItem label="client" mono>
          {connection.clientId}
        </MetaItem>
      ) : null}

      <MetaItem label="channels">
        <span className="tabular-nums">{attachedCount}</span>
        <span className="text-muted"> / {channelCount}</span>
      </MetaItem>

      <MetaItem label="in">
        <span className="tabular-nums">{stats.messagesIn}</span>
      </MetaItem>

      <MetaItem label="out">
        <span className="tabular-nums">{stats.messagesOut}</span>
      </MetaItem>

      {stats.errors > 0 ? (
        <MetaItem label="err">
          <span className="tabular-nums text-danger">{stats.errors}</span>
        </MetaItem>
      ) : null}

      {connection.reason ? (
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-danger">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="truncate" title={connection.reason.message}>
            {connection.reason.code ? (
              <strong className="font-semibold">{connection.reason.code} </strong>
            ) : null}
            {connection.reason.message}
          </span>
        </div>
      ) : null}
    </Surface>
  )
}
