import { useState, useRef, useEffect, useMemo } from 'react';
import { useChatStore, type Message } from '../stores/chatStore';

type ReplyMessage = Message & { parentAuthor?: string };
type ThreadGroup = { root: Message; replies: ReplyMessage[] };

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
  // Modal state: only one modal can be open at a time
  const [activeModal, setActiveModal] = useState<'onboarding' | 'info' | null>(null);
  const [historyLoadError, setHistoryLoadError] = useState(false);
  const [inlineReplyText, setInlineReplyText] = useState('');
  const [firstMatchId, setFirstMatchId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const lastLoadTimeRef = useRef<number>(0);
  const isLoadingRef = useRef<boolean>(false);
  const inlineReplyRef = useRef<HTMLInputElement>(null);

  const examplePrompts = [
    "I'm stressed and overloaded today.",
    "Tell me something that feels like a rainy night drive.",
    "I need a song that feels like nervous excitement.",
  ];
  const {
    messages,
    sendMessage,
    connectionStatus,
    userHandle,
    currentRoom,
    addReaction,
    removeReaction,
    loadOlderMessages,
    isLoadingHistory,
    hasMoreHistory,
    replyingTo,
    setReplyingTo,
    expandedThreads,
    toggleThread,
    debugInfo
  } = useChatStore();

  // Check if debug mode is enabled via ?debug=1 query parameter
  const [debugMode, setDebugMode] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDebugMode(params.get('debug') === '1');
  }, []);

  // Build YouTube-style thread groups: root + flat replies
  const threadGroups = useMemo<ThreadGroup[]>(() => {
    const msgMap = new Map<string, Message>();
    for (const msg of messages) {
      msgMap.set(msg.id, msg);
    }

    // Safeguard 5: cycle-safe root ancestor walk
    function findRootId(id: string): string {
      const visited = new Set<string>();
      let current = id;
      while (true) {
        if (visited.has(current)) return current;
        visited.add(current);
        const msg = msgMap.get(current);
        if (!msg || !msg.replyToMessageId || !msgMap.has(msg.replyToMessageId)) {
          return current;
        }
        current = msg.replyToMessageId;
      }
    }

    // Group messages by root ancestor
    const groupMap = new Map<string, ThreadGroup>();
    const rootOrder: string[] = [];

    for (const msg of messages) {
      const rootId = findRootId(msg.id);
      if (rootId === msg.id) {
        // This is a root message
        if (!groupMap.has(rootId)) {
          groupMap.set(rootId, { root: msg, replies: [] });
          rootOrder.push(rootId);
        }
      }
    }

    // Add all reply messages to their root's group
    for (const msg of messages) {
      const rootId = findRootId(msg.id);
      if (rootId !== msg.id) {
        const group = groupMap.get(rootId);
        if (group) {
          // Find the parent message's author for context line (only if parent != root)
          const parentMsg = msg.replyToMessageId ? msgMap.get(msg.replyToMessageId) : undefined;
          const parentAuthor = (parentMsg && parentMsg.id !== rootId) ? parentMsg.anonHandle : undefined;
          group.replies.push({ ...msg, parentAuthor });
        } else {
          // Orphan reply — treat as root
          groupMap.set(msg.id, { root: msg, replies: [] });
          rootOrder.push(msg.id);
        }
      }
    }

    // Safeguard 3: sort replies chronologically within each group
    for (const group of groupMap.values()) {
      if (group.replies.length > 1) {
        group.replies.sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      }
    }

    return rootOrder.map(id => groupMap.get(id)!);
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && connectionStatus === 'connected') {
      setLastMessage(inputValue.trim());
      sendMessage(inputValue.trim());
      setInputValue('');
    }
  };

  const handleExampleClick = (example: string) => {
    setInputValue(example);
    inputRef.current?.focus();
  };

  // Dismiss onboarding
  const handleOnboardingDismiss = () => {
    localStorage.setItem('musicr_onboarding_seen', '1');
    localStorage.setItem('musicr_onboarding_seen_at', new Date().toISOString());
    setActiveModal(null);
    // Focus chat input after closing
    setTimeout(() => inputRef.current?.focus(), 100);
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

  const getConfidenceLabel = (similarity?: number): { label: string; color: string; emoji: string } => {
    // Never return null or "Unknown" - always provide a numeric value
    const score = similarity ?? 0.001; // Default to very low if undefined

    if (score >= 0.7) return { label: 'Very Strong', color: 'text-green-400', emoji: '🎯' };
    if (score >= 0.5) return { label: 'Strong', color: 'text-green-300', emoji: '✨' };
    if (score >= 0.35) return { label: 'Moderate', color: 'text-yellow-300', emoji: '🎵' };
    if (score >= 0.2) return { label: 'Weak', color: 'text-orange-300', emoji: '🔍' };
    return { label: 'Very Weak', color: 'text-red-300', emoji: '⚠️' };
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl/Cmd+Enter sends from global composer
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (inputValue.trim() && connectionStatus === 'connected') {
        setLastMessage(inputValue.trim());
        sendMessage(inputValue.trim());
        setInputValue('');
      }
      return;
    }

    if (e.key === 'ArrowUp' && inputValue === '' && lastMessage) {
      e.preventDefault();
      setInputValue(lastMessage);
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setShowQuickPalette(true);
    }
  };

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }

    // Listen for show-info event from header "About Musicr" link
    const handleShowInfo = () => {
      setActiveModal('info');
    };
    window.addEventListener('show-info', handleShowInfo);

    return () => {
      window.removeEventListener('show-info', handleShowInfo);
    };
  }, []);

  // DEV-ONLY: iOS auto-zoom regression guard.
  // Warns if any input/textarea/select has computed font-size < 16px,
  // which triggers iOS Safari auto-zoom on focus.
  useEffect(() => {
    if (!(import.meta as any).env?.DEV) return;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    // Run check on all platforms in dev (iOS issues are invisible on desktop otherwise)
    const checkInputFontSizes = () => {
      const selectors = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select';
      document.querySelectorAll<HTMLElement>(selectors).forEach((el) => {
        const computed = parseFloat(getComputedStyle(el).fontSize);
        if (computed < 16) {
          console.warn(
            `[iOS-ZOOM-GUARD] Input has font-size ${computed}px (<16px) — will trigger auto-zoom on iOS.`,
            { element: el, selector: el.tagName + (el.className ? '.' + el.className.split(' ').join('.') : ''), isIOS }
          );
        }
      });
    };
    // Check after initial render and after modals open
    const timer = setTimeout(checkInputFontSizes, 500);
    // Re-check when modals change
    const observer = new MutationObserver(() => setTimeout(checkInputFontSizes, 100));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, []);

  // Show onboarding on first visit (after connection is ready)
  useEffect(() => {
    // Check if already seen
    const hasSeenOnboarding = localStorage.getItem('musicr_onboarding_seen') === '1';
    if (hasSeenOnboarding) return;

    // Check if ready: connection is established AND we have a username
    const isReady = connectionStatus === 'connected' && userHandle;

    // Only show if ready and no other modal is open
    if (isReady && activeModal === null) {
      setActiveModal('onboarding');
    }
  }, [connectionStatus, userHandle, activeModal]);

  // Centralized Escape key handler for all popups/modals
  // Priority order: emoji picker > why panel > alternatives menu > inline reply > modals
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close in priority order (most specific to least specific)
        if (emojiPickerOpen) {
          setEmojiPickerOpen(null);
        } else if (expandedWhyPanel) {
          setExpandedWhyPanel(null);
        } else if (showQuickPalette) {
          setShowQuickPalette(false);
          setCurrentSelectedMessage(null);
          setCurrentAlternates([]);
        } else if (replyingTo) {
          setReplyingTo(null);
        } else if (activeModal) {
          if (activeModal === 'onboarding') {
            handleOnboardingDismiss();
          } else if (activeModal === 'info') {
            setActiveModal(null);
          }
        }
      }
    };

    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [emojiPickerOpen, expandedWhyPanel, showQuickPalette, replyingTo, activeModal]);

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
        // Note: VITE_API_URL includes /api prefix, so don't add it again
        const apiBase = (import.meta as any).env?.VITE_API_URL || 'http://localhost:4000/api';
        const response = await fetch(`${apiBase}/admin/analytics`);
        const data = await response.json();
        setSongCount(data.songs || null);
      } catch (error) {
        console.error('Failed to fetch song count:', error);
      }
    }
    fetchSongCount();
  }, []);

  // Track first song match for "Meaning match" note (once per session)
  useEffect(() => {
    if (firstMatchId) return;
    for (const msg of messages) {
      if (msg.songTitle && msg.songArtist && !msg.isOptimistic) {
        setFirstMatchId(msg.id);
        return;
      }
    }
  }, [messages, firstMatchId]);

  // Safeguard 4: clear inline reply draft when replyingTo changes; scroll into view
  useEffect(() => {
    setInlineReplyText('');
    if (replyingTo) {
      setTimeout(() => {
        inlineReplyRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        inlineReplyRef.current?.focus();
      }, 100);
    }
  }, [replyingTo]);

  // Handle scroll detection to determine if user scrolled up
  const handleScroll = () => {
    if (messagesRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 50; // 50px threshold
      const isNearTop = scrollTop <= 150; // 150px threshold from top

      // Enable auto-scroll if user scrolled back to bottom
      if (isNearBottom && !autoScroll) {
        setAutoScroll(true);
      }
      // Disable auto-scroll if user scrolled up from bottom
      else if (!isNearBottom && autoScroll) {
        setAutoScroll(false);
      }

      // Infinite scroll: Load older messages when near top
      // Debounce: wait 500ms between loads
      const now = Date.now();
      const timeSinceLastLoad = now - lastLoadTimeRef.current;

      if (
        isNearTop &&
        hasMoreHistory &&
        !isLoadingHistory &&
        !isLoadingRef.current &&
        timeSinceLastLoad > 500
      ) {
        if (debugMode) {
          console.log('[INFINITE SCROLL] Triggered at scrollTop:', scrollTop);
        }
        lastLoadTimeRef.current = now;
        handleLoadOlder();
      }
    }
  };

  // Load older messages and preserve scroll position
  const handleLoadOlder = async () => {
    if (!messagesRef.current || isLoadingHistory || !hasMoreHistory || isLoadingRef.current) {
      return;
    }

    const scrollContainer = messagesRef.current;
    const oldScrollHeight = scrollContainer.scrollHeight;
    const oldScrollTop = scrollContainer.scrollTop;
    const oldestMessageId = messages.length > 0 ? messages[0].id : null;
    const oldMessageCount = messages.length;

    if (debugMode) {
      console.log('[LOAD OLDER] Starting:', {
        cursor: oldestMessageId,
        currentTotal: oldMessageCount,
        hasMore: hasMoreHistory,
        scrollTop: oldScrollTop,
        scrollHeight: oldScrollHeight
      });
    }

    isLoadingRef.current = true;
    setHistoryLoadError(false);

    try {
      await loadOlderMessages();

      // Preserve scroll position after new messages are prepended
      requestAnimationFrame(() => {
        if (scrollContainer) {
          const newScrollHeight = scrollContainer.scrollHeight;
          const heightDiff = newScrollHeight - oldScrollHeight;
          scrollContainer.scrollTop = oldScrollTop + heightDiff;

          if (debugMode) {
            const newMessageCount = messages.length;
            console.log('[LOAD OLDER] Complete:', {
              loaded: newMessageCount - oldMessageCount,
              newTotal: newMessageCount,
              hasMore: hasMoreHistory,
              heightDiff,
              newScrollTop: scrollContainer.scrollTop,
              scrollPreserved: Math.abs(scrollContainer.scrollTop - (oldScrollTop + heightDiff)) < 5
            });
          }
        }
      });
    } catch (error) {
      console.error('[LOAD OLDER] Error:', error);
      setHistoryLoadError(true);
    } finally {
      isLoadingRef.current = false;
    }
  };

  const formatSongDisplay = (message: Message) => {
    if (message.songTitle && message.songArtist) {
      return `${message.songTitle} — ${message.songArtist}${message.songYear ? ` (${message.songYear})` : ''}`;
    }
    return null;
  };

  // Song-title detection hint (only when input >= 10 chars)
  const looksLikeSongTitle = inputValue.length >= 10 && (
    inputValue.includes(' - ') || /\b\w+\s+by\s+\w+/i.test(inputValue)
  );

  // Detect code-like content (long unbroken tokens, shell commands, paths)
  const isCodeLike = (text: string): boolean => {
    const words = text.split(/\s+/);
    if (words.some(w => w.length > 60)) return true;
    if (text.length > 80 && /[|&]{2}|::|[\w.-]+\/[\w.-]+\//.test(text)) return true;
    return false;
  };

  // YouTube-style flat message renderer — no depth-based indent
  const renderMessageContent = (msg: Message | ReplyMessage, isReply: boolean, rootId: string): React.ReactNode => {
    const songDisplay = formatSongDisplay(msg);
    const emojiSizeClass = isReply ? 'text-lg w-6' : 'text-xl w-7';
    const nameClass = isReply
      ? 'font-medium text-xs text-gray-400'
      : 'font-medium text-sm text-gray-300';
    const bubbleClass = isReply
      ? 'rounded-md p-1.5 text-white bg-gray-800/40 border border-gray-700/30 max-w-full overflow-hidden'
      : 'rounded-lg p-2 text-white transition-all bg-gray-800/60 backdrop-blur-sm border border-gray-700/50 hover:border-gray-600/50 max-w-full overflow-hidden';
    const parentAuthor = 'parentAuthor' in msg ? (msg as ReplyMessage).parentAuthor : undefined;

    return (
      <div key={msg.id} className="group">
        {/* Context line for reply-to-reply (parent != root) */}
        {isReply && parentAuthor && (
          <div className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
            <span>↩</span>
            <span>replying to @{parentAuthor}</span>
          </div>
        )}
        <div className="flex items-start gap-2">
          <span className={`${emojiSizeClass} flex-shrink-0 mt-0.5 text-center`}>
            {getUserEmoji(msg.anonHandle)}
          </span>
          <div className="flex-1 min-w-0">
            {/* Username + timestamp */}
            <div className="flex items-center gap-2 mb-0.5">
              <span className={nameClass}>{msg.anonHandle}</span>
              <span className="text-gray-600 text-xs">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
              {msg.isOptimistic && (
                <span className="text-amber-500 text-xs animate-pulse">sending...</span>
              )}
            </div>

            {/* Message bubble */}
            <div className={bubbleClass}>
              {isCodeLike(msg.content) ? (
                <pre className="text-xs font-mono whitespace-pre-wrap max-w-full overflow-x-auto" style={{ overflowWrap: 'anywhere' }}>
                  {msg.content}
                </pre>
              ) : (
                <div className="text-sm break-words" style={{ overflowWrap: 'anywhere' }}>
                  {msg.content}
                </div>
              )}
              {songDisplay && (
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-gray-500">Musicr picked:</span>
                  <a
                    href={getYouTubeSearchUrl(msg.songTitle!, msg.songArtist!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-emerald-400/80 hover:text-emerald-300 underline decoration-emerald-500/30 hover:decoration-emerald-400/50 transition-colors"
                    title="Listen on YouTube"
                  >
                    {songDisplay}
                  </a>
                  {msg.reasoning && (
                    <button
                      onClick={() => setExpandedWhyPanel(
                        expandedWhyPanel === msg.id ? null : msg.id
                      )}
                      className="text-xs px-2 py-0.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-all opacity-60 hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 border border-gray-600/30 hover:border-gray-500/50"
                      aria-label={expandedWhyPanel === msg.id ? 'Hide match explanation' : 'Show why this song matched'}
                      title={expandedWhyPanel === msg.id ? 'Hide explanation' : 'Why this song?'}
                    >
                      {expandedWhyPanel === msg.id ? '✕' : 'why?'}
                    </button>
                  )}
                  {firstMatchId === msg.id && (
                    <span className="text-xs text-gray-500 italic">Meaning match · not exact search</span>
                  )}
                </div>
              )}
            </div>

            {/* Why Panel - Match Explanation */}
            {expandedWhyPanel === msg.id && msg.reasoning && songDisplay && (
              <div className="mt-2 p-3 bg-gray-800/70 border border-gray-700/60 rounded-lg backdrop-blur-sm">
                {/* Header row: confidence + close */}
                <div className="flex items-center justify-between gap-3 mb-2">
                  {(() => {
                    const confidence = getConfidenceLabel(msg.similarity);
                    const score = msg.similarity ?? 0.001;
                    return (
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold text-sm ${confidence.color}`}>
                          {confidence.emoji} {confidence.label}
                        </span>
                        <span
                          className="text-gray-500 text-xs tabular-nums"
                          title="Cosine similarity between your message and this song's metadata"
                        >
                          {(score * 100).toFixed(1)}%
                        </span>
                      </div>
                    );
                  })()}
                  <button
                    onClick={() => setExpandedWhyPanel(null)}
                    className="text-gray-500 hover:text-gray-300 transition-colors p-1 rounded hover:bg-gray-700/50 flex-shrink-0"
                    aria-label="Close explanation"
                  >
                    ✕
                  </button>
                </div>
                {/* Reasoning text */}
                <p className="text-xs text-gray-400 leading-relaxed">
                  {msg.reasoning}
                </p>
                {/* Song title reminder */}
                <p className="text-xs text-gray-600 mt-1.5 italic">
                  Matched to: {songDisplay}
                </p>
              </div>
            )}

            {/* Reactions + action icon buttons */}
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {msg.reactions && msg.reactions.length > 0 && msg.reactions.map((reaction) => (
                <button
                  key={reaction.emoji}
                  onClick={() => {
                    if (reaction.hasReacted) {
                      removeReaction(msg.id, reaction.emoji);
                    } else {
                      addReaction(msg.id, reaction.emoji);
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

              {msg.userId !== 'system' && (
                <>
                  <button
                    onClick={() => setEmojiPickerOpen(msg.id)}
                    aria-label="Add reaction"
                    title="Add reaction"
                    className="
                      flex items-center gap-1 px-2 py-1 rounded-full text-xs
                      bg-white/5 hover:bg-white/15 border border-white/10 hover:border-white/30
                      text-gray-400 hover:text-gray-200
                      transition-all duration-200
                      opacity-80 md:opacity-0 md:group-hover:opacity-100
                    "
                  >
                    <span>😊</span>
                    <span className="text-[10px]">+</span>
                  </button>
                  <button
                    onClick={() => {
                      setReplyingTo(msg.id);
                      if (!expandedThreads[rootId]) toggleThread(rootId);
                    }}
                    aria-label="Reply"
                    title="Reply to this message"
                    className="
                      flex items-center px-2 py-1 rounded-full text-xs
                      bg-white/5 hover:bg-white/15 border border-white/10 hover:border-white/30
                      text-gray-400 hover:text-gray-200
                      transition-all duration-200
                      opacity-80 md:opacity-0 md:group-hover:opacity-100
                    "
                  >
                    <span>↩</span>
                  </button>
                  {msg.alternates && msg.alternates.length > 0 && (
                    <button
                      onClick={() => {
                        setCurrentSelectedMessage(msg.id);
                        setCurrentAlternates(msg.alternates || []);
                        setShowQuickPalette(true);
                      }}
                      aria-label="Alternatives"
                      title="More matches like this"
                      className="
                        flex items-center px-2 py-1 rounded-full text-xs
                        bg-white/5 hover:bg-white/15 border border-white/10 hover:border-white/30
                        text-gray-400 hover:text-gray-200
                        transition-all duration-200
                        opacity-80 md:opacity-0 md:group-hover:opacity-100
                      "
                    >
                      <span>🎵</span>
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Inline reply composer */}
            {replyingTo === msg.id && (
              <div className="mt-1 flex gap-2">
                <input
                  ref={inlineReplyRef}
                  value={inlineReplyText}
                  onChange={(e) => setInlineReplyText(e.target.value)}
                  placeholder={`Replying to ${msg.anonHandle}...`}
                  autoFocus
                  className="flex-1 px-3 py-2 rounded-lg bg-gray-800/50 text-white placeholder-gray-500 text-base border border-gray-700 focus:border-gray-600 focus:outline-none transition-all"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      if (inlineReplyText.trim()) {
                        sendMessage(inlineReplyText.trim());
                        setInlineReplyText('');
                      }
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (inlineReplyText.trim()) {
                        sendMessage(inlineReplyText.trim());
                        setInlineReplyText('');
                      }
                    } else if (e.key === 'Escape') {
                      setReplyingTo(null);
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (inlineReplyText.trim()) {
                      sendMessage(inlineReplyText.trim());
                      setInlineReplyText('');
                    }
                  }}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm transition-colors flex-shrink-0"
                  aria-label="Send reply"
                  title="Send reply"
                >
                  ↩
                </button>
                <button
                  onClick={() => setReplyingTo(null)}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors flex-shrink-0"
                  aria-label="Cancel reply"
                  title="Cancel reply"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
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

      {/* Debug Panel - Only shown when ?debug=1 */}
      {debugMode && (
        <div className="flex-none bg-yellow-900/20 border-2 border-yellow-500/50 rounded-xl p-3 mb-3">
          <div className="text-yellow-300 font-bold text-sm mb-2 flex items-center gap-2">
            <span>🔍</span>
            <span>Split-Brain Debug Panel</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-800/50 rounded p-2">
              <div className="text-gray-400 mb-1">Connection Instance:</div>
              <div className="text-white font-mono break-all">
                {debugInfo.connectionInstanceId || 'Not connected'}
              </div>
            </div>
            <div className="bg-gray-800/50 rounded p-2">
              <div className="text-gray-400 mb-1">Last User Join Instance:</div>
              <div className="text-white font-mono break-all">
                {debugInfo.lastUserJoinedInstanceId || 'No events yet'}
              </div>
            </div>
            <div className="bg-gray-800/50 rounded p-2">
              <div className="text-gray-400 mb-1">Last User Leave Instance:</div>
              <div className="text-white font-mono break-all">
                {debugInfo.lastUserLeftInstanceId || 'No events yet'}
              </div>
            </div>
            <div className="bg-gray-800/50 rounded p-2">
              <div className="text-gray-400 mb-1">Last Reaction Instance:</div>
              <div className="text-white font-mono break-all">
                {debugInfo.lastReactionInstanceId || 'No events yet'}
              </div>
            </div>
          </div>
          <details className="mt-3">
            <summary className="text-yellow-300 cursor-pointer hover:text-yellow-200 text-xs">
              Event Log (Last {debugInfo.eventLog.length} events)
            </summary>
            <div className="mt-2 bg-gray-900/50 rounded p-2 max-h-40 overflow-y-auto">
              {debugInfo.eventLog.length > 0 ? (
                <div className="space-y-1">
                  {[...debugInfo.eventLog].reverse().map((event, idx) => (
                    <div key={idx} className="text-xs font-mono text-gray-300">
                      <span className="text-blue-400">{event.type}</span>
                      {' → '}
                      <span className="text-green-400">{event.instanceId || 'no-id'}</span>
                      {' @ '}
                      <span className="text-gray-500">{new Date(event.timestamp).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-500 text-xs">No events logged yet</div>
              )}
            </div>
          </details>
          <div className="mt-2 text-gray-400 text-xs italic">
            Open multiple tabs to test for split-brain. All instanceIds should match if using single backend.
          </div>
        </div>
      )}

      {/* Chat Messages - Scrollable area that takes remaining space */}
      <div
        ref={messagesRef}
        onScroll={handleScroll}
        className="flex-1 bg-gray-800/30 backdrop-blur-sm rounded-xl p-4 mb-3 overflow-y-auto overflow-x-hidden min-h-0 border border-gray-700/30"
      >
        {/* Load Older Messages Button - Only show on error as fallback */}
        {historyLoadError && hasMoreHistory && messages.length > 0 && (
          <div className="flex justify-center mb-4">
            <button
              onClick={handleLoadOlder}
              disabled={isLoadingHistory}
              className={`
                px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${isLoadingHistory
                  ? 'bg-gray-700/50 text-gray-400 cursor-not-allowed'
                  : 'bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 border border-orange-500/30'
                }
              `}
            >
              {isLoadingHistory ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></span>
                  Retrying...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <span>⚠️</span>
                  <span>Load failed - Click to retry</span>
                </span>
              )}
            </button>
          </div>
        )}

        {/* Auto-loading indicator */}
        {isLoadingHistory && !historyLoadError && hasMoreHistory && (
          <div className="flex justify-center mb-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-700/30 rounded-lg text-sm text-gray-400">
              <span className="inline-block w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></span>
              <span>Loading older messages...</span>
            </div>
          </div>
        )}

        {threadGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
            <div>
              <p className="text-gray-400 text-sm">Type a thought; Musicr replies with a song that matches the meaning.</p>
              <p className="text-gray-500 text-xs mt-1">Not an exact title search.</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {examplePrompts.map(p => (
                <button
                  key={p}
                  onClick={() => handleExampleClick(p)}
                  className="px-3 py-1.5 bg-gray-800/50 border border-gray-700/50 rounded-full text-sm text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {threadGroups.map((group) => (
              <div key={group.root.id}>
                {renderMessageContent(group.root, false, group.root.id)}
                {group.replies.length > 0 && (
                  <>
                    <button
                      onClick={() => toggleThread(group.root.id)}
                      className="text-xs text-gray-500 hover:text-gray-300 transition-colors mt-1 ml-9"
                    >
                      {expandedThreads[group.root.id]
                        ? 'Hide replies'
                        : `Show ${group.replies.length} ${group.replies.length === 1 ? 'reply' : 'replies'}`
                      }
                    </button>
                    {expandedThreads[group.root.id] && (
                      <div className="ml-4 pl-3 border-l-2 border-gray-700/50 mt-1 space-y-1.5">
                        {group.replies.map((reply) => renderMessageContent(reply, true, group.root.id))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Emoji Picker Modal - rendered outside scroll container so fixed positioning works
           (backdrop-filter on the scroll container creates a new containing block that
           breaks position:fixed for descendants) */}
      {emojiPickerOpen && (
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
                    addReaction(emojiPickerOpen, emoji);
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

      {/* Message Input - Pinned at bottom (de-emphasised while inline reply is open) */}
      <form
        onSubmit={handleSubmit}
        className={`flex-none flex gap-2 ${replyingTo ? 'opacity-40 pointer-events-none' : ''}`}
      >
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={connectionStatus === 'connected' ? "Say something (a thought, joke, mood, memory)..." : "Connecting..."}
          className="flex-1 px-4 py-3 rounded-lg bg-gray-800/50 text-white placeholder-gray-500 border border-gray-700 focus:border-gray-600 focus:bg-gray-800/70 focus:outline-none transition-all text-base"
          disabled={connectionStatus !== 'connected'}
        />
        <button
          type="submit"
          disabled={!inputValue.trim() || connectionStatus !== 'connected'}
          className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex-shrink-0"
          style={{ fontSize: '14px' }}
        >
          Send 🎵
        </button>
      </form>

      {/* Helper text below input */}
      <p className="text-center text-xs text-gray-600 mt-1">
        We match the meaning to a song, not exact titles.
      </p>

      {/* Song-title detection hint (only when input >= 10 chars) */}
      {looksLikeSongTitle && (
        <p className="text-xs text-gray-600 mt-0.5 text-center">
          Titles are treated as vibe prompts here, not exact lookups.
        </p>
      )}

      {/* Jump to reply box helper (visible when inline reply is active) */}
      {replyingTo && (
        <button
          onClick={() => inlineReplyRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
          className="text-xs text-blue-400 hover:text-blue-300 mt-1 text-center w-full transition-colors"
        >
          Jump to reply box
        </button>
      )}

      {/* Quick Palette for Alternatives */}
      {showQuickPalette && currentSelectedMessage && currentAlternates && (
        <QuickPalette
          messageId={currentSelectedMessage}
          alternates={currentAlternates}
          onSelect={(alternate) => {
            // Open YouTube in new tab instead of replacing the song
            const youtubeUrl = getYouTubeSearchUrl(alternate.title, alternate.artist);
            window.open(youtubeUrl, '_blank', 'noopener,noreferrer');
          }}
          onClose={() => {
            setShowQuickPalette(false);
            setCurrentSelectedMessage(null);
            setCurrentAlternates([]);
          }}
        />
      )}

      {/* First-Run Onboarding Modal */}
      {activeModal === 'onboarding' && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleOnboardingDismiss();
            }
          }}
        >
          <div className="max-w-md w-full bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 border border-blue-500/30 rounded-2xl p-6 shadow-2xl relative">
            {/* Close button */}
            <button
              onClick={handleOnboardingDismiss}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/10"
              aria-label="Close"
            >
              ✕
            </button>

            {/* Header */}
            <div className="mb-5">
              <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                <span>🎵</span>
                <span>Welcome to Musicr</span>
              </h2>
              <p className="text-blue-300 text-lg">
                Hello <span className="font-semibold">{userHandle}</span>!
              </p>
            </div>

            {/* Explainer cards */}
            <div className="space-y-3 mb-5">
              <div className="flex gap-3 items-start bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                <span className="text-2xl">💬</span>
                <div>
                  <p className="text-white font-semibold text-sm">This is a music chat</p>
                  <p className="text-gray-400 text-sm">Type like you're chatting normally — moods, thoughts, anything.</p>
                </div>
              </div>
              <div className="flex gap-3 items-start bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                <span className="text-2xl">🎵</span>
                <div>
                  <p className="text-white font-semibold text-sm">Every message gets a song</p>
                  <p className="text-gray-400 text-sm">AI matches your message to a song. Click the song name to listen on YouTube.</p>
                </div>
              </div>
              <div className="flex gap-3 items-start bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                <span className="text-2xl">✨</span>
                <div>
                  <p className="text-white font-semibold text-sm">Chat with others</p>
                  <p className="text-gray-400 text-sm">Everyone in the room sees messages and songs in real time. React with emoji!</p>
                </div>
              </div>
            </div>

            {/* CTA */}
            <button
              onClick={handleOnboardingDismiss}
              className="w-full px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors"
            >
              Got it!
            </button>
          </div>
        </div>
      )}

      {/* About Musicr Modal */}
      {activeModal === 'info' && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setActiveModal(null);
            }
          }}
        >
          <div className="max-w-lg w-full bg-gray-900/95 backdrop-blur-md border border-gray-700 rounded-xl p-6 shadow-2xl relative my-8">
            <button
              onClick={() => setActiveModal(null)}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/10"
              aria-label="Close"
            >
              ✕
            </button>
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <span>🎵</span>
              <span>About Musicr</span>
            </h2>
            <div className="space-y-3 text-gray-300 text-sm leading-relaxed">
              <p>
                Musicr turns messages into song picks. It doesn't keyword-match
                your text — it tries to match the meaning.
              </p>
              <p>
                Say what's on your mind, and you'll get a track that fits the
                vibe. Use it like a conversation: thoughts, jokes, stress,
                memories — anything.
              </p>
              <p>
                If you type a song title, Musicr may treat it as a vibe prompt,
                not a lookup.
              </p>
            </div>
            <button
              onClick={() => setActiveModal(null)}
              className="mt-6 w-full px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatInterface;
