import { useEffect, useState } from 'react'
import {
  Button,
  Chip,
  JsonInspector,
  Surface,
  Tabs,
  useCopyToClipboard,
} from '@rozenite/ui'
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  MousePointerClick,
} from 'lucide-react'

import type { AblyEvent } from '../../shared/types'
import { eventTone, formatBytes, formatTime, toneChipColor } from '../format'
import { expandForQuery } from '../json-search'
import { MetaItem } from './primitives'

type PayloadViewerProps = {
  event: AblyEvent | null
  /** Shared with the stream search so a hit stays expanded when selected. */
  query: string
}

type Mode = 'tree' | 'raw'

/**
 * Detail pane for one event.
 *
 * Ably delivers most payloads as a JSON *string*, which is why the network
 * inspector shows one unreadable escaped line. The SDK parses it and keeps the
 * original, so this pane can offer a real tree by default and the exact bytes
 * on demand — the "raw" tab is only enabled when the two actually differ.
 */
export function PayloadViewer({ event, query }: PayloadViewerProps) {
  const [mode, setMode] = useState<Mode>('tree')
  const { copy, isCopied } = useCopyToClipboard(1400)

  const payload = event?.payload
  const hasRaw = typeof payload?.raw === 'string'
  const isStructured = payload?.kind === 'json'

  // A newly selected event may not support the current tab.
  useEffect(() => {
    if (mode === 'tree' && !isStructured && hasRaw) setMode('raw')
    if (mode === 'raw' && !hasRaw && isStructured) setMode('tree')
  }, [mode, isStructured, hasRaw])

  if (!event) {
    return (
      <Surface
        className="flex w-1/2 shrink-0 flex-col items-center justify-center gap-2 border-l border-border px-4 text-center"
        variant="secondary"
      >
        <MousePointerClick className="size-5 text-muted" />
        <span className="text-sm text-muted">
          Select an event to inspect its payload.
        </span>
      </Surface>
    )
  }

  const copyText = () => {
    if (!payload) return ''
    if (mode === 'raw' && payload.raw !== undefined) return payload.raw
    if (payload.kind === 'json') {
      try {
        return JSON.stringify(payload.value, null, 2)
      } catch {
        return String(payload.value)
      }
    }
    return String(payload.value ?? '')
  }

  const tone = eventTone(event)

  return (
    <Surface
      className="flex w-1/2 shrink-0 flex-col border-l border-border"
      variant="secondary"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {event.name ?? event.summary}
          </span>
          {event.channel ? (
            <code className="truncate rounded bg-surface-tertiary px-1.5 py-0.5 font-mono text-xs text-muted">
              {event.channel}
            </code>
          ) : null}
        </div>

        {payload ? (
          <Button
            onPress={() => {
              void copy(copyText()).catch(() => {})
            }}
            size="sm"
            variant="ghost"
          >
            {isCopied ? (
              <Check className="size-4 text-success" />
            ) : (
              <Copy className="size-4" />
            )}
            {isCopied ? 'Copied' : 'Copy'}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border px-3 py-2">
        <MetaItem label="time">{formatTime(event.ts)}</MetaItem>
        {event.timestamp ? (
          <MetaItem label="server">{formatTime(event.timestamp)}</MetaItem>
        ) : null}
        <MetaItem label="kind">
          <Chip color={toneChipColor(tone)} size="sm" variant="soft">
            {event.kind}
          </Chip>
        </MetaItem>
        <MetaItem label="dir">{event.dir}</MetaItem>
        {event.messageId ? (
          <MetaItem label="id" mono>
            {event.messageId}
          </MetaItem>
        ) : null}
        {event.clientId ? (
          <MetaItem label="client" mono>
            {event.clientId}
          </MetaItem>
        ) : null}
        {event.connectionId ? (
          <MetaItem label="conn" mono>
            {event.connectionId}
          </MetaItem>
        ) : null}
        {payload?.byteLength !== undefined ? (
          <MetaItem label="size">{formatBytes(payload.byteLength)}</MetaItem>
        ) : null}
        {payload?.encoding ? (
          <MetaItem label="encoding" mono>
            {payload.encoding}
          </MetaItem>
        ) : null}
      </div>

      {event.error ? (
        <div className="flex items-start gap-2 border-b border-border bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <strong className="font-semibold">
              {event.error.code ? `${event.error.code} ` : ''}
              {event.error.statusCode ? `(HTTP ${event.error.statusCode}) ` : ''}
            </strong>
            {event.error.message}
            {event.error.href ? (
              <a
                className="ml-1.5 inline-flex items-center gap-0.5 underline underline-offset-2"
                href={event.error.href}
                rel="noreferrer"
                target="_blank"
              >
                docs
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {payload?.truncated ? (
        <div className="border-b border-border bg-warning/10 px-3 py-2 text-xs text-warning">
          Payload exceeded the capture limit and was truncated.
        </div>
      ) : null}

      {isStructured || hasRaw ? (
        <Tabs
          className="min-h-0 flex-1"
          onSelectionChange={(key) => setMode(String(key) as Mode)}
          selectedKey={mode}
        >
          <Tabs.ListContainer className="px-3 pt-2">
            {/*
              `Tabs.Indicator` reads the per-tab selection context, so it goes
              inside each tab rather than alongside them.
            */}
            <Tabs.List aria-label="Payload view">
              <Tabs.Tab id="tree" isDisabled={!isStructured}>
                Tree
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="raw" isDisabled={!hasRaw}>
                Raw
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
          <Tabs.Panel className="min-h-0 flex-1 overflow-auto p-3" id="tree">
            <PayloadBody event={event} mode="tree" query={query} />
          </Tabs.Panel>
          <Tabs.Panel className="min-h-0 flex-1 overflow-auto p-3" id="raw">
            <PayloadBody event={event} mode="raw" query={query} />
          </Tabs.Panel>
        </Tabs>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <PayloadBody event={event} mode="tree" query={query} />
        </div>
      )}
    </Surface>
  )
}

function PayloadBody({
  event,
  mode,
  query,
}: {
  event: AblyEvent
  mode: Mode
  query: string
}) {
  const payload = event.payload

  if (!payload) {
    return <p className="text-sm text-muted">{event.summary}</p>
  }

  if (mode === 'raw' && payload.raw !== undefined) {
    return <RawText>{payload.raw}</RawText>
  }

  switch (payload.kind) {
    case 'json': {
      const trimmed = query.trim().toLowerCase()
      return (
        <JsonInspector
          data={payload.value}
          hideRoot
          // react-json-tree only consults the predicate when a node first
          // mounts, so the tree is remounted when the query changes to let a
          // new search re-open the matching paths.
          key={trimmed}
          shouldExpandNodeInitially={expandForQuery(trimmed)}
        />
      )
    }
    case 'string':
    case 'number':
    case 'boolean':
      return <RawText>{String(payload.value)}</RawText>
    case 'binary':
      return (
        <p className="text-sm text-muted">
          Binary payload · {formatBytes(payload.byteLength)}
        </p>
      )
    case 'null':
      return <p className="text-sm text-muted">No payload.</p>
    case 'undecodable':
      return (
        <p className="text-sm text-muted">
          Could not decode payload{payload.note ? `: ${payload.note}` : '.'}
        </p>
      )
    default:
      return <p className="text-sm text-muted">No preview available.</p>
  }
}

function RawText({ children }: { children: string }) {
  return (
    <pre className="wrap-anywhere whitespace-pre-wrap rounded-lg bg-surface-tertiary p-3 font-mono text-xs text-foreground">
      {children}
    </pre>
  )
}
