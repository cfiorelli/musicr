import { useState, useEffect } from 'react';
import { API_URL } from '../utils/apiUrl';

interface AdminAnalytics {
  summary: {
    totalSongs: number;
    totalUsers: number;
    uniqueDevices: number;
    totalMappings: number;
    successfulMappings: number;
    successRate: number;
    averageConfidence: number;
  };
  connections: {
    total: number;
    byRoom: Record<string, { connections: number; users: number }>;
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
      const response = await fetch(`${API_URL}/admin/analytics`);
      
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

  // Skeleton card shown while loading
  const StatSkeleton = () => (
    <div className="bg-white p-6 rounded-lg shadow animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-3/4 mb-3"></div>
      <div className="h-8 bg-gray-300 rounded w-1/2"></div>
    </div>
  );

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
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Refreshing…' : 'Refresh Data'}
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

        {/* Error banner (inline, not full-screen) */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-red-600 text-xl">⚠️</span>
              <p className="text-red-700">{error}</p>
            </div>
            <button
              onClick={fetchAnalytics}
              className="px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-sm"
            >
              Retry
            </button>
          </div>
        )}

        {/* Summary Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {!analytics ? (
            <><StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton /></>
          ) : (
            <>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Total Songs</h3>
                <p className="text-3xl font-bold text-blue-600">{analytics.summary?.totalSongs ?? 0}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-700 mb-1">Unique Devices</h3>
                <p className="text-sm text-gray-500 mb-2">Actual users</p>
                <p className="text-3xl font-bold text-green-600">{analytics.summary?.uniqueDevices ?? 0}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-700 mb-1">Total User Records</h3>
                <p className="text-sm text-gray-500 mb-2">Including reconnects</p>
                <p className="text-3xl font-bold text-gray-600">{analytics.summary?.totalUsers ?? 0}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Success Rate</h3>
                <p className="text-3xl font-bold text-indigo-600">{Math.round(analytics.summary?.successRate ?? 0)}%</p>
              </div>
            </>
          )}
        </div>

        {/* Secondary Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {!analytics ? (
            <><StatSkeleton /><StatSkeleton /><StatSkeleton /></>
          ) : (
            <>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Total Messages</h3>
                <p className="text-3xl font-bold text-purple-600">{analytics.summary?.totalMappings ?? 0}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Successful Matches</h3>
                <p className="text-3xl font-bold text-green-600">{analytics.summary?.successfulMappings ?? 0}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Avg Confidence</h3>
                <p className="text-3xl font-bold text-blue-600">{Math.round((analytics.summary?.averageConfidence ?? 0) * 100)}%</p>
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Connection Statistics */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Active Connections</h3>
            {!analytics ? <div className="animate-pulse space-y-3"><div className="h-4 bg-gray-200 rounded w-full" /><div className="h-4 bg-gray-200 rounded w-3/4" /></div> : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Total Connections</span>
                <span className="text-2xl font-bold text-blue-600">{analytics.connections?.total ?? 0}</span>
              </div>
              <div className="mt-4">
                <h4 className="text-lg font-semibold text-gray-700 mb-2">By Room</h4>
                <div className="space-y-2">
                  {Object.entries(analytics.connections?.byRoom ?? {}).map(([room, stat]) => (
                    <div key={room} className="flex items-center justify-between">
                      <span className="text-gray-600 text-sm truncate max-w-40" title={room}>{room}</span>
                      <span className="font-semibold text-green-600">{stat.connections} conn / {stat.users} users</span>
                    </div>
                  ))}
                  {Object.keys(analytics.connections?.byRoom ?? {}).length === 0 && (
                    <p className="text-gray-500 text-sm">No active rooms</p>
                  )}
                </div>
              </div>
            </div>
            )}
          </div>

          {/* Database Statistics */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Database Status</h3>
            {!analytics ? <div className="animate-pulse space-y-3"><div className="h-4 bg-gray-200 rounded w-full" /><div className="h-4 bg-gray-200 rounded w-3/4" /></div> : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Status</span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  (analytics.database?.status ?? 'unknown') === 'connected'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'
                }`}>
                  {analytics.database?.status ?? 'unknown'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Songs Count</span>
                <span className="font-semibold text-blue-600">{analytics.database?.songsCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">User Records</span>
                <span className="font-semibold text-gray-600">{analytics.database?.usersCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Unique Devices</span>
                <span className="font-semibold text-green-600">{analytics.summary?.uniqueDevices ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Messages Count</span>
                <span className="font-semibold text-purple-600">{analytics.database?.messagesCount ?? 0}</span>
              </div>
            </div>
            )}
          </div>

          {/* Server Information */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Server Information</h3>
            {!analytics ? <div className="animate-pulse space-y-3"><div className="h-4 bg-gray-200 rounded w-full" /><div className="h-4 bg-gray-200 rounded w-3/4" /></div> : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Uptime</span>
                <span className="font-semibold text-indigo-600">
                  {Math.floor((analytics.server?.uptime ?? 0) / 3600)}h {Math.floor(((analytics.server?.uptime ?? 0) % 3600) / 60)}m
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Node.js Version</span>
                <span className="font-semibold text-green-600">{analytics.server?.nodeVersion ?? 'Unknown'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Memory Usage</span>
                <span className="font-semibold text-purple-600">
                  {Math.round((analytics.server?.memory?.heapUsed ?? 0) / 1024 / 1024)}MB
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Last updated: {analytics.timestamp ? formatTimestamp(analytics.timestamp) : 'Unknown'}
              </div>
            </div>
            )}
          </div>

          {/* Performance Metrics */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Performance Metrics</h3>
            {!analytics ? <div className="animate-pulse space-y-3"><div className="h-4 bg-gray-200 rounded w-full" /><div className="h-4 bg-gray-200 rounded w-3/4" /></div> : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Total Mappings</span>
                <span className="font-semibold text-blue-600">{analytics.summary?.totalMappings ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Successful Mappings</span>
                <span className="font-semibold text-green-600">{analytics.summary?.successfulMappings ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Success Rate</span>
                <span className="font-semibold text-purple-600">{Math.round(analytics.summary?.successRate ?? 0)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Average Confidence</span>
                <span className="font-semibold text-indigo-600">{Math.round((analytics.summary?.averageConfidence ?? 0) * 100)}%</span>
              </div>
            </div>
            )}
          </div>

          {/* Recent Mappings */}
          <div className="bg-white p-6 rounded-lg shadow lg:col-span-2">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Recent Activity</h3>
            <div className="max-h-96 overflow-y-auto">
              {!analytics ? (
                <div className="animate-pulse space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-8 bg-gray-200 rounded w-full" />)}
                </div>
              ) : (analytics.recentMappings ?? []).length > 0 ? (
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
                    {(analytics.recentMappings ?? []).map((mapping) => (
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