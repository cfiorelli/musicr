import { useChatStore } from '../stores/chatStore';

const RoomUserList = () => {
  const { roomUsers, userHandle } = useChatStore();

  return (
    <div className="bg-white/10 backdrop-blur-md rounded-lg p-4">
      <h3 className="text-white font-medium mb-3 flex items-center gap-2">
        <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
        Online ({roomUsers.length})
      </h3>
      
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {roomUsers.length === 0 ? (
          <p className="text-gray-400 text-sm">No other users online</p>
        ) : (
          roomUsers
            .sort((a, b) => {
              // Sort current user first, then by join time
              if (a.handle === userHandle) return -1;
              if (b.handle === userHandle) return 1;
              return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
            })
            .map((user) => {
              const isCurrentUser = user.handle === userHandle;
              const joinedTime = new Date(user.joinedAt);
              const now = new Date();
              const timeDiff = now.getTime() - joinedTime.getTime();
              const minutesAgo = Math.floor(timeDiff / 60000);
              
              const timeDisplay = minutesAgo === 0 
                ? 'just joined' 
                : minutesAgo < 60 
                  ? `${minutesAgo}m ago`
                  : `${Math.floor(minutesAgo / 60)}h ago`;

              return (
                <div
                  key={user.userId}
                  className={`flex items-center gap-3 p-2 rounded ${
                    isCurrentUser ? 'bg-blue-500/20 border border-blue-400/30' : 'bg-gray-700/30'
                  }`}
                >
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${
                        isCurrentUser ? 'text-blue-300' : 'text-white'
                      }`}>
                        {user.handle}
                      </span>
                      {isCurrentUser && (
                        <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded">
                          you
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{timeDisplay}</p>
                  </div>
                </div>
              );
            })
        )}
      </div>
    </div>
  );
};

export default RoomUserList;