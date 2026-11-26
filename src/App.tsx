import { TopBar } from './components/TopBar';
import { useRoute } from './lib/useRoute';
import { ControllerPage } from './pages/ControllerPage';
import { DashboardPage } from './pages/DashboardPage';
import { DocsPage } from './pages/DocsPage';
import { HubPage } from './pages/HubPage';

export default function App() {
  const { route, search, navigate } = useRoute();

  return (
    <div className="min-h-screen bg-[#0D1014] text-[#F1F5F9]">
      <TopBar currentRoute={route} onNavigate={navigate} />
      {route === '/' && <HubPage onNavigate={navigate} />}
      {route === '/controller' && <ControllerPage search={search} onNavigate={navigate} />}
      {route === '/dashboard' && <DashboardPage search={search} onNavigate={navigate} />}
      {route === '/docs' && <DocsPage />}
    </div>
  );
}
