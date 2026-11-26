import type { AppRoute } from '../lib/useRoute';

interface TopBarProps {
  currentRoute: AppRoute;
  onNavigate: (to: string) => void;
}

export function TopBar({ currentRoute, onNavigate }: TopBarProps) {
  const links: Array<{ label: string; to: AppRoute }> = [
    { label: 'Overview', to: '/' },
    { label: 'Controller', to: '/controller' },
    { label: 'Dashboard', to: '/dashboard' },
    { label: 'Docs', to: '/docs' },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0D1014]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3 sm:px-6">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('/');
          }}
          className="font-display text-xl font-bold tracking-wide text-amber-400 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded"
        >
          Quarky Drive
        </a>

        <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          {links.map((item) => {
            const active = currentRoute === item.to;
            return (
              <a
                key={item.to}
                href={item.to}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(item.to);
                }}
                className={`whitespace-nowrap shrink-0 transition-colors pb-0.5 border-b-2 ${
                  active
                    ? 'text-amber-400 border-amber-400'
                    : 'text-slate-300 border-transparent hover:text-white hover:border-white/25'
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate(currentRoute === '/controller' ? '/dashboard' : '/controller')}
            className="whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            {currentRoute === '/controller' ? 'Open Dashboard' : 'Launch Controller'}
          </button>
        </div>
      </div>

      {/* Compact mobile nav strip under 15% mobile height */}
      <nav aria-label="Mobile navigation" className="flex md:hidden items-center justify-around border-t border-white/5 px-2 py-1.5 text-xs">
        {links.map((item) => {
          const active = currentRoute === item.to;
          return (
            <a
              key={item.to}
              href={item.to}
              onClick={(e) => {
                e.preventDefault();
                onNavigate(item.to);
              }}
              className={`whitespace-nowrap shrink-0 px-3 py-1.5 rounded-md font-medium transition-colors ${
                active ? 'bg-amber-500/15 text-amber-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
    </header>
  );
}
