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
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Total Mappings</h3>
            <p className="text-3xl font-bold text-blue-600">{analytics.summary.totalMappings}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Success Rate</h3>
            <p className="text-3xl font-bold text-green-600">{analytics.summary.successRate}%</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Avg Confidence</h3>
            <p className="text-3xl font-bold text-purple-600">{Math.round(analytics.summary.averageConfidence * 100)}%</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Successful</h3>
            <p className="text-3xl font-bold text-indigo-600">{analytics.summary.successfulMappings}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Confidence Breakdown */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Confidence Distribution</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-700">High (80%+)</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-600 h-2 rounded-full"
                      style={{
                        width: analytics.confidenceBreakdown.total > 0
                          ? `${(analytics.confidenceBreakdown.high / analytics.confidenceBreakdown.total) * 100}%`
                          : '0%'
                      }}
                    ></div>
                  </div>
                  <span className="font-semibold text-green-600">{analytics.confidenceBreakdown.high}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Medium (50-80%)</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-yellow-500 h-2 rounded-full"
                      style={{
                        width: analytics.confidenceBreakdown.total > 0
                          ? `${(analytics.confidenceBreakdown.medium / analytics.confidenceBreakdown.total) * 100}%`
                          : '0%'
                      }}
                    ></div>
                  </div>
                  <span className="font-semibold text-yellow-600">{analytics.confidenceBreakdown.medium}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Low (&lt;50%)</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-red-500 h-2 rounded-full"
                      style={{
                        width: analytics.confidenceBreakdown.total > 0
                          ? `${(analytics.confidenceBreakdown.low / analytics.confidenceBreakdown.total) * 100}%`
                          : '0%'
                      }}
                    ></div>
                  </div>
                  <span className="font-semibold text-red-600">{analytics.confidenceBreakdown.low}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Decade Distribution */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Music by Decade</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {analytics.decadeDistribution.map((decade, index) => (
                <div key={index} className="flex items-center justify-between">
                  <span className="text-gray-700">{decade.decade}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-20 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full"
                        style={{
                          width: analytics.decadeDistribution.length > 0
                            ? `${(decade.count / Math.max(...analytics.decadeDistribution.map(d => d.count))) * 100}%`
                            : '0%'
                        }}
                      ></div>
                    </div>
                    <span className="font-semibold text-blue-600 w-8 text-right">{decade.count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Tags */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Popular Tags</h3>
            <div className="flex flex-wrap gap-2">
              {analytics.tagDistribution.slice(0, 20).map((tag, index) => (
                <span
                  key={index}
                  className="inline-block px-3 py-1 bg-gray-200 text-gray-700 rounded-full text-sm"
                >
                  {tag.tag} ({tag.count})
                </span>
              ))}
            </div>
          </div>

          {/* Failure Reasons */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Failure Analysis</h3>
            {analytics.failureReasons.length > 0 ? (
              <div className="space-y-2">
                {analytics.failureReasons.slice(0, 8).map((failure, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <span className="text-gray-700 text-sm">{failure.reason}</span>
                    <span className="font-semibold text-red-600">{failure.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No failures recorded! 🎉</p>
            )}
          </div>

          {/* Popular Songs */}
          <div className="bg-white p-6 rounded-lg shadow lg:col-span-2">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Most Mapped Songs</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {analytics.popularSongs.slice(0, 10).map((song, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                  <div>
                    <p className="font-semibold text-gray-800">"{song.title}"</p>
                    <p className="text-sm text-gray-600">by {song.artist}</p>
                    {song.year && <p className="text-xs text-gray-500">{song.year}</p>}
                  </div>
                  <span className="text-xl font-bold text-purple-600">{song.mappingCount}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Mappings */}
          <div className="bg-white p-6 rounded-lg shadow lg:col-span-2">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Recent Mappings (Last 100)</h3>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white border-b">
                  <tr className="text-left">
                    <th className="py-2 px-1">Time</th>
                    <th className="py-2 px-1">User Input</th>
                    <th className="py-2 px-1">Mapped Song</th>
                    <th className="py-2 px-1">Confidence</th>
                    <th className="py-2 px-1">Strategy</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.recentMappings.map((mapping) => (
                    <tr key={mapping.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-1 text-gray-600 text-xs">
                        {formatTimestamp(mapping.timestamp)}
                      </td>
                      <td className="py-2 px-1 max-w-32 truncate" title={mapping.text}>
                        "{mapping.text}"
                      </td>
                      <td className="py-2 px-1">
                        {mapping.song ? (
                          <div>
                            <p className="font-medium">"{mapping.song.title}"</p>
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
                      <td className="py-2 px-1 text-xs text-gray-600">
                        {mapping.strategy || 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;