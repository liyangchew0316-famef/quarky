import { ArrowRight, Cpu, ShieldCheck, Smartphone, Wifi } from 'lucide-react';

interface HubPageProps {
  onNavigate: (to: string) => void;
}

export function HubPage({ onNavigate }: HubPageProps) {
  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
      {/* Hero section */}
      <section className="grid gap-10 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-7 space-y-6">
          <p className="text-xs font-semibold tracking-widest text-amber-400">
            CROSS-DEVICE ROBOT DRIVE SYSTEM
          </p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl text-balance">
            Operate Your Quarky Car From Any Mobile Browser
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-slate-300">
            Quarky Drive pairs an ETS2-inspired mobile touch controller with an authenticated WebSocket relay and a lightweight Windows host bridge. Your Windows PC keeps its Bluetooth link inside PictoBlox while your phone drives over HTTPS and WSS.
          </p>

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <button
              type="button"
              onClick={() => onNavigate('/controller')}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <span>Open Mobile Controller</span>
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/dashboard')}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#171C23] px-5 py-3 text-sm font-semibold text-slate-100 transition-colors hover:border-amber-400/50 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <span>Open Host Dashboard</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/docs')}
              className="px-3 py-3 text-sm font-medium text-slate-300 underline decoration-white/20 underline-offset-4 hover:text-white"
            >
              Setup & PictoBlox Guide
            </button>
          </div>
        </div>

        {/* Operational States Panel (explicit 3-state clarity) */}
        <div className="lg:col-span-5 ets-panel rounded-2xl p-6 space-y-5">
          <div className="border-b border-white/10 pb-3">
            <h2 className="font-display text-xl font-semibold text-white">
              Three Explicit Operational States
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Quarky Drive separates UI simulation, live relay messaging, and physical hardware verification.
            </p>
          </div>

          <div className="space-y-4 text-sm">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-100">1. Functioning UI (Local Preview)</span>
                <span className="font-mono-tabular text-xs text-amber-400">Available Now</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-400">
                Interactive steering wheel, pedals, speed limiter, and E-STOP run in-browser for layout and ergonomics inspection without a relay link.
              </p>
            </div>

            <div className="border-t border-white/5 pt-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-100">2. Simulated Commands (Live Relay)</span>
                <span className="font-mono-tabular text-xs text-emerald-400">Available Now</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-400">
                Pair your phone to the Desktop Dashboard using a 6-character code to verify real WebSocket auth, rate limiting, and fail-safe stops end-to-end.
              </p>
            </div>

            <div className="border-t border-white/5 pt-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-100">3. Physical Hardware (PictoBlox + Quarky)</span>
                <span className="font-mono-tabular text-xs text-rose-400">Requires On-Site Test</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-400">
                Windows host bridge delivers Win32 scan codes to a focused PictoBlox Stage window. Hardware Bluetooth motion must be verified with your physical Quarky robot.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Architecture Flow */}
      <section className="mt-14 border-t border-white/10 pt-10">
        <h2 className="font-display text-2xl font-semibold text-white">
          System Architecture
        </h2>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          <div className="ets-panel rounded-xl p-5 space-y-2.5">
            <Smartphone className="h-5 w-5 text-amber-400" />
            <h3 className="text-base font-semibold text-white">Phone / Tablet Browser</h3>
            <p className="text-xs leading-relaxed text-slate-400">
              No app install needed. Opens <span className="font-mono text-slate-200">/controller</span> in iOS Safari or Android Chrome, supports portrait and landscape multi-touch, and releases to STOP on pointer cancel or tab switch.
            </p>
          </div>

          <div className="ets-panel rounded-xl p-5 space-y-2.5">
            <Wifi className="h-5 w-5 text-amber-400" />
            <h3 className="text-base font-semibold text-white">Authenticated WSS Relay</h3>
            <p className="text-xs leading-relaxed text-slate-400">
              Issues single-use 5-minute pairing codes, verifies tokens with constant-time hashes, clamps speed 0–100, rejects stale sequence numbers, and triggers server watchdog STOP after 850 ms of silence.
            </p>
          </div>

          <div className="ets-panel rounded-xl p-5 space-y-2.5">
            <Cpu className="h-5 w-5 text-amber-400" />
            <h3 className="text-base font-semibold text-white">Windows Bridge & PictoBlox</h3>
            <p className="text-xs leading-relaxed text-slate-400">
              Connects outbound from Windows with zero open inbound ports. Verifies PictoBlox window focus, enforces a 600 ms local watchdog, and drives Quarky using manual Stage key blocks.
            </p>
          </div>
        </div>
      </section>

      {/* Safety guarantees */}
      <section className="mt-10 ets-recessed rounded-xl p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-white">Press-and-Release Safety & STOP Priority</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Emergency STOP overrides throttle, steering, and rate limits across browser, relay, and Windows host bridge. Zero AI, face recognition, or vision modules are included.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/docs')}
          className="whitespace-nowrap shrink-0 rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-amber-400/50 hover:text-amber-300"
        >
          Read Hardware Test Plan
        </button>
      </section>
    </main>
  );
}
