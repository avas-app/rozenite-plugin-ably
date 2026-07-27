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
      <ControlTooltip content={options.paused ? 'Resume capture' : 'Pause capture'}>
        <Button
          onPress={onTogglePause}
          size="sm"
          variant={options.paused ? 'primary' : 'ghost'}
        >
          {options.paused ? (
            <Play className="size-4" />
          ) : (
            <Pause className="size-4" />
          )}
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
          isDisabled={!capabilities.protocol}
          onPress={onToggleProtocol}
          size="sm"
          variant={options.captureProtocol ? 'secondary' : 'ghost'}
        >
          <Radio className="size-4" />
          Protocol
        </Button>
      </ControlTooltip>

      <ControlTooltip content="Clear captured events">
        <Button aria-label="Clear" isIconOnly onPress={onClear} size="sm" variant="ghost">
          <Trash2 className="size-4" />
        </Button>
      </ControlTooltip>
    </>
  )
}
