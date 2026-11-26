import { useRef } from 'react';

interface AcceleratorPedalProps {
  value: number; // 0..100
  disabled?: boolean;
  onChange: (val: number) => void;
  compact?: boolean;
}

export function AcceleratorPedal({
  value,
  disabled = false,
  onChange,
  compact = false,
}: AcceleratorPedalProps) {
  const pointerIdRef = useRef<number | null>(null);

  function computeThrottle(e: React.PointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    // Bottom of pedal = 45% starter press, dragging upward scales smoothly to 100%
    const relFromBottom = 1 - (e.clientY - rect.top) / rect.height;
    const clamped = Math.max(0.35, Math.min(1, relFromBottom + 0.25));
    return Math.round(clamped * 100);
  }

  function handleDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    e.preventDefault();
    pointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(computeThrottle(e));
  }

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled || pointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    onChange(computeThrottle(e));
  }

  function release(e: React.PointerEvent<HTMLDivElement>) {
    if (pointerIdRef.current === e.pointerId) {
      pointerIdRef.current = null;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
      onChange(0);
    }
  }

  const active = value > 0;

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <span className="text-[11px] font-semibold tracking-wider text-emerald-400">
        ACCELERATOR
      </span>
      <div
        role="button"
        aria-label="Accelerator Pedal (Press and hold to drive)"
        aria-pressed={active}
        tabIndex={0}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={() => {
          pointerIdRef.current = null;
          onChange(0);
        }}
        className={`touch-control pedal-tread relative flex w-20 sm:w-24 flex-col justify-between overflow-hidden rounded-xl border p-2.5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
          compact ? 'h-40 sm:h-52' : 'h-52 sm:h-72'
        } ${
          active
            ? 'border-emerald-400 bg-emerald-950/35 shadow-[0_0_24px_rgba(16,185,129,0.28)] scale-[0.985]'
            : 'border-emerald-500/45 bg-[#12171f] hover:border-emerald-400/75'
        } ${disabled ? 'opacity-45 cursor-not-allowed' : ''}`}
      >
        {/* Dynamic fill indicator */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 bg-emerald-500/20 transition-all duration-75"
          style={{ height: `${value}%` }}
        />

        <div className="relative z-10 flex items-center justify-between text-[10px] font-mono-tabular text-emerald-300">
          <span>GAS</span>
          <span>{value}%</span>
        </div>

        <div className="relative z-10 mx-auto h-1.5 w-12 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.75)]" />
      </div>
    </div>
  );
}

interface BrakePedalProps {
  active: boolean;
  onChange: (pressed: boolean) => void;
  compact?: boolean;
}

export function BrakePedal({ active, onChange, compact = false }: BrakePedalProps) {
  const pointerIdRef = useRef<number | null>(null);

  function handleDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    pointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(true);
  }

  function release(e: React.PointerEvent<HTMLDivElement>) {
    if (pointerIdRef.current === e.pointerId) {
      pointerIdRef.current = null;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
      onChange(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <span className="text-[11px] font-semibold tracking-wider text-rose-400">
        BRAKE
      </span>
      <div
        role="button"
        aria-label="Brake Pedal (Press and hold to stop)"
        aria-pressed={active}
        tabIndex={0}
        onPointerDown={handleDown}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={() => {
          pointerIdRef.current = null;
          onChange(false);
        }}
        className={`touch-control pedal-tread relative flex w-20 sm:w-24 flex-col justify-between overflow-hidden rounded-xl border p-2.5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 ${
          compact ? 'h-32 sm:h-44' : 'h-44 sm:h-60'
        } ${
          active
            ? 'border-rose-400 bg-rose-950/45 shadow-[0_0_24px_rgba(244,63,94,0.35)] scale-[0.985]'
            : 'border-rose-500/50 bg-[#12171f] hover:border-rose-400/80'
        }`}
      >
        <div className="relative z-10 flex items-center justify-between text-[10px] font-mono-tabular text-rose-300">
          <span>STOP</span>
          <span>{active ? 'ON' : 'IDLE'}</span>
        </div>

        <div className="relative z-10 mx-auto h-1.5 w-12 rounded-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.75)]" />
      </div>
    </div>
  );
}
