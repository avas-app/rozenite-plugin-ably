import type { SerializedError, SerializedPayload } from '../shared/types'

/**
 * Turning arbitrary user payloads into something safe to put on the DevTools
 * bridge. Three hard requirements:
 *
 *  - **Clone-safe.** The bridge structured-clones; a Map, a class instance, or a
 *    cycle would throw and take the whole batch with it.
 *  - **Bounded.** A single 5 MB message must not be copied wholesale into the
 *    panel, so payloads are capped and marked `truncated`.
 *  - **Never throwing.** Serialization runs inside the app's own message
 *    listener path. An exception here would surface as an Ably delivery failure,
 *    which is the one thing a debugging tool must never cause.
 */

/** Payloads above this many bytes are clipped before crossing the bridge. */
const MAX_PAYLOAD_BYTES = 128 * 1024

/** Guards against deeply nested or cyclic structures. */
const MAX_DEPTH = 12

export function serializeError(error: unknown): SerializedError | undefined {
  if (!error) return undefined
  const e = error as {
    message?: string
    code?: number
    statusCode?: number
    href?: string
  }
  const message =
    typeof e.message === 'string' && e.message ? e.message : String(error)
  return {
    message,
    ...(typeof e.code === 'number' ? { code: e.code } : {}),
    ...(typeof e.statusCode === 'number' ? { statusCode: e.statusCode } : {}),
    ...(typeof e.href === 'string' ? { href: e.href } : {}),
  }
}

function approxBytes(value: string): number {
  // Close enough for a size badge without paying for a TextEncoder allocation
  // on every message; non-ASCII is undercounted, which is acceptable here.
  return value.length
}

function isBinary(value: unknown): value is ArrayBuffer | ArrayBufferView {
  return (
    value instanceof ArrayBuffer ||
    (typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(value))
  )
}

/**
 * Deep-copies into plain JSON, replacing anything unclonable with a marker
 * string. `seen` breaks cycles; depth is bounded independently because a wide
 * acyclic tree can still be pathologically deep.
 */
function toPlain(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value

  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return value
  if (t === 'bigint') return `${String(value)}n`
  if (t === 'function') return '[Function]'
  if (t === 'symbol') return String(value)

  if (depth >= MAX_DEPTH) return '[Max depth reached]'

  if (isBinary(value)) {
    const byteLength =
      value instanceof ArrayBuffer ? value.byteLength : value.byteLength
    return `[Binary ${byteLength} bytes]`
  }

  if (value instanceof Date) return value.toISOString()

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const out = value.map((item) => toPlain(item, depth + 1, seen))
    seen.delete(value)
    return out
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>
    if (seen.has(obj)) return '[Circular]'
    seen.add(obj)
    const out: Record<string, unknown> = {}
    try {
      for (const key of Object.keys(obj)) {
        out[key] = toPlain(obj[key], depth + 1, seen)
      }
    } catch {
      // Exotic proxies can throw on key enumeration.
      seen.delete(obj)
      return '[Unenumerable object]'
    }
    seen.delete(obj)
    return out
  }

  return String(value)
}

function clip(payload: SerializedPayload): SerializedPayload {
  if (payload.byteLength === undefined) return payload
  if (payload.byteLength <= MAX_PAYLOAD_BYTES) return payload

  // Keep the shape recognisable but drop the bulk. The panel shows the raw
  // prefix and a "truncated" badge rather than pretending it has everything.
  const rawPrefix = payload.raw?.slice(0, MAX_PAYLOAD_BYTES)
  return {
    ...payload,
    value:
      typeof payload.value === 'string'
        ? payload.value.slice(0, MAX_PAYLOAD_BYTES)
        : payload.value,
    raw: rawPrefix,
    truncated: true,
  }
}

/**
 * Decodes an Ably `message.data` into a previewable payload.
 *
 * The important case is a **JSON string**: Ably delivers `data` as a string for
 * most publishers, and showing that as one long escaped line is exactly the
 * unhelpful view the network inspector already gives. We parse it and keep the
 * original in `raw`, so the panel can render a real tree and still offer the
 * exact bytes.
 */
export function serializePayload(
  data: unknown,
  encoding?: string | null,
): SerializedPayload {
  try {
    if (data === null) return { kind: 'null', encoding }
    if (data === undefined) return { kind: 'null', encoding }

    if (isBinary(data)) {
      const byteLength =
        data instanceof ArrayBuffer ? data.byteLength : data.byteLength
      return { kind: 'binary', byteLength, encoding }
    }

    if (typeof data === 'string') {
      const trimmed = data.trim()
      const looksJson =
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))

      if (looksJson) {
        try {
          const parsed: unknown = JSON.parse(data)
          return clip({
            kind: 'json',
            value: toPlain(parsed, 0, new WeakSet()),
            raw: data,
            byteLength: approxBytes(data),
            encoding,
          })
        } catch {
          // Looked like JSON but was not — fall through to plain string.
        }
      }

      return clip({
        kind: 'string',
        value: data,
        byteLength: approxBytes(data),
        encoding,
      })
    }

    if (typeof data === 'number') return { kind: 'number', value: data, encoding }
    if (typeof data === 'boolean')
      return { kind: 'boolean', value: data, encoding }

    const plain = toPlain(data, 0, new WeakSet())
    let byteLength: number | undefined
    try {
      byteLength = approxBytes(JSON.stringify(plain) ?? '')
    } catch {
      byteLength = undefined
    }

    return clip({ kind: 'json', value: plain, byteLength, encoding })
  } catch (error) {
    return {
      kind: 'undecodable',
      note: error instanceof Error ? error.message : String(error),
      encoding,
    }
  }
}
