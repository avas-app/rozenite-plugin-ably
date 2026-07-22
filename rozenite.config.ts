/**
 * IMPORTANT: this file must be entirely self-contained.
 *
 * Rozenite loads it by transpiling the single file to CJS and evaluating it via
 * `new Function('module', 'exports', code)` — with no `require` in scope (see
 * `@rozenite/vite-plugin/src/load-config.ts`). Any `import` here becomes a
 * `require(...)` call at runtime and fails with "require is not defined".
 *
 * That is why the presets below are literal payloads rather than being derived
 * from the shared types, and why realistic traffic lives in `example/` instead
 * of in a dev flow.
 */
export default {
  panels: [
    {
      name: 'Ably',
      source: './src/panel/index.tsx',
    },
  ],

  dev: {
    presets: [
      {
        name: 'Waiting state (empty snapshot)',
        type: 'ably:snapshot',
        payload: {
          connection: { state: 'initialized', since: 0 },
          channels: [],
          events: [],
          stats: {
            totalEvents: 0,
            dropped: 0,
            messagesIn: 0,
            messagesOut: 0,
            presence: 0,
            errors: 0,
            startedAt: 0,
          },
          capabilities: { protocol: true, labels: false },
          options: { paused: false, captureProtocol: false, maxEvents: 1000 },
        },
      },
      {
        name: 'Connection failed (token expired)',
        type: 'ably:connection',
        payload: {
          state: 'failed',
          previous: 'connected',
          since: 0,
          reason: {
            message: 'token expired',
            code: 40142,
            statusCode: 401,
            href: 'https://help.ably.io/error/40142',
          },
        },
      },
    ],
  },
}
