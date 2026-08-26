import { Button } from '@rozenite/ui'
import { Pause, Play, Radio, Trash2 } from 'lucide-react'

import type { Capabilities, SdkOptions } from '../../shared/types'
import { ControlTooltip } from './primitives'

type CaptureControlsProps = {
  options: SdkOptions
  capabilities: Capabilities
  onClear: () => void
  onTogglePause: () => void
  onToggleProtocol: () => void
}

/**
 * Capture controls for the `PluginHeader` actions slot: pause/resume, protocol
 * frame capture, and clear.
 */
export function CaptureControls({
  options,
  capabilities,
  onClear,
  onTogglePause,
  onToggleProtocol,
}: CaptureControlsProps) {
  return (
    <>
      <ControlTooltip
        content={options.paused ? 'Resume capture' : 'Pause capture'}
      >
        <Button
          onClick={onTogglePause}
          size="sm"
          variant={options.paused ? 'solid' : 'ghost'}
        >
          {options.paused ? <Play /> : <Pause />}
          {options.paused ? 'Resume' : 'Pause'}
        </Button>
      </ControlTooltip>

      <ControlTooltip
        content={
          capabilities.protocol
            ? 'Capture raw ably-js protocol frames (verbose, slows the SDK)'
            : 'This ably-js build does not expose a runtime log handler'
        }
      >
        <Button
          disabled={!capabilities.protocol}
          onClick={onToggleProtocol}
          size="sm"
          variant={options.captureProtocol ? 'soft' : 'ghost'}
        >
          <Radio />
          Protocol
        </Button>
      </ControlTooltip>

      <ControlTooltip content="Clear captured events">
        {/* Icon-only, but `IconButton` renders a square on the `Size` scale;
            this row needs it narrower than `sm` would be. */}
        <Button
          aria-label="Clear"
          className="w-6 px-0"
          onClick={onClear}
          size="sm"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      </ControlTooltip>
    </>
  )
}
