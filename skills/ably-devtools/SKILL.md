---
name: ably-devtools
description: "Inspect Ably Realtime in a running React Native app through the @avasapp/rozenite-plugin-ably DevTools plugin — channels, live event stream, decoded payloads — via the `avasapp/ably` Rozenite agent domain. Use for any realtime debugging question, such as a channel that is not attached, a message that did not arrive, a payload whose contents are in doubt, or a connection that keeps failing."
---

# Ably Realtime inspection

`@avasapp/rozenite-plugin-ably` instruments a live `Ably.Realtime` client and
exposes what it observes as the **`avasapp/ably`** Rozenite agent domain. Live
session data is the source of truth here — read it before inferring runtime
behaviour from source code.

Prerequisite: the app must mount `useAblyDevTools(client)` in a development
build. If the domain is missing from `npx rozenite agent domains`, that hook is
not mounted (or the client is null) — say so rather than guessing at a
substitute domain. See **Setup** below.

## Calling the tools

Run from the app root where Metro is started. Create a session once, pass
`--session` on every call, stop it when done.

```bash
npx rozenite agent session create
npx rozenite agent avasapp/ably call --tool list-channels --args '{}' --session <id>
npx rozenite agent session stop <id>
```

`list-channels` and `list-events` are paginated: they return a trimmed default
projection, and continue by passing the returned cursor back **inside `--args`**
(not `--cursor`). Use `-f/--fields` or `-v/--verbose` for more columns.

A page returning `{"page":{"reset":true},"items":[]}` means your cursor aged out
of the ring buffer — restart the listing, do not treat it as "no more rows".

## Tools

| Tool | Notes |
| --- | --- |
| `get-connection` | State, failure reason, `retryIn`, and `capabilities`. |
| `list-channels` | Paginated. Hides released channels unless `includeReleased`. Filters: `state`, `search`, `onlyErrored`. |
| `read-channel` | One channel in full, including registered listeners. |
| `list-events` | Paginated. Filters: `channel`, `kind`, `dir`, `search`, `since`, `order`. **No payload bodies.** |
| `read-event` | One event with its decoded payload, clipped to `maxBytes` (8 KB default). |
| `get-stats` | Counters, current options, `retained` vs `dropped`. |
| `set-options` | `paused`, `captureProtocol`, `maxEvents`. Touches capture only, never Ably. |
| `clear` | Discards captured events. Destructive. |
| `channel-action` | `attach` / `detach` / `release`. **Changes real Ably state.** |

`search` on `list-events` matches the decoded payload as well as the summary,
name and channel — it is how you find "which message carried this device id".

## Reading the data honestly

These are the things the tool output alone will not tell you.

**Inbound messages are only captured once the app has itself subscribed to that
channel.** The plugin installs its passive observer lazily, right after the
app's own `subscribe()`, specifically so it never causes an attach the app did
not ask for. A channel the app never subscribed to will show state and counters
but no inbound `message` events — that is the design, not a dropped message. A
bare `channel.unsubscribe()` (no arguments) removes every listener including the
observer, so capture stops until the app subscribes again.

**An outbound event means `publish()` was called, not that Ably accepted it.**
`dir: "out"` rows are recorded at call time. A publish that failed still appears.
Correlate with `get-connection` and channel state before concluding a message was
delivered.

**Payload markers are the plugin's, not your app's data.** `[Circular]`,
`[Max depth reached]` (depth cap 12), `[Binary N bytes]`, `[Function]` and
`[Unenumerable object]` are substituted during serialization. `byteLength` is
approximate and undercounts non-ASCII.

**`read-event` clips to 8 KB by default.** `truncated: true` with a `note` means
you are seeing a prefix; `byteLength` still reports the payload's true size, and
the structured `value` is dropped in favour of the clipped `raw` rather than
sending the same content twice. Raise `maxBytes` (up to 131072) when you
genuinely need more — a single uncapped realtime message can run to hundreds of
kilobytes, which is worth spending deliberately rather than by accident.

**`kind: "string"` does not mean "not JSON".** Ably delivers most payloads as a
JSON *string*; the plugin parses it into `kind: "json"` and keeps the original
in `raw`. Only strings that trim to `{...}` or `[...]` get that treatment, so a
JSON scalar stays a plain string.

**Channels are retained after detach and release.** `state` and `released`
together tell you live vs idle vs gone. "The channel I expected isn't there" is
the common bug, so `list-channels` hides released ones by default — pass
`includeReleased: true` when a channel has gone missing.

**The ring buffer drops oldest-first.** `get-stats.dropped` says how many events
were lost; raise `maxEvents` via `set-options` before a long reproduction. While
`paused`, events are discarded rather than buffered.

**`captureProtocol` has a side effect.** It sets the ably-js log level to 4,
which is noisy and measurably slows the SDK; turning it off sets level 1, which
clobbers any log level the app configured itself. It is unavailable when
`get-connection` reports `capabilities.protocol: false`. Prefer it only when
frame-level detail is genuinely needed.

## Workflows

**A channel is not receiving.** `list-channels` with `includeReleased: true` and
`onlyErrored: true`. Check `state` (`suspended` and `failed` are broken, not
idle), `error`, and `subscriberCount` — zero subscribers means the app never
registered a listener, which is an app bug, not a transport one.

**A message did not arrive.** `list-events` filtered to that `channel` and
`kind: "message"`. Nothing at all, with `subscriberCount` zero, means the app
never subscribed. Events present but the UI stale means the message arrived and
the bug is downstream in rendering.

**Inspect a payload.** `list-events` to find the id, then `read-event` for that
one id. Never try to get payload bodies out of a listing.

**The connection keeps dropping.** `get-connection` for `reason.code` and
`retryIn`, then `list-events` with `kind: "connection-state"` for the transition
history. Ably error codes are meaningful — `40142` is an expired token, `40160`
a capability/permission failure.

**Get a clean baseline.** `clear`, reproduce, then list. Prefer this over
reasoning about a buffer full of unrelated history.

Use `channel-action` only when the user has asked to change app state. `release`
drops the channel and its listeners in the running app.

## Setup

Call the hook once, anywhere in the tree, with the `Ably.Realtime` client. It is
a no-op outside `__DEV__` and while the client is null, so it is safe to call
before the client exists.

```ts
import { useAblyDevTools } from '@avasapp/rozenite-plugin-ably'

useAblyDevTools(isLoggedIn ? client : null)
```

Ably channel names are often opaque. If the app knows which feature subscribed
to what, feed it in and every channel row carries the label:

```ts
useAblyDevTools(client, {
  labels: {
    getLabels: () => ({ device_7b41: ['telemetry-screen'] }),
    subscribe: (onChange) => registry.onChange(onChange), // optional
  },
})
```

Options: `labels`, `maxEvents` (default 1000), `captureProtocol` (default
false), `enabled`. An inline `labels` object is safe — it is read through a ref.
But changing `maxEvents` or `captureProtocol` **as hook props** re-instruments
the client and loses captured history; changing them through the `set-options`
tool does not. Keep the props stable and adjust at runtime through the tool.

The plugin has no `ably` dependency — the client is typed structurally, so it
works against whatever ably-js version the app has.

## Typed access from Node

For scripts built on `@rozenite/agent-sdk`, the plugin exports typed descriptors
so tool names and argument shapes are checked:

```ts
import { ablyTools } from '@avasapp/rozenite-plugin-ably/sdk'

const { items } = await session.callTool(ablyTools.listChannels, {
  onlyErrored: true,
})
```
