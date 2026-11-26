import { useRef } from 'react';
import type { SteerDirection } from '../shared/protocol';

interface SteeringWheelProps {
  steer: SteerDirection;
  steerAngle: number; // -100..100
  disabled?: boolean;
  onSteerChange: (steer: SteerDirection, angle: number) => void;
  sizeClass?: string;
}

export function SteeringWheel({
  steer,
  steerAngle,
  disabled = false,
  onSteerChange,
  sizeClass = 'w-44 h-44 sm:w-52 sm:h-52',
}: SteeringWheelProps) {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const activePointerId = useRef<number | null>(null);
  const startAngleRef = useRef<number>(0);

  const visualDegrees = Math.max(-90, Math.min(90, (steerAngle / 100) * 90));

  function computePointerAngle(clientX: number, clientY: number): number {
    const el = wheelRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;
  }

  function normalizeDelta(deg: number): number {
    let d = deg;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    e.preventDefault();
    activePointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    startAngleRef.current = computePointerAngle(e.clientX, e.clientY) - visualDegrees;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled || activePointerId.current !== e.pointerId) return;
    e.preventDefault();
    const current = computePointerAngle(e.clientX, e.clientY);
    const delta = normalizeDelta(current - startAngleRef.current);
    const clampedDeg = Math.max(-90, Math.min(90, delta));
    const normalized = Math.round((clampedDeg / 90) * 100);
    const nextSteer: SteerDirection =
      normalized <= -18 ? 'left' : normalized >= 18 ? 'right' : 'center';
    onSteerChange(nextSteer, normalized);
  }

  function releaseWheel(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointerId.current === e.pointerId) {
      activePointerId.current = null;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore capture release errors
      }
      onSteerChange('center', 0);
    }
  }

  return (
    <div className="flex flex-col items-center select-none">
      {/* Curved directional telemetry arc */}
      <div className="mb-1 flex w-44 items-center justify-between px-2 text-xs font-mono-tabular">
        <span
          className={`transition-colors ${
            steer === 'left' ? 'text-amber-400 font-semibold' : 'text-slate-500'
          }`}
        >
          ◀ L
        </span>
        <span className="text-[11px] text-slate-400 tabular-nums">
          {steer === 'center' ? 'CENTER' : `${steerAngle > 0 ? '+' : ''}${steerAngle}°`}
        </span>
        <span
          className={`transition-colors ${
            steer === 'right' ? 'text-amber-400 font-semibold' : 'text-slate-500'
          }`}
        >
          R ▶
        </span>
      </div>

      {/* Interactive Virtual Wheel */}
      <div
        ref={wheelRef}
        role="slider"
        aria-label="Virtual Steering Wheel"
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={steerAngle}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releaseWheel}
        onPointerCancel={releaseWheel}
        onLostPointerCapture={() => {
          activePointerId.current = null;
          onSteerChange('center', 0);
        }}
        className={`touch-control relative flex items-center justify-center rounded-full cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${sizeClass}`}
      >
        {/* Outer curved dashed arc */}
        <svg viewBox="0 0 220 220" className="pointer-events-none absolute inset-0 h-full w-full">
          <path
            d="M 38 72 A 84 84 0 0 1 182 72"
            fill="none"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="2"
            strokeDasharray="4 6"
          />
          <path
            d={
              steer === 'left'
                ? 'M 110 26 A 84 84 0 0 0 38 72'
                : steer === 'right'
                  ? 'M 110 26 A 84 84 0 0 1 182 72'
                  : ''
            }
            fill="none"
            stroke="#f59e0b"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </svg>

        {/* Rotating 3-spoke ETS2 steering wheel */}
        <svg
          viewBox="0 0 200 200"
          style={{ transform: `rotate(${visualDegrees}deg)` }}
          className="h-[88%] w-[88%] transition-transform duration-75 ease-out drop-shadow-[0_10px_20px_rgba(0,0,0,0.85)]"
        >
          <defs>
            <linearGradient id="rimGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#353c48" />
              <stop offset="50%" stopColor="#232831" />
              <stop offset="100%" stopColor="#161a20" />
            </linearGradient>
            <radialGradient id="hubGrad" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#2c333f" />
              <stop offset="100%" stopColor="#14181f" />
            </radialGradient>
          </defs>

          {/* Outer tire-grip rim */}
          <circle cx="100" cy="100" r="82" fill="none" stroke="#0b0e12" strokeWidth="22" />
          <circle cx="100" cy="100" r="82" fill="none" stroke="url(#rimGrad)" strokeWidth="18" />
          <circle cx="100" cy="100" r="73" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />

          {/* Red 12-o'clock centering stripe */}
          <rect x="96" y="9" width="8" height="18" rx="2" fill="#ef4444" />

          {/* Left spoke */}
          <path d="M 22 92 L 75 94 L 75 108 L 22 110 Z" fill="url(#rimGrad)" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          {/* Right spoke */}
          <path d="M 125 94 L 178 92 L 178 110 L 125 108 Z" fill="url(#rimGrad)" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          {/* Bottom spoke */}
          <path d="M 90 124 L 110 124 L 114 176 L 86 176 Z" fill="url(#rimGrad)" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

          {/* Center hub */}
          <circle cx="100" cy="100" r="30" fill="url(#hubGrad)" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
          <circle
            cx="100"
            cy="100"
            r="24"
            fill="none"
            stroke={steer !== 'center' ? '#f59e0b' : 'rgba(245,158,11,0.45)'}
            strokeWidth="2"
          />
          <text
            x="100"
            y="104"
            textAnchor="middle"
            fill="#f1f5f9"
            fontSize="11"
            fontWeight="700"
            letterSpacing="1.6"
            fontFamily="Barlow Condensed, sans-serif"
          >
            STEER
          </text>
        </svg>
      </div>
    </div>
  );
}
