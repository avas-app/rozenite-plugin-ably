import { useEffect, useState } from 'react'

import type { AblyEvent } from '../../shared/types'
import { formatBytes, formatTime } from '../format'
import { JsonTree } from './JsonTree'

type PayloadViewerProps = {
  event: AblyEvent | null
  /** Shared with the stream search so a hit stays highlighted when selected. */
  query: string
}

type Mode = 'tree' | 'raw'

/**
 * Detail pane for one event.
 *
 * Ably delivers most payloads as a JSON *string*, which is why the network
 * inspector shows one unreadable escaped line. The SDK parses it and keeps the
 * original, so this pane can offer a real tree by default and the exact bytes
 * on demand — the "raw" toggle is only enabled when the two actually differ.
 */
export function PayloadViewer({ event, query }: PayloadViewerProps) {
  const [mode, setMode] = useState<Mode>('tree')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setCopied(false)
  }, [event?.id])

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(id)
  }, [copied])

  if (!event) {
    return (
      <section className="detail">
        <div className="empty">Select an event to inspect its payload.</div>
      </section>
    )
  }

  const payload = event.payload
  const hasRaw = typeof payload?.raw === 'string'
  const isStructured = payload?.kind === 'json'

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

  const onCopy = () => {
    const text = copyText()
    // `navigator.clipboard` is unavailable in some embedded devtools contexts.
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }

  return (
    <section className="detail">
      <div className="detail-head">
        <div className="detail-title">
          <span className="detail-name">{event.name ?? event.summary}</span>
          {event.channel ? (
            <code className="detail-channel">{event.channel}</code>
          ) : null}
        </div>

        <div className="detail-actions">
          {isStructured || hasRaw ? (
            <div className="toggle">
              <button
                type="button"
                className={`toggle-btn${mode === 'tree' ? ' toggle-on' : ''}`}
                onClick={() => setMode('tree')}
                disabled={!isStructured}
              >
                Tree
              </button>
              <button
                type="button"
                className={`toggle-btn${mode === 'raw' ? ' toggle-on' : ''}`}
                onClick={() => setMode('raw')}
                disabled={!hasRaw}
                title={hasRaw ? 'Original payload text' : 'No distinct raw form'}
              >
                Raw
              </button>
            </div>
          ) : null}
          {payload ? (
            <button type="button" className="btn" onClick={onCopy}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          ) : null}
        </div>
      </div>

      <dl className="meta">
        <Meta label="time" value={formatTime(event.ts)} />
        {event.timestamp ? (
          <Meta label="server" value={formatTime(event.timestamp)} />
        ) : null}
        <Meta label="kind" value={event.kind} />
        <Meta label="dir" value={event.dir} />
        {event.messageId ? <Meta label="id" value={event.messageId} mono /> : null}
        {event.clientId ? <Meta label="client" value={event.clientId} mono /> : null}
        {event.connectionId ? (
          <Meta label="conn" value={event.connectionId} mono />
        ) : null}
        {payload?.byteLength !== undefined ? (
          <Meta label="size" value={formatBytes(payload.byteLength)} />
        ) : null}
        {payload?.encoding ? (
          <Meta label="encoding" value={payload.encoding} mono />
        ) : null}
      </dl>

      {event.error ? (
        <div className="detail-error">
          <strong>
            {event.error.code ? `${event.error.code} ` : ''}
            {event.error.statusCode ? `(HTTP ${event.error.statusCode}) ` : ''}
          </strong>
          {event.error.message}
          {event.error.href ? (
            <a
              className="detail-link"
              href={event.error.href}
              target="_blank"
              rel="noreferrer"
            >
              docs ↗
            </a>
          ) : null}
        </div>
      ) : null}

      {payload?.truncated ? (
        <div className="notice">
          Payload exceeded the capture limit and was truncated.
        </div>
      ) : null}

      <div className="detail-body">
        <PayloadBody event={event} mode={mode} query={query} />
      </div>
    </section>
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
    return <div className="empty empty-small">{event.summary}</div>
  }

  if (mode === 'raw' && payload.raw !== undefined) {
    return <pre className="raw">{payload.raw}</pre>
  }

  switch (payload.kind) {
    case 'json':
      return <JsonTree value={payload.value} query={query.trim().toLowerCase()} />
    case 'string':
      return <pre className="raw">{String(payload.value)}</pre>
    case 'number':
    case 'boolean':
      return <pre className="raw">{String(payload.value)}</pre>
    case 'binary':
      return (
        <div className="empty empty-small">
          Binary payload · {formatBytes(payload.byteLength)}
        </div>
      )
    case 'null':
      return <div className="empty empty-small">No payload.</div>
    case 'undecodable':
      return (
        <div className="empty empty-small">
          Could not decode payload{payload.note ? `: ${payload.note}` : '.'}
        </div>
      )
    default:
      return <div className="empty empty-small">No preview available.</div>
  }
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="meta-item">
      <dt className="meta-label">{label}</dt>
      <dd className={`meta-value${mono ? ' meta-mono' : ''}`} title={value}>
        {value}
      </dd>
    </div>
  )
}
