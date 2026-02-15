import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { useChatStore } from './stores/chatStore';
import ChatInterface from './components/ChatInterface';
import RoomUserList from './components/RoomUserList';
import AdminDashboard from './components/AdminDashboard';

function MaintenanceBanner() {
  const { connectionStatus } = useChatStore();
  const [maintenance, setMaintenance] = useState(false);

  useEffect(() => {
    // Detect maintenance via WS connection failures returning 503
    if (connectionStatus === 'disconnected') {
      const checkMaintenance = async () => {
        try {
          const { VITE_API_URL } = (import.meta as any).env || {};
          const base = VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:4000`;
          const res = await fetch(`${base}/health`);
          const data = await res.json();
          // If health returns ok but we can't connect via WS, server may be in maintenance
          setMaintenance(!data.ok);
        } catch {
          // Can't reach server at all
        }
      };
      const t = setTimeout(checkMaintenance, 3000);
      return () => clearTimeout(t);
    } else {
      setMaintenance(false);
    }
  }, [connectionStatus]);

  if (!maintenance) return null;

  return (
    <div className="bg-amber-900/80 text-amber-200 text-center text-sm py-2 px-4">
      Musicr is temporarily in maintenance mode. Chat will resume shortly.
    </div>
  );
}

function HomePage() {
  const { connect, disconnect, connectionStatus, setupLifecycleListeners } = useChatStore();

  useEffect(() => {
    // Connect to WebSocket on component mount
    connect();

    // Set up lifecycle listeners (visibilitychange, focus, health checks)
    const cleanupLifecycle = setupLifecycleListeners();

    // Cleanup on unmount
    return () => {
      cleanupLifecycle(); // Remove lifecycle listeners
      disconnect();
    };
  }, [connect, disconnect, setupLifecycleListeners]);

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800">
      <MaintenanceBanner />
      {/* Header */}
      <header className="flex-none px-4 md:px-6 py-3 border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              🎵 Musicr
            </h1>
            <button
              onClick={(e) => {
                e.preventDefault();
                // Trigger info modal (not onboarding)
                const event = new CustomEvent('show-info');
                window.dispatchEvent(event);
              }}
              className="text-sm text-gray-400 hover:text-gray-300 transition-colors cursor-pointer"
            >
              About Musicr
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                connectionStatus === 'connected'
                  ? 'bg-emerald-500'
                  : connectionStatus === 'connecting'
                  ? 'bg-amber-500 animate-pulse'
                  : 'bg-red-500'
              }`} />
              <span className="text-sm text-gray-400 hidden md:inline">
                {connectionStatus}
              </span>
            </div>
            <Link
              to="/admin"
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors border border-gray-700"
            >
              Admin
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        <div className="max-w-screen-2xl mx-auto h-full px-3 md:px-6 py-3 md:py-4">
          <div className="flex gap-3 md:gap-4 h-full">
            {/* Left: Chat Interface (takes full height) */}
            <div className="flex-1 min-w-0">
              <ChatInterface />
            </div>

            {/* Right: Sidebar (hidden on mobile, shown on md+) */}
            <div className="hidden md:block w-72 lg:w-80 flex-none">
              <RoomUserList />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="flex-none px-4 py-1.5 text-center text-xs text-gray-500">
        Built by{' '}
        <a href="https://cfiorelli.github.io/" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-300 transition-colors underline decoration-gray-600 hover:decoration-gray-400">
          Christopher Fiorelli
        </a>
        {' '}&middot;{' '}
        <a href="https://github.com/cfiorelli/musicr" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-300 transition-colors underline decoration-gray-600 hover:decoration-gray-400">
          GitHub
        </a>
        {' '}&middot;{' '}
        <span className="text-gray-600" title={`Built ${(globalThis as any).__BUILD_TIME__ || ''}`}>
          v{(globalThis as any).__BUILD_VERSION__ || 'dev'}
        </span>
      </footer>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin" element={<AdminDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;