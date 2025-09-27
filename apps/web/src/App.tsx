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
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            🎵 Musicr
          </h1>
          <p className="text-lg text-gray-300">
            Chat where your messages become song titles
          </p>
          <div className="mt-2 flex items-center justify-center gap-4">
            <span className={`inline-block px-3 py-1 rounded-full text-sm ${
              connectionStatus === 'connected' 
                ? 'bg-green-500 text-white' 
                : connectionStatus === 'connecting'
                ? 'bg-yellow-500 text-white'
                : 'bg-red-500 text-white'
            }`}>
              {connectionStatus}
            </span>
            {/* Admin dashboard link (backend handles dev-only restriction) */}
            <Link
              to="/admin"
              className="px-3 py-1 bg-gray-700 text-white rounded-full text-sm hover:bg-gray-600 transition-colors"
            >
              Admin Dashboard
            </Link>
          </div>
        </header>
        
        <div className="flex gap-6">
          {/* Main chat area */}
          <div className="flex-1">
            <ChatInterface />
          </div>
          
          {/* Sidebar with room users */}
          <div className="w-80">
            <RoomUserList />
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