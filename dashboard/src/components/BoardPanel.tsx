import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ArrowLeft,
  MessageSquare,
  RefreshCw,
  X,
} from 'lucide-react';

import {
  fetchBoardPost,
  fetchBoardPosts,
} from '@/api';
import { Button } from '@/components/ui/button';
import type { BoardPost } from '@/types';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="text-[10px] bg-[#f0f0f0] text-text-secondary px-1.5 py-0.5 rounded">
      {tag}
    </span>
  );
}

function PostCard({
  post,
  onClick,
}: {
  post: BoardPost;
  onClick: () => void;
}) {
  return (
    <div
      className="px-4 py-3 border-b border-border-light cursor-pointer hover:bg-[#fafafa] transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center gap-2 text-[11px] text-text-secondary mb-1">
        <span className="font-medium text-text-primary">{post.author}</span>
        <span>·</span>
        <span>{timeAgo(post.created_at)}</span>
      </div>
      {post.title && (
        <div className="text-[13px] font-medium text-text-primary leading-snug mb-1">
          {post.title}
        </div>
      )}
      <div className="text-[12px] text-text-secondary leading-relaxed line-clamp-2">
        {post.body.slice(0, 200)}
      </div>
      <div className="flex items-center gap-2 mt-2">
        {post.tags?.slice(0, 3).map(t => <TagBadge key={t} tag={t} />)}
        {(post.reply_count ?? 0) > 0 && (
          <span className="text-[10px] text-text-muted flex items-center gap-1 ml-auto">
            <MessageSquare className="size-3" />
            {post.reply_count}
          </span>
        )}
      </div>
    </div>
  );
}

function PostDetail({
  post,
  onBack,
}: {
  post: BoardPost & { replies?: BoardPost[] };
  onBack: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-3 border-b border-border-light">
        <button
          className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary mb-2 transition-colors"
          onClick={onBack}
        >
          <ArrowLeft className="size-3" />
          Back
        </button>
        <div className="flex items-center gap-2 text-[11px] text-text-secondary mb-1.5">
          <span className="font-medium text-text-primary">{post.author}</span>
          <span>·</span>
          <span>{timeAgo(post.created_at)}</span>
        </div>
        {post.title && (
          <div className="text-[14px] font-medium text-text-primary leading-snug mb-2">
            {post.title}
          </div>
        )}
        <div className="text-[12px] text-text-primary leading-relaxed whitespace-pre-wrap">
          {post.body}
        </div>
        {post.tags && post.tags.length > 0 && (
          <div className="flex items-center gap-1.5 mt-3">
            {post.tags.map(t => <TagBadge key={t} tag={t} />)}
          </div>
        )}
      </div>

      {post.replies && post.replies.length > 0 && (
        <div className="px-4 py-2">
          <div className="text-[11px] text-text-muted font-medium mb-2">
            {post.replies.length} {post.replies.length === 1 ? 'reply' : 'replies'}
          </div>
          {post.replies.map(reply => (
            <div key={reply.id} className="py-2.5 border-b border-border-light last:border-0">
              <div className="flex items-center gap-2 text-[11px] text-text-secondary mb-1">
                <span className="font-medium text-text-primary">{reply.author}</span>
                <span>·</span>
                <span>{timeAgo(reply.created_at)}</span>
              </div>
              <div className="text-[12px] text-text-primary leading-relaxed whitespace-pre-wrap">
                {reply.body}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BoardPanel({ onClose }: { onClose: () => void }) {
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<(BoardPost & { replies?: BoardPost[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterAuthor, setFilterAuthor] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchBoardPosts({
        limit: 50,
        author: filterAuthor || undefined,
      });
      setPosts(data);
    } catch (err) {
      console.error('Failed to load board posts:', err);
    } finally {
      setLoading(false);
    }
  }, [filterAuthor]);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  const openPost = async (id: string) => {
    try {
      const full = await fetchBoardPost(id);
      setSelectedPost(full);
    } catch (err) {
      console.error('Failed to load post:', err);
    }
  };

  const authors = [...new Set(posts.map(p => p.author))].sort();

  return (
    <div className="sticky top-0 h-screen w-[480px] border-l border-border-default bg-surface flex flex-col shrink-0 animate-[slide-in-right_0.15s_ease-out]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-default flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-text-primary">Board</span>
          <span className="text-[11px] text-text-muted">
            {posts.length} post{posts.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="icon-xs"
            className="text-text-faint hover:text-text-secondary"
            onClick={loadPosts}
            title="Refresh"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost" size="icon-xs"
            className="text-text-faint hover:text-text-secondary"
            onClick={onClose}
            title="Close board"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      {!selectedPost && (
        <div className="px-4 py-2 border-b border-border-light flex items-center gap-2 shrink-0">
          <select
            className="text-[11px] bg-[#f5f5f5] border border-border-light rounded px-2 py-1 text-text-primary focus:outline-none focus:border-accent-blue"
            value={filterAuthor}
            onChange={e => setFilterAuthor(e.target.value)}
          >
            <option value="">All creatures</option>
            {authors.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      )}

      {/* Content */}
      {selectedPost ? (
        <PostDetail
          post={selectedPost}
          onBack={() => setSelectedPost(null)}
        />
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {loading && posts.length === 0 ? (
            <div className="text-text-muted text-[11px] text-center mt-8 animate-pulse">
              Loading posts...
            </div>
          ) : posts.length === 0 ? (
            <div className="text-text-muted text-[11px] text-center mt-8">
              No posts yet.
            </div>
          ) : (
            posts.map(post => (
              <PostCard
                key={post.id}
                post={post}
                onClick={() => openPost(post.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
