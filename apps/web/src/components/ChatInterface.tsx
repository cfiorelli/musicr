import { useState, useRef, useEffect } from 'react';
import { useChatStore, type Message } from '../stores/chatStore';

const ChatInterface = () => {
  const [inputValue, setInputValue] = useState('');
  const [showQuickPalette, setShowQuickPalette] = useState(false);
  const [lastMessage, setLastMessage] = useState('');
  const [currentSelectedMessage, setCurrentSelectedMessage] = useState<string | null>(null);
  const [currentAlternates, setCurrentAlternates] = useState<Message['alternates']>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [songCount, setSongCount] = useState<number | null>(null);
  const [expandedWhyPanel, setExpandedWhyPanel] = useState<string | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState<string | null>(null);
  const [quickReactions] = useState(['❤️', '😂', '🎵', '🔥', '👍', '🎉']);
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
    selectAlternate,
    addReaction,
    removeReaction
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

  const resetOnboarding = () => {
    setShowOnboarding(true);
    localStorage.setItem('musicr-onboarding-dismissed', 'false');
  };

  const getYouTubeSearchUrl = (title: string, artist: string) => {
    const query = encodeURIComponent(`${artist} ${title}`);
    return `https://www.youtube.com/results?search_query=${query}`;
  };

  const getUserEmoji = (handle: string) => {
    // Generate consistent emoji from username with expanded pool (60 emojis)
    const emojis = [
      '🦊', '🐼', '🦁', '🐯', '🐸', '🐙', '🦋', '🐝', '🦄', '🐲',
      '🦖', '🐢', '🦉', '🦅', '🐺', '🐨', '🐻', '🐰', '🐹', '🦔',
      '🦇', '🦦', '🦫', '🦡', '🦨', '🦥', '🐿️', '🦘', '🦚', '🦩',
      '🦜', '🦢', '🦤', '🐊', '🦭', '🦈', '🐋', '🐬', '🐠', '🐡',
      '🦀', '🦞', '🦑', '🐌', '🦗', '🐞', '🐛', '🦟', '🕷️', '🕸️',
      '🐚', '🦎', '🐍', '🦴', '🎃', '🌻', '🌺', '🌸', '🌷', '🌹'
    ];
    // Use FNV-1a hash for better distribution
    let hash = 2166136261;
    for (let i = 0; i < handle.length; i++) {
      hash ^= handle.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return emojis[Math.abs(hash) % emojis.length];
  };

  const getConfidenceLabel = (similarity?: number): { label: string; color: string; emoji: string } | null => {
    if (similarity === undefined || similarity === null) {
      return { label: 'Unknown', color: 'text-gray-400', emoji: '❓' };
    }
    if (similarity >= 0.7) return { label: 'Very Strong', color: 'text-green-400', emoji: '🎯' };
    if (similarity >= 0.5) return { label: 'Strong', color: 'text-green-300', emoji: '✨' };
    if (similarity >= 0.35) return { label: 'Moderate', color: 'text-yellow-300', emoji: '🎵' };
    if (similarity >= 0.2) return { label: 'Weak', color: 'text-orange-300', emoji: '🔍' };
    return { label: 'Very Weak (Fallback)', color: 'text-red-300', emoji: '⚠️' };
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

    // Listen for show-onboarding event from header link
    const handleShowOnboarding = () => {
      resetOnboarding();
    };
    window.addEventListener('show-onboarding', handleShowOnboarding);

    return () => {
      window.removeEventListener('show-onboarding', handleShowOnboarding);
    };
  }, []);

  // Auto-scroll to bottom when new messages arrive (if auto-scroll is enabled)
  useEffect(() => {
    if (autoScroll && messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
      setUnreadCount(0); // Reset when auto-scrolling
    } else if (!autoScroll && messages.length > 0) {
      // Increment unread count when new message arrives while not at bottom
      setUnreadCount(prev => prev + 1);
    }
  }, [messages, autoScroll]);

  // Fetch song count on mount
  useEffect(() => {
    async function fetchSongCount() {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/admin/analytics`);
        const data = await response.json();
        setSongCount(data.songs || null);
      } catch (error) {
        console.error('Failed to fetch song count:', error);
      }
    }
    fetchSongCount();
  }, []);

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
      <div className="flex-none bg-gray-800/50 backdrop-blur-md rounded-xl p-3 mb-3 flex justify-between items-center border border-gray-700/50">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-white font-semibold text-base">#{currentRoom}</h2>
            <p className="text-gray-400 text-xs">{userHandle || 'connecting...'}</p>
          </div>
          {songCount !== null && (
            <div className="flex items-center gap-1.5 bg-gray-700/50 border border-gray-600/50 rounded-lg px-2.5 py-1">
              <span className="text-base">🎵</span>
              <span className="text-gray-300 text-xs font-medium">
                {songCount.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Chat Messages - Scrollable area that takes remaining space */}
      <div
        ref={messagesRef}
        onScroll={handleScroll}
        className="flex-1 bg-gray-800/30 backdrop-blur-sm rounded-xl p-4 mb-3 overflow-y-auto min-h-0 border border-gray-700/30"
      >
        <div className="space-y-3">
          {messages.map((message) => {
              const songDisplay = formatSongDisplay(message);
              const isModeration = message.isModeration;
              
              return (
                <div key={message.id} className="group">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      {/* Message content */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`font-medium text-sm ${
                          isModeration ? 'text-orange-400' : 'text-gray-300'
                        }`}>
                          {getUserEmoji(message.anonHandle)} {message.anonHandle}
                        </span>
                        <span className="text-gray-600 text-xs">
                          {new Date(message.timestamp).toLocaleTimeString()}
                        </span>
                        {message.isOptimistic && (
                          <span className="text-amber-500 text-xs animate-pulse">sending...</span>
                        )}
                        {isModeration && (
                          <span className="text-orange-400 text-xs font-medium bg-orange-500/20 px-2 py-0.5 rounded">
                            Filtered
                          </span>
                        )}
                      </div>

                      <div className={`rounded-lg p-3 text-white transition-all ${
                        isModeration
                          ? 'bg-orange-600/20 border border-orange-500/40'
                          : 'bg-gray-800/60 backdrop-blur-sm border border-gray-700/50 hover:border-gray-600/50'
                      }`}>
                        <div className="flex items-center gap-2 flex-wrap text-sm">
                          <span>{message.content}</span>
                          {songDisplay && (
                            <>
                              <span className="text-gray-500">→</span>
                              <a
                                href={getYouTubeSearchUrl(message.songTitle!, message.songArtist!)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-emerald-400 hover:text-emerald-300 underline decoration-emerald-500/30 hover:decoration-emerald-400/50 transition-colors"
                                title="Listen on YouTube"
                              >
                                {songDisplay}
                              </a>
                              {message.reasoning && (
                                <button
                                  onClick={() => setExpandedWhyPanel(
                                    expandedWhyPanel === message.id ? null : message.id
                                  )}
                                  className="text-xs bg-gray-700 hover:bg-gray-600 px-2.5 py-1 rounded-md text-gray-300 font-medium transition-colors"
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
                                  className="text-xs bg-gray-700 hover:bg-gray-600 px-2.5 py-1 rounded-md text-gray-300 font-medium transition-colors opacity-0 group-hover:opacity-100"
                                >
                                  🎵 alternatives ({message.alternates.length})
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {/* Why Panel - Compact Match Score */}
                      {expandedWhyPanel === message.id && message.reasoning && songDisplay && (
                        <div className="mt-2 p-2.5 bg-gray-800/60 border border-gray-700/50 rounded-lg text-sm backdrop-blur-sm">
                          <div className="flex items-center justify-between gap-3">
                            {/* Match Score */}
                            {(() => {
                              const confidence = getConfidenceLabel(message.similarity);
                              if (!confidence) return null;

                              return (
                                <div className="flex items-center gap-2 flex-1">
                                  <span className="text-gray-400 font-medium text-xs">
                                    Match:
                                  </span>
                                  <span className={`font-semibold text-sm ${confidence.color}`}>
                                    {confidence.emoji} {confidence.label}
                                  </span>
                                  {message.similarity !== undefined && (
                                    <span className="text-gray-500 text-xs">
                                      ({(message.similarity * 100).toFixed(1)}%)
                                    </span>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Close Button */}
                            <button
                              onClick={() => setExpandedWhyPanel(null)}
                              className="text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded hover:bg-gray-700/50"
                              aria-label="Close"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Emoji Reactions */}
                      {message.reactions && message.reactions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {message.reactions.map((reaction) => (
                            <button
                              key={reaction.emoji}
                              onClick={() => {
                                if (reaction.hasReacted) {
                                  removeReaction(message.id, reaction.emoji);
                                } else {
                                  addReaction(message.id, reaction.emoji);
                                }
                              }}
                              className={`
                                flex items-center gap-1 px-2 py-1 rounded-full text-sm
                                transition-all duration-200 hover:scale-110
                                ${reaction.hasReacted
                                  ? 'bg-blue-500/30 border-2 border-blue-400'
                                  : 'bg-white/10 border border-white/20 hover:bg-white/20'
                                }
                              `}
                              title={reaction.users.map(u => u.anonHandle).join(', ')}
                            >
                              <span>{reaction.emoji}</span>
                              <span className="text-xs font-semibold text-white">{reaction.count}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Quick Reactions Bar */}
                      <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {quickReactions.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => addReaction(message.id, emoji)}
                            className="w-8 h-8 flex items-center justify-center rounded-full
                                       bg-white/5 hover:bg-white/20 transition-all hover:scale-110"
                            title={`React with ${emoji}`}
                          >
                            {emoji}
                          </button>
                        ))}
                        <button
                          onClick={() => setEmojiPickerOpen(message.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-full
                                     bg-white/5 hover:bg-white/20 transition-all text-sm"
                          title="More reactions"
                        >
                          ➕
                        </button>
                      </div>

                      {/* Full Emoji Picker Modal */}
                      {emojiPickerOpen === message.id && (
                        <div
                          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
                          onClick={() => setEmojiPickerOpen(null)}
                        >
                          <div
                            className="bg-gray-800 rounded-xl p-4 max-w-md w-full mx-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex justify-between items-center mb-3">
                              <h3 className="text-white font-semibold">Choose a reaction</h3>
                              <button
                                onClick={() => setEmojiPickerOpen(null)}
                                className="text-gray-400 hover:text-white"
                              >
                                ✕
                              </button>
                            </div>
                            <div className="grid grid-cols-8 gap-2 max-h-64 overflow-y-auto">
                              {['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇',
                                '🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝',
                                '🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄',
                                '😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧',
                                '🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟',
                                '🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢',
                                '😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬',
                                '😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','😺',
                                '😸','😹','😻','😼','😽','🙀','😿','😾','❤️','🧡','💛','💚','💙',
                                '💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝',
                                '🎵','🎶','🎤','🎧','🎼','🎹','🥁','🎸','🎺','🎷','🎻','🎬','🎭',
                                '🎨','🎯','🎰','🎲','🎳','🎮','🎱','🏆','🥇','🥈','🥉','🏅','🎖️',
                                '🔥','⭐','✨','💫','💥','💢','💦','💨','🕳️','💬','💭','🗯️','💤',
                                '👍','👎','👊','✊','🤛','🤜','🤞','✌️','🤟','🤘','👌','🤌','🤏',
                                '👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤙','💪','🦾',
                                '🙏','✍️','💅','🤳','💃','🕺','🎉','🎊','🎈','🎁','🎀','🎂','🍰'
                              ].map((emoji) => (
                                <button
                                  key={emoji}
                                  onClick={() => {
                                    addReaction(message.id, emoji);
                                    setEmojiPickerOpen(null);
                                  }}
                                  className="text-2xl hover:scale-125 transition-transform p-2"
                                >
                                  {emoji}
                                </button>
                              ))}
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
      </div>

      {/* Jump to Bottom Button */}
      {!autoScroll && (
        <button
          onClick={() => {
            if (messagesRef.current) {
              messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
              setAutoScroll(true);
              setUnreadCount(0);
            }
          }}
          className="
            fixed bottom-24 right-4 md:right-8
            bg-blue-500 hover:bg-blue-600
            text-white rounded-full
            w-12 h-12 md:w-14 md:h-14
            flex items-center justify-center
            shadow-lg hover:shadow-xl
            transition-all duration-200
            z-20
            group
          "
          aria-label="Jump to bottom"
        >
          <div className="relative">
            <span className="text-xl md:text-2xl">↓</span>
            {unreadCount > 0 && (
              <span className="
                absolute -top-2 -right-2
                bg-red-500 text-white
                text-xs font-bold
                rounded-full
                w-5 h-5
                flex items-center justify-center
                animate-pulse
              ">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
          <span className="
            absolute bottom-full mb-2
            bg-gray-800 text-white
            px-2 py-1 rounded text-xs
            whitespace-nowrap
            opacity-0 group-hover:opacity-100
            transition-opacity
          ">
            {unreadCount > 0 ? `${unreadCount} new message${unreadCount > 1 ? 's' : ''}` : 'Jump to bottom'}
          </span>
        </button>
      )}

      {/* Message Input - Pinned at bottom */}
      <form onSubmit={handleSubmit} className="flex-none flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={connectionStatus === 'connected' ? "Type anything to find a song..." : "Connecting..."}
          className="flex-1 px-4 py-3 rounded-lg bg-gray-800/50 backdrop-blur-sm text-white placeholder-gray-500 border border-gray-700 focus:border-gray-600 focus:bg-gray-800/70 focus:outline-none transition-all text-sm"
          disabled={connectionStatus !== 'connected'}
        />
        <button
          type="submit"
          disabled={!inputValue.trim() || connectionStatus !== 'connected'}
          className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-sm"
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

      {/* Onboarding Modal - Shows over messages when toggled */}
      {showOnboarding && messages.length > 0 && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="max-w-2xl w-full bg-gray-900/95 backdrop-blur-md border border-gray-700 rounded-xl p-6 shadow-2xl relative my-8 max-h-[90vh] overflow-y-auto">
            <button
              onClick={dismissOnboarding}
              className="sticky top-0 right-0 ml-auto mb-3 w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-300 transition-colors rounded-lg bg-gray-800 hover:bg-gray-700 text-xl z-10"
              aria-label="Close welcome modal"
            >
              ✕
            </button>
            <h2 className="text-2xl font-bold text-white mb-5 flex items-center gap-2">
              <span>👋</span>
              <span>Welcome to Musicr</span>
            </h2>
            <div className="space-y-3 mb-5">
              <div className="flex gap-3 items-start bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                <span className="text-2xl">🎵</span>
                <div>
                  <p className="text-white font-semibold text-base">What it is</p>
                  <p className="text-gray-400 text-sm">A musical chat where every message gets matched to a song using AI semantic search</p>
                </div>
              </div>
              <div className="flex gap-3 items-start bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                <span className="text-2xl">💬</span>
                <div>
                  <p className="text-white font-semibold text-base">How to use</p>
                  <p className="text-gray-400 text-sm">Type like you're chatting normally - emotions, situations, moods - and watch songs appear!</p>
                </div>
              </div>
              <div className="flex gap-3 items-start bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                <span className="text-2xl">✨</span>
                <div>
                  <p className="text-white font-semibold text-base">Why it's cool</p>
                  <p className="text-gray-400 text-sm">Semantic AI matching finds songs by meaning, not keywords. No lyrics stored or analyzed.</p>
                </div>
              </div>
              <div className="flex gap-3 items-start bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                <span className="text-2xl">🎬</span>
                <div>
                  <p className="text-white font-semibold text-base">Listen to songs</p>
                  <p className="text-gray-400 text-sm">Click any song name to search and play it on YouTube!</p>
                </div>
              </div>
            </div>
            <div className="bg-gray-800/60 rounded-lg p-3 text-sm border border-gray-700/50">
              <p className="text-white font-semibold mb-3 flex items-center gap-2">
                <span className="text-xl">🔬</span>
                <span>How it works (technical)</span>
              </p>
              <div className="space-y-2 text-gray-200">
                <div className="flex gap-2">
                  <span className="text-blue-300 font-bold">1.</span>
                  <div>
                    <span className="font-semibold text-white">Embedding Generation:</span> Your message is converted into a 1536-dimensional vector by OpenAI's text-embedding model, capturing semantic meaning and context
                  </div>
                </div>
                <div className="flex gap-2">
                  <span className="text-blue-300 font-bold">2.</span>
                  <div>
                    <span className="font-semibold text-white">Similarity Search:</span> The system uses pgvector with HNSW indexing to find songs whose embeddings are closest to yours in high-dimensional space
                  </div>
                </div>
                <div className="flex gap-2">
                  <span className="text-blue-300 font-bold">3.</span>
                  <div>
                    <span className="font-semibold text-white">The Match:</span> Songs are ranked by cosine similarity score (0-1), where higher scores mean better semantic matches. Click "💡 why?" to see confidence scores!
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-white/10 rounded-xl p-4 text-sm">
              <p className="text-white font-semibold mb-3">💡 Keyboard Shortcuts</p>
              <div className="space-y-2 text-gray-200">
                <p>• Press <kbd className="bg-white/20 px-3 py-1 rounded font-mono">↑</kbd> to edit your last message</p>
                <p>• Press <kbd className="bg-white/20 px-3 py-1 rounded font-mono">Cmd+K</kbd> to see alternative song matches</p>
                <p>• Click <span className="bg-blue-500/60 px-3 py-1 rounded-full font-semibold">💡 why?</span> to understand matches</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatInterface;