import { useState, useRef, useEffect } from 'react';
import { useChatStore, type Message } from '../stores/chatStore';

const ChatInterface = () => {
  const [inputValue, setInputValue] = useState('');
  const [showQuickPalette, setShowQuickPalette] = useState(false);
  const [lastMessage, setLastMessage] = useState('');
  const [currentSelectedMessage, setCurrentSelectedMessage] = useState<string | null>(null);
  const [currentAlternates, setCurrentAlternates] = useState<Message['alternates']>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { 
    messages, 
    sendMessage, 
    connectionStatus, 
    userHandle, 
    currentRoom,
    familyFriendly,
    setFamilyFriendly,
    selectAlternate
  } = useChatStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && connectionStatus === 'connected') {
      setLastMessage(inputValue.trim());
      sendMessage(inputValue.trim());
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp' && inputValue === '' && lastMessage) {
      e.preventDefault();
      setInputValue(lastMessage);
    }
    
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setShowQuickPalette(true);
    }
    
    if (e.key === 'Escape') {
      setShowQuickPalette(false);
    }
  };

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const formatSongDisplay = (message: Message) => {
    if (message.songTitle && message.songArtist) {
      return `${message.songTitle} — ${message.songArtist}${message.songYear ? ` (${message.songYear})` : ''}`;
    }
    return null;
  };

  const QuickPalette = ({ alternates, onSelect, onClose }: {
    messageId: string;
    alternates: Message['alternates'];
    onSelect: (alternate: NonNullable<Message['alternates']>[0]) => void;
    onClose: () => void;
  }) => (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white/20 backdrop-blur-md rounded-lg p-6 max-w-md w-full mx-4 max-h-96 overflow-y-auto">
        <h3 className="text-white font-semibold mb-4">Choose Alternative Song</h3>
        <div className="space-y-2">
          {alternates?.map((alt) => (
            <button
              key={alt.id}
              onClick={() => {
                onSelect(alt);
                onClose();
              }}
              className="w-full text-left p-3 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <div className="font-medium">{alt.title}</div>
              <div className="text-sm text-gray-300">{alt.artist} ({alt.year})</div>
              {alt.score && (
                <div className="text-xs text-gray-400">Score: {(alt.score * 100).toFixed(1)}%</div>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full p-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header with Room and Handle */}
      <div className="bg-white/10 backdrop-blur-md rounded-lg p-4 mb-4 flex justify-between items-center">
        <div>
          <h2 className="text-white font-semibold">#{currentRoom}</h2>
          <p className="text-gray-300 text-sm">You are: <span className="font-medium">{userHandle || 'connecting...'}</span></p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-white text-sm">
            <input
              type="checkbox"
              checked={familyFriendly}
              onChange={(e) => setFamilyFriendly(e.target.checked)}
              className="rounded"
            />
            Family-friendly
          </label>
          <div className={`px-3 py-1 rounded-full text-sm ${
            connectionStatus === 'connected' 
              ? 'bg-green-500 text-white' 
              : connectionStatus === 'connecting'
              ? 'bg-yellow-500 text-white'
              : 'bg-red-500 text-white'
          }`}>
            {connectionStatus}
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 mb-6 h-96 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="text-center text-gray-300 mt-20">
            <p>🎵 Start chatting! Your messages will be converted to song titles.</p>
            <p className="text-sm mt-2">Use ↑ to edit last message, Cmd+K for alternatives</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => {
              const songDisplay = formatSongDisplay(message);
              return (
                <div key={message.id} className="group">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      {/* Message content */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-blue-300 font-medium text-sm">
                          {message.anonHandle}
                        </span>
                        <span className="text-gray-400 text-xs">
                          {new Date(message.timestamp).toLocaleTimeString()}
                        </span>
                        {message.isOptimistic && (
                          <span className="text-yellow-400 text-xs">sending...</span>
                        )}
                      </div>
                      
                      <div className="bg-gray-700/50 rounded-lg p-3 text-white">
                        <div className="flex items-center gap-2">
                          <span>{message.content}</span>
                          {songDisplay && (
                            <>
                              <span className="text-gray-300">→</span>
                              <span className="font-medium text-green-300">{songDisplay}</span>
                              {message.reasoning && (
                                <button
                                  title={message.reasoning}
                                  className="text-xs bg-blue-500/50 hover:bg-blue-500/70 px-2 py-1 rounded text-white transition-colors"
                                >
                                  why?
                                </button>
                              )}
                              {message.alternates && message.alternates.length > 0 && (
                                <button
                                  onClick={() => {
                                    setCurrentSelectedMessage(message.id);
                                    setCurrentAlternates(message.alternates || []);
                                    setShowQuickPalette(true);
                                  }}
                                  className="text-xs bg-purple-500/50 hover:bg-purple-500/70 px-2 py-1 rounded text-white transition-colors opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  alternatives
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Message Input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message... (↑ for last message, Cmd+K for alternatives)"
          className="flex-1 px-4 py-3 rounded-lg bg-white/10 backdrop-blur-md text-white placeholder-gray-400 border border-white/20 focus:border-blue-400 focus:outline-none"
          disabled={connectionStatus !== 'connected'}
        />
        <button
          type="submit"
          disabled={!inputValue.trim() || connectionStatus !== 'connected'}
          className="px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-500 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
        >
          Send
        </button>
      </form>

      {/* Quick Palette for Alternatives */}
      {showQuickPalette && currentSelectedMessage && currentAlternates && (
        <QuickPalette
          messageId={currentSelectedMessage}
          alternates={currentAlternates}
          onSelect={(alternate) => selectAlternate(currentSelectedMessage, alternate)}
          onClose={() => {
            setShowQuickPalette(false);
            setCurrentSelectedMessage(null);
            setCurrentAlternates([]);
          }}
        />
      )}
    </div>
  );
};

export default ChatInterface;