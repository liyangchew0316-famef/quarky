import type { GearPosition } from '../shared/protocol';

interface SpeedometerGaugeProps {
  commandedSpeed: number; // 0..100
  speedLimit: number; // 0..100
  gear: GearPosition;
  emergencyStop: boolean;
  brake: boolean;
}

export function SpeedometerGauge({
  commandedSpeed,
  speedLimit,
  gear,
  emergencyStop,
  brake,
}: SpeedometerGaugeProps) {
  // Sweep from -135 deg to +135 deg (270 degree arc)
  const startAngle = -135;
  const sweep = 270;
  const clampedCmd = Math.max(0, Math.min(100, commandedSpeed));
  const clampedLimit = Math.max(0, Math.min(100, speedLimit));

  const needleDeg = startAngle + (clampedCmd / 100) * sweep;
  const limitDeg = startAngle + (clampedLimit / 100) * sweep;

  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  const arcTotal = (sweep / 360) * circumference;
  const cmdArcLen = (clampedCmd / 100) * arcTotal;
  const limitArcLen = (clampedLimit / 100) * arcTotal;

  const accentColor = emergencyStop
    ? '#ef4444'
    : brake
      ? '#f97316'
      : gear === 'R'
        ? '#f59e0b'
        : '#10b981';

  const ticks = [0, 25, 50, 75, 100];

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-48 w-48 sm:h-52 sm:w-52 select-none">
        <svg viewBox="0 0 200 200" className="h-full w-full">
          <defs>
            <radialGradient id="gaugeFace" cx="50%" cy="45%" r="55%">
              <stop offset="0%" stopColor="#1b222c" />
              <stop offset="100%" stopColor="#0c0f14" />
            </radialGradient>
          </defs>

          {/* Outer metallic bezel */}
          <circle cx="100" cy="100" r="95" fill="url(#gaugeFace)" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
          <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />

          {/* Background track arc */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${arcTotal} ${circumference}`}
            transform="rotate(135 100 100)"
          />

          {/* Speed limit envelope arc (amber hairline) */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke="rgba(245, 158, 11, 0.28)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${limitArcLen} ${circumference}`}
            transform="rotate(135 100 100)"
          />

          {/* Active commanded speed arc */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke={accentColor}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${cmdArcLen} ${circumference}`}
            transform="rotate(135 100 100)"
            className="transition-all duration-100"
          />

          {/* Scale labels */}
          {ticks.map((val) => {
            const deg = startAngle + (val / 100) * sweep;
            const rad = ((deg - 90) * Math.PI) / 180;
            const tx = 100 + Math.cos(rad) * 58;
            const ty = 100 + Math.sin(rad) * 58 + 3;
            return (
              <text
                key={val}
                x={tx}
                y={ty}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="10"
                fontWeight="600"
                fontFamily="JetBrains Mono, monospace"
              >
                {val}
              </text>
            );
          })}

          {/* Speed limiter tick marker */}
          <g transform={`rotate(${limitDeg} 100 100)`}>
            <line x1="100" y1="16" x2="100" y2="29" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
          </g>

          {/* Animated indicator needle */}
          <g transform={`rotate(${needleDeg} 100 100)`} className="transition-transform duration-100 ease-out">
            <line x1="100" y1="100" x2="100" y2="30" stroke={accentColor} strokeWidth="3" strokeLinecap="round" />
            <circle cx="100" cy="100" r="6" fill="#0d1014" stroke={accentColor} strokeWidth="2.5" />
          </g>
        </svg>

        {/* Digital center readout */}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center text-center">
          <span className="font-mono-tabular text-3xl font-bold leading-none text-white">
            {clampedCmd}
            <span className="ml-0.5 text-sm font-medium text-amber-400">%</span>
          </span>
          <span className="mt-1 text-[10px] font-semibold tracking-wider text-amber-400/90">
            COMMANDED SETTING
          </span>
        </div>
      </div>

      {/* Explicit distinction between commanded speed and physical speed */}
      <div className="mt-1 text-center text-[11px] text-slate-400 font-mono-tabular">
        <span>Limit {clampedLimit}%</span>
        <span className="mx-1.5 text-slate-600">·</span>
        <span>Physical Speed: N/A (No Encoder)</span>
      </div>
    </div>
  );
}
