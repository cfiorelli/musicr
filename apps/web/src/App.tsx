import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { useChatStore } from './stores/chatStore';
import ChatInterface from './components/ChatInterface';
import RoomUserList from './components/RoomUserList';
import AdminDashboard from './components/AdminDashboard';

function HomePage() {
  const { connect, disconnect, connectionStatus } = useChatStore();

  useEffect(() => {
    // Connect to WebSocket on component mount
    connect();
    
    // Cleanup on unmount
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      {/* Header */}
      <header className="flex-none px-4 py-4 border-b border-white/10">
        <div className="container mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">
              🎵 Musicr
            </h1>
            <p className="text-sm text-gray-300">
              Your messages become song titles
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-full text-sm ${
              connectionStatus === 'connected'
                ? 'bg-green-500 text-white'
                : connectionStatus === 'connecting'
                ? 'bg-yellow-500 text-white'
                : 'bg-red-500 text-white'
            }`}>
              {connectionStatus}
            </span>
            <Link
              to="/admin"
              className="px-3 py-1 bg-gray-700 text-white rounded-full text-sm hover:bg-gray-600 transition-colors"
            >
              Admin
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        <div className="container mx-auto h-full px-4 py-4">
          <div className="flex gap-6 h-full">
            {/* Left: Chat Interface (takes full height) */}
            <div className="flex-1 min-w-0">
              <ChatInterface />
            </div>

            {/* Right: Sidebar (hidden on mobile, shown on md+) */}
            <div className="hidden md:block w-80 flex-none">
              <RoomUserList />
            </div>
          </div>
        </div>
      </div>
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