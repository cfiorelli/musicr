import { useState, useRef, useEffect } from 'react';
import { useChatStore, type Message } from '../stores/chatStore';

const ChatInterface = () => {
  const [inputValue, setInputValue] = useState('');
  const [showQuickPalette, setShowQuickPalette] = useState(false);
  const [lastMessage, setLastMessage] = useState('');
  const [currentSelectedMessage, setCurrentSelectedMessage] = useState<string | null>(null);
  const [currentAlternates, setCurrentAlternates] = useState<Message['alternates']>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedWhyPanel, setExpandedWhyPanel] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem('musicr-onboarding-dismissed') !== 'true';
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const examplePrompts = [
    "I need a song for late-night coding",
    "We just got good news",
    "I feel anxious but hopeful"
  ];
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

  const handleExampleClick = (example: string) => {
    if (connectionStatus === 'connected') {
      setLastMessage(example);
      sendMessage(example);
      if (showOnboarding) {
        dismissOnboarding();
      }
    }
  };

  const dismissOnboarding = () => {
    setShowOnboarding(false);
    localStorage.setItem('musicr-onboarding-dismissed', 'true');
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

  // Auto-scroll to bottom when new messages arrive (if auto-scroll is enabled)
  useEffect(() => {
    if (autoScroll && messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  // Handle scroll detection to determine if user scrolled up
  const handleScroll = () => {
    if (messagesRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 50; // 50px threshold
      
      // Enable auto-scroll if user scrolled back to bottom
      if (isNearBottom && !autoScroll) {
        setAutoScroll(true);
      }
      // Disable auto-scroll if user scrolled up from bottom
      else if (!isNearBottom && autoScroll) {
        setAutoScroll(false);
      }
    }
  };

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
    <div className="flex flex-col h-full">
      {/* Header with Room and Handle */}
      <div className="flex-none bg-white/10 backdrop-blur-md rounded-lg p-4 mb-4 flex justify-between items-center">
        <div>
          <h2 className="text-white font-semibold">#{currentRoom}</h2>
          <p className="text-gray-300 text-sm">You are: <span className="font-medium">{userHandle || 'connecting...'}</span></p>
          {familyFriendly && (
            <p className="text-green-400 text-xs mt-1">🛡️ Family-friendly mode ON</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-white text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={familyFriendly}
              onChange={(e) => setFamilyFriendly(e.target.checked)}
              className="rounded cursor-pointer"
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

      {/* Chat Messages - Scrollable area that takes remaining space */}
      <div
        ref={messagesRef}
        onScroll={handleScroll}
        className="flex-1 bg-white/10 backdrop-blur-md rounded-lg p-6 mb-4 overflow-y-auto min-h-0"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="max-w-2xl w-full">
              {/* Onboarding Panel */}
              {showOnboarding && (
                <div className="mb-8 bg-gradient-to-br from-blue-500/20 to-purple-500/20 backdrop-blur-md border-2 border-blue-400/30 rounded-2xl p-6 shadow-2xl relative">
                  <button
                    onClick={dismissOnboarding}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                    aria-label="Dismiss"
                  >
                    ✕
                  </button>
                  <h2 className="text-2xl font-bold text-white mb-4 flex items-center justify-center gap-2">
                    <span>👋</span>
                    <span>Welcome to Musicr!</span>
                  </h2>
                  <div className="space-y-3 text-left">
                    <div className="flex gap-3 items-start">
                      <span className="text-2xl">🎵</span>
                      <div>
                        <p className="text-white font-semibold">What it is</p>
                        <p className="text-gray-300 text-sm">A musical chat where every message gets matched to a song using AI semantic search</p>
                      </div>
                    </div>
                    <div className="flex gap-3 items-start">
                      <span className="text-2xl">💬</span>
                      <div>
                        <p className="text-white font-semibold">How to use</p>
                        <p className="text-gray-300 text-sm">Type like you're chatting normally - emotions, situations, moods - and watch songs appear!</p>
                      </div>
                    </div>
                    <div className="flex gap-3 items-start">
                      <span className="text-2xl">✨</span>
                      <div>
                        <p className="text-white font-semibold">Why it's cool</p>
                        <p className="text-gray-300 text-sm">Semantic AI matching finds songs by meaning, not keywords. No lyrics are stored or analyzed.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Main Welcome */}
              <div className="text-6xl mb-6">🎵</div>
              <h3 className="text-3xl font-bold text-white mb-4">Start Your Musical Journey</h3>
              <p className="text-gray-300 text-lg mb-8">
                Try one of these examples to get started:
              </p>

              {/* Example Prompts */}
              <div className="space-y-3 mb-8">
                {examplePrompts.map((prompt, index) => (
                  <button
                    key={index}
                    onClick={() => handleExampleClick(prompt)}
                    disabled={connectionStatus !== 'connected'}
                    className="w-full p-4 bg-white/10 hover:bg-white/20 disabled:bg-white/5 disabled:cursor-not-allowed backdrop-blur-sm border border-white/20 rounded-xl text-white transition-all hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl text-left group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">"{prompt}"</span>
                      <span className="text-blue-300 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Tips */}
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 text-sm text-gray-400">
                <p className="text-white font-semibold mb-2">💡 Keyboard Shortcuts</p>
                <div className="space-y-1 text-xs">
                  <p>• Press <kbd className="bg-white/10 px-2 py-1 rounded">↑</kbd> to edit your last message</p>
                  <p>• Press <kbd className="bg-white/10 px-2 py-1 rounded">Cmd+K</kbd> to see alternative song matches</p>
                  <p>• Click <span className="bg-blue-500/60 px-2 py-0.5 rounded-full">💡 why?</span> to understand why a song was matched</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => {
              const songDisplay = formatSongDisplay(message);
              const isModeration = message.isModeration;
              
              return (
                <div key={message.id} className="group">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      {/* Message content */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`font-semibold text-sm ${
                          isModeration ? 'text-orange-300' : 'text-blue-300'
                        }`}>
                          {message.anonHandle}
                        </span>
                        <span className="text-gray-500 text-xs">
                          {new Date(message.timestamp).toLocaleTimeString()}
                        </span>
                        {message.isOptimistic && (
                          <span className="text-yellow-400 text-xs animate-pulse">sending...</span>
                        )}
                        {isModeration && (
                          <span className="text-orange-400 text-xs font-medium bg-orange-500/20 px-2 py-0.5 rounded-full">
                            Filtered
                          </span>
                        )}
                      </div>

                      <div className={`rounded-xl p-4 text-white shadow-lg transition-all ${
                        isModeration
                          ? 'bg-orange-600/20 border-2 border-orange-500/40'
                          : 'bg-white/10 backdrop-blur-sm border border-white/10 hover:bg-white/15'
                      }`}>
                        <div className="flex items-center gap-2">
                          <span>{message.content}</span>
                          {songDisplay && (
                            <>
                              <span className="text-gray-300">→</span>
                              <span className="font-medium text-green-300">{songDisplay}</span>
                              {message.reasoning && (
                                <button
                                  onClick={() => setExpandedWhyPanel(
                                    expandedWhyPanel === message.id ? null : message.id
                                  )}
                                  className="text-xs bg-blue-500/60 hover:bg-blue-500 px-3 py-1.5 rounded-full text-white font-medium transition-all shadow-sm hover:shadow-md"
                                >
                                  {expandedWhyPanel === message.id ? '✕ hide' : '💡 why?'}
                                </button>
                              )}
                              {message.alternates && message.alternates.length > 0 && (
                                <button
                                  onClick={() => {
                                    setCurrentSelectedMessage(message.id);
                                    setCurrentAlternates(message.alternates || []);
                                    setShowQuickPalette(true);
                                  }}
                                  className="text-xs bg-purple-500/60 hover:bg-purple-500 px-3 py-1.5 rounded-full text-white font-medium transition-all shadow-sm hover:shadow-md opacity-0 group-hover:opacity-100"
                                >
                                  🎵 alternatives ({message.alternates.length})
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {/* Why Panel - Expandable Explanation */}
                      {expandedWhyPanel === message.id && message.reasoning && songDisplay && (
                        <div className="mt-3 p-4 bg-gradient-to-br from-blue-500/20 to-blue-600/10 border-2 border-blue-400/30 rounded-xl text-sm backdrop-blur-sm shadow-lg">
                          <h4 className="text-blue-200 font-bold mb-3 flex items-center gap-2">
                            <span>💡</span>
                            <span>Why this song?</span>
                          </h4>
                          <div className="space-y-2.5 text-gray-200">
                            <div className="bg-white/10 rounded-lg p-2">
                              <span className="text-blue-300 font-medium">Matched Song:</span>{' '}
                              <span className="text-white font-semibold">{songDisplay}</span>
                            </div>
                            <div className="bg-white/10 rounded-lg p-2">
                              <span className="text-blue-300 font-medium">Reasoning:</span>{' '}
                              <span className="text-white">{message.reasoning}</span>
                            </div>
                            {message.alternates && message.alternates.length > 0 && (
                              <div className="bg-white/10 rounded-lg p-2">
                                <span className="text-blue-300 font-medium">Confidence:</span>{' '}
                                <span className="text-white">
                                  {message.alternates.length > 0 ? 'Medium' : 'High'}
                                  {' '}({message.alternates.length} alternatives)
                                </span>
                              </div>
                            )}
                            <div className="text-xs text-blue-200/60 mt-3 italic border-t border-blue-400/20 pt-2">
                              ✨ Matched using semantic AI search (no lyrics analyzed)
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Message Input - Pinned at bottom */}
      <form onSubmit={handleSubmit} className="flex-none flex gap-3">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={connectionStatus === 'connected' ? "Type anything to find a song..." : "Connecting..."}
          className="flex-1 px-5 py-4 rounded-xl bg-white/10 backdrop-blur-md text-white placeholder-gray-400 border-2 border-white/20 focus:border-blue-400 focus:bg-white/15 focus:outline-none transition-all shadow-lg text-base"
          disabled={connectionStatus !== 'connected'}
        />
        <button
          type="submit"
          disabled={!inputValue.trim() || connectionStatus !== 'connected'}
          className="px-8 py-4 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-all shadow-lg hover:shadow-xl hover:scale-105 active:scale-95"
        >
          Send 🎵
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