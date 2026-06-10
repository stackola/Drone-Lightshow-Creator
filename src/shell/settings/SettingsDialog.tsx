// ============================================================================
// SettingsDialog — project constraints relocated from the legacy inspector's
// "Settings" tab into a proper dialog (opened from the TopBar). Content
// ported from the legacy ConstraintsPanel; inputs are the L4 NumberInput.
// ============================================================================

import type { ReactNode } from 'react'
import { Dialog } from '../../components/ui'
import { NumberInput } from '../../components/inspectors/shared'
import { GeofenceEditor } from '../../components/inspectors/GeofenceEditor'
import { useProjectStore } from '../../stores/projectStore'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-micro text-white/50 whitespace-nowrap">{label}</span>
      <div className="w-24">{children}</div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-micro font-semibold text-white/40 uppercase tracking-wider mb-1">{title}</div>
      {children}
    </div>
  )
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const constraints = useProjectStore((s) => s.constraints)
  const updateConstraints = useProjectStore((s) => s.updateConstraints)
  const dronePool = useProjectStore((s) => s.dronePool)
  const setDroneCount = useProjectStore((s) => s.setDroneCount)
  const setLaunchLayout = useProjectStore((s) => s.setLaunchLayout)
  const setSpacing = useProjectStore((s) => s.setSpacing)

  return (
    <Dialog onClose={onClose} title="Project settings" widthClassName="max-w-md max-h-[80vh] overflow-auto">
      <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
        <Group title="Drone Pool">
          <Field label="Count">
            <NumberInput value={dronePool.droneCount} onChange={setDroneCount} min={1} max={10000} step={10} />
          </Field>
          <Field label="Layout">
            <select
              value={dronePool.launchLayout}
              onChange={(e) => setLaunchLayout(e.target.value as 'grid' | 'line' | 'circle')}
              className="w-full bg-surface-hover border border-white/10 rounded px-1 py-0.5 text-caption text-white/80 outline-none"
            >
              <option value="grid">Grid</option>
              <option value="line">Line</option>
              <option value="circle">Circle</option>
            </select>
          </Field>
          <Field label="Spacing">
            <NumberInput value={dronePool.spacing} onChange={setSpacing} min={0.1} step={0.5} />
          </Field>
        </Group>

        <Group title="Motion">
          <Field label="Max Velocity (m/s)">
            <NumberInput value={constraints.maxVelocity} onChange={(v) => updateConstraints({ maxVelocity: v })} min={0.1} step={0.5} />
          </Field>
          <Field label="Max Accel (m/s²)">
            <NumberInput value={constraints.maxAcceleration} onChange={(v) => updateConstraints({ maxAcceleration: v })} min={0.1} step={0.5} />
          </Field>
          <Field label="Max Jerk (m/s³)">
            <NumberInput value={constraints.maxJerk} onChange={(v) => updateConstraints({ maxJerk: v })} min={1} step={1} />
          </Field>
          <Field label="Ascent Rate (m/s)">
            <NumberInput value={constraints.maxAscentRate} onChange={(v) => updateConstraints({ maxAscentRate: v })} min={0.1} step={0.5} />
          </Field>
          <Field label="Descent Rate (m/s)">
            <NumberInput value={constraints.maxDescentRate} onChange={(v) => updateConstraints({ maxDescentRate: v })} min={0.1} step={0.5} />
          </Field>
        </Group>

        <Group title="Safety">
          <Field label="Min Distance (m)">
            <NumberInput value={constraints.minDroneDistance} onChange={(v) => updateConstraints({ minDroneDistance: v })} min={0.1} step={0.1} />
          </Field>
          <Field label="Vel. Margin (%)">
            <NumberInput value={Math.round(constraints.safetyMarginVelocity * 100)} onChange={(v) => updateConstraints({ safetyMarginVelocity: v / 100 })} min={0} max={50} step={5} />
          </Field>
          <Field label="Spacing Margin (m)">
            <NumberInput value={constraints.safetyMarginSpacing} onChange={(v) => updateConstraints({ safetyMarginSpacing: v })} min={0} step={0.1} />
          </Field>
          <Field label="Battery Reserve (%)">
            <NumberInput value={Math.round(constraints.batteryReserve * 100)} onChange={(v) => updateConstraints({ batteryReserve: v / 100 })} min={0} max={50} step={5} />
          </Field>
        </Group>

        <Group title="Environment">
          <Field label="Wind Speed (m/s)">
            <NumberInput value={constraints.windSpeed} onChange={(v) => updateConstraints({ windSpeed: v })} min={0} step={0.5} />
          </Field>
          <Field label="Gust Factor">
            <NumberInput value={constraints.windGustFactor} onChange={(v) => updateConstraints({ windGustFactor: v })} min={1} max={3} step={0.1} />
          </Field>
          <Field label="GPS Accuracy (m)">
            <NumberInput value={constraints.gpsAccuracy} onChange={(v) => updateConstraints({ gpsAccuracy: v })} min={0.01} max={5} step={0.1} />
          </Field>
        </Group>

        <div className="col-span-2">
          <Group title="Geofence">
            <div className="grid grid-cols-2 gap-x-6">
              <Field label="Radius (m)">
                <NumberInput value={constraints.geofenceRadius} onChange={(v) => updateConstraints({ geofenceRadius: v })} min={1} step={10} />
              </Field>
              <Field label="Alt Min (m)">
                <NumberInput value={constraints.altitudeMin} onChange={(v) => updateConstraints({ altitudeMin: v })} min={0} step={1} />
              </Field>
              <Field label="Alt Max (m)">
                <NumberInput value={constraints.altitudeMax} onChange={(v) => updateConstraints({ altitudeMax: v })} min={1} step={5} />
              </Field>
              <Field label="Max Flight (min)">
                <NumberInput value={Math.round(constraints.maxFlightTime / 60)} onChange={(v) => updateConstraints({ maxFlightTime: v * 60 })} min={1} max={60} step={1} />
              </Field>
            </div>
            <GeofenceEditor />
          </Group>
        </div>
      </div>
    </Dialog>
  )
}
