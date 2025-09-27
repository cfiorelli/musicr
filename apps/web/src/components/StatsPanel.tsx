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

export default function StatsPanel() {
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics();
    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchAnalytics, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/analytics');
      
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

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatMemory = (bytes: number) => {
    return `${Math.round(bytes / 1024 / 1024)}MB`;
  };

  if (loading && !analytics) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-300 rounded w-48 mb-4"></div>
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-16 bg-gray-300 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold text-red-600 mb-2">Stats Unavailable</h3>
          <p className="text-sm text-gray-600 mb-4">{error}</p>
          <button 
            onClick={fetchAnalytics}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!analytics) return null;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900">📊 Live Stats</h3>
        <div className="text-xs text-gray-500">
          Updated: {new Date(analytics.timestamp).toLocaleTimeString()}
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="text-center p-3 bg-blue-50 rounded">
          <div className="text-2xl font-bold text-blue-600">{analytics.summary.totalSongs}</div>
          <div className="text-sm text-gray-600">Songs</div>
        </div>
        
        <div className="text-center p-3 bg-green-50 rounded">
          <div className="text-2xl font-bold text-green-600">{analytics.connections.total}</div>
          <div className="text-sm text-gray-600">Connected</div>
        </div>
        
        <div className="text-center p-3 bg-purple-50 rounded">
          <div className="text-2xl font-bold text-purple-600">{analytics.summary.totalMappings}</div>
          <div className="text-sm text-gray-600">Messages</div>
        </div>
        
        <div className="text-center p-3 bg-orange-50 rounded">
          <div className="text-2xl font-bold text-orange-600">
            {analytics.summary.successRate.toFixed(0)}%
          </div>
          <div className="text-sm text-gray-600">Success</div>
        </div>
      </div>

      {/* Performance Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <h4 className="font-medium text-gray-700 mb-2">Performance</h4>
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-600">Avg Confidence</span>
              <span className="font-medium">{analytics.summary.averageConfidence.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Success Rate</span>
              <span className="font-medium">{analytics.summary.successRate.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">System</h4>
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-600">Uptime</span>
              <span className="font-medium">{formatUptime(analytics.server.uptime)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Memory</span>
              <span className="font-medium">{formatMemory(analytics.server.memory.heapUsed)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <h4 className="font-medium text-gray-700 mb-2">Recent Matches</h4>
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {analytics.recentMappings.slice(0, 5).map((mapping) => (
            <div key={mapping.id} className="flex justify-between items-start text-sm p-2 bg-gray-50 rounded">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 truncate">
                  "{mapping.text}"
                </div>
                {mapping.song && (
                  <div className="text-gray-600 text-xs truncate">
                    → {mapping.song.title} by {mapping.song.artist}
                  </div>
                )}
              </div>
              <div className="ml-2 text-right">
                {mapping.confidence && (
                  <div className={`text-xs font-medium ${
                    mapping.confidence > 0.8 ? 'text-green-600' : 
                    mapping.confidence > 0.6 ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {(mapping.confidence * 100).toFixed(0)}%
                  </div>
                )}
                <div className="text-xs text-gray-500">
                  {new Date(mapping.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}