import { useState, useEffect } from 'react';

interface AdminAnalytics {
  summary: {
    totalSongs: number;
    totalUsers: number;
    totalMappings: number;
    successfulMappings: number;
    successRate: number;
    averageConfidence: number;
  };
  connections: {
    total: number;
    byRoom: Record<string, number>;
  };
  recentMappings: Array<{
    id: string;
    text: string;
    timestamp: string;
    user: string;
    room: string;
    song: {
      title: string;
      artist: string;
      year?: number;
    } | null;
    confidence: number | null;
    strategy: string | null;
  }>;
  database: {
    status: string;
    songsCount: number;
    usersCount: number;
    messagesCount: number;
    tables: string[];
  };
  server: {
    uptime: number;
    memory: any;
    nodeVersion: string;
  };
  timestamp: string;
}

function AdminDashboard() {
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await fetch('https://musicrapi-production.up.railway.app/api/admin/analytics');
      
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Admin dashboard not available in production');
        }
        throw new Error('Failed to fetch analytics');
      }
      
      const data = await response.json();
      setAnalytics(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatConfidence = (confidence: number | null) => {
    if (confidence === null) return 'N/A';
    return `${Math.round(confidence * 100)}%`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center bg-white p-8 rounded-lg shadow-lg max-w-md">
          <div className="text-red-600 text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Error</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={fetchAnalytics}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-gray-600">No analytics data available</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-800 mb-2">
                🎵 Admin Dashboard
              </h1>
              <p className="text-gray-600">Music Mapping Analytics & Performance</p>
            </div>
            <div className="flex gap-4">
              <button
                onClick={fetchAnalytics}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Refresh Data
              </button>
              <a
                href="/"
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
              >
                Back to Chat
              </a>
            </div>
          </div>
        </div>

        {/* Summary Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Total Songs</h3>
            <p className="text-3xl font-bold text-blue-600">{analytics.summary.totalSongs}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Total Users</h3>
            <p className="text-3xl font-bold text-green-600">{analytics.summary.totalUsers}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Total Messages</h3>
            <p className="text-3xl font-bold text-purple-600">{analytics.summary.totalMappings}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Success Rate</h3>
            <p className="text-3xl font-bold text-indigo-600">{Math.round(analytics.summary.successRate)}%</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Connection Statistics */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Active Connections</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Total Connections</span>
                <span className="text-2xl font-bold text-blue-600">{analytics.connections.total}</span>
              </div>
              <div className="mt-4">
                <h4 className="text-lg font-semibold text-gray-700 mb-2">By Room</h4>
                <div className="space-y-2">
                  {Object.entries(analytics.connections.byRoom).map(([room, count]) => (
                    <div key={room} className="flex items-center justify-between">
                      <span className="text-gray-600">{room}</span>
                      <span className="font-semibold text-green-600">{count}</span>
                    </div>
                  ))}
                  {Object.keys(analytics.connections.byRoom).length === 0 && (
                    <p className="text-gray-500 text-sm">No active rooms</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Database Statistics */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Database Status</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Status</span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  analytics.database.status === 'connected' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-red-100 text-red-800'
                }`}>
                  {analytics.database.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Songs Count</span>
                <span className="font-semibold text-blue-600">{analytics.database.songsCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Users Count</span>
                <span className="font-semibold text-green-600">{analytics.database.usersCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Messages Count</span>
                <span className="font-semibold text-purple-600">{analytics.database.messagesCount}</span>
              </div>
            </div>
          </div>

          {/* Server Information */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Server Information</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Uptime</span>
                <span className="font-semibold text-indigo-600">
                  {Math.floor(analytics.server.uptime / 3600)}h {Math.floor((analytics.server.uptime % 3600) / 60)}m
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Node.js Version</span>
                <span className="font-semibold text-green-600">{analytics.server.nodeVersion}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Memory Usage</span>
                <span className="font-semibold text-purple-600">
                  {Math.round(analytics.server.memory.heapUsed / 1024 / 1024)}MB
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Last updated: {formatTimestamp(analytics.timestamp)}
              </div>
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Performance Metrics</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Total Mappings</span>
                <span className="font-semibold text-blue-600">{analytics.summary.totalMappings}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Successful Mappings</span>
                <span className="font-semibold text-green-600">{analytics.summary.successfulMappings}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Success Rate</span>
                <span className="font-semibold text-purple-600">{Math.round(analytics.summary.successRate)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Average Confidence</span>
                <span className="font-semibold text-indigo-600">{Math.round(analytics.summary.averageConfidence * 100)}%</span>
              </div>
            </div>
          </div>

          {/* Recent Mappings */}
          <div className="bg-white p-6 rounded-lg shadow lg:col-span-2">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Recent Activity</h3>
            <div className="max-h-96 overflow-y-auto">
              {analytics.recentMappings.length > 0 ? (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white border-b">
                    <tr className="text-left">
                      <th className="py-2 px-1">Time</th>
                      <th className="py-2 px-1">User</th>
                      <th className="py-2 px-1">Input</th>
                      <th className="py-2 px-1">Matched Song</th>
                      <th className="py-2 px-1">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.recentMappings.map((mapping) => (
                      <tr key={mapping.id} className="border-b hover:bg-gray-50">
                        <td className="py-2 px-1 text-gray-600 text-xs">
                          {new Date(mapping.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-2 px-1 text-xs text-gray-600">
                          {mapping.user}
                        </td>
                        <td className="py-2 px-1 max-w-32 truncate" title={mapping.text}>
                          "{mapping.text}"
                        </td>
                        <td className="py-2 px-1">
                          {mapping.song ? (
                            <div>
                              <p className="font-medium text-xs">"{mapping.song.title}"</p>
                              <p className="text-xs text-gray-600">by {mapping.song.artist}</p>
                            </div>
                          ) : (
                            <span className="text-red-600 text-xs">No match</span>
                          )}
                        </td>
                        <td className="py-2 px-1">
                          <span className={`px-2 py-1 rounded text-xs ${
                            mapping.confidence === null ? 'bg-gray-200 text-gray-600' :
                            mapping.confidence > 0.8 ? 'bg-green-200 text-green-800' :
                            mapping.confidence >= 0.5 ? 'bg-yellow-200 text-yellow-800' :
                            'bg-red-200 text-red-800'
                          }`}>
                            {formatConfidence(mapping.confidence)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-gray-500 text-sm">No recent activity</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;