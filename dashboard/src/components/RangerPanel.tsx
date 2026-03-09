import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  Send,
  Trash2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useStore } from '@/state';

import type {
  RangerMsg,
  ToolCall,
} from './RangerMessage';
import { RangerMessage } from './RangerMessage';

export function RangerPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<RangerMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const selected = useStore(s => s.selected);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(scrollToBottom, [messages, loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: RangerMsg = { role: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ranger/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          context: { creature: selected || undefined },
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${err}` }]);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      let currentText = '';
      let currentToolCalls: ToolCall[] = [];
      let currentThinking = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'text') {
              currentText = event.text || '';
            } else if (event.type === 'thinking') {
              currentThinking += (event.text || '') + '\n';
            } else if (event.type === 'tool_call') {
              currentToolCalls.push({
                name: event.name,
                input: event.input || {},
              });
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, toolCalls: [...currentToolCalls] };
                } else {
                  updated.push({ role: 'assistant', text: '', toolCalls: [...currentToolCalls] });
                }
                return updated;
              });
            } else if (event.type === 'tool_result') {
              const tc = currentToolCalls.find(t => t.name === event.name && !t.result);
              if (tc) tc.result = event.result;
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, toolCalls: [...currentToolCalls] };
                }
                return updated;
              });
            } else if (event.type === 'done') {
              // Finalize
            } else if (event.type === 'error') {
              currentText = `Error: ${event.text}`;
            }
          } catch {}
        }
      }

      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            text: currentText,
            toolCalls: currentToolCalls.length > 0 ? currentToolCalls : last.toolCalls,
            thinking: currentThinking || undefined,
          };
        } else {
          updated.push({
            role: 'assistant',
            text: currentText,
            toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined,
            thinking: currentThinking || undefined,
          });
        }
        return updated;
      });
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', text: `Network error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const reset = async () => {
    await fetch('/api/ranger/chat', { method: 'DELETE' });
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="sticky top-0 h-screen w-[380px] border-l border-border-default bg-surface flex flex-col shrink-0 animate-[slide-in-right_0.15s_ease-out]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-default flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-text-primary">Ranger</span>
          {selected && (
            <span className="text-[11px] text-accent-blue bg-[#eff6ff] px-1.5 py-0.5 rounded">
              {selected}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="icon-xs"
            className="text-text-faint hover:text-text-secondary"
            onClick={reset}
            title="Clear conversation"
          >
            <Trash2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon-xs"
            className="text-text-faint hover:text-text-secondary"
            onClick={onClose}
            title="Close ranger"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="text-text-muted text-[11px] text-center mt-8">
            Ask about any creature. The ranger can read their files, search logs, and make changes.
            {selected && (
              <div className="mt-2 text-accent-blue">Currently focused on <strong>{selected}</strong></div>
            )}
          </div>
        )}
        {messages.map((m, i) => <RangerMessage key={i} msg={m} />)}
        {loading && (
          <div className="flex items-center gap-2 text-text-muted text-[11px]">
            <span className="animate-pulse">thinking...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border-default p-3 shrink-0">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            className="flex-1 bg-[#f5f5f5] border border-border-light text-text-primary px-3 py-2 rounded text-[12px] font-sans resize-none min-h-[36px] max-h-[120px] focus:outline-none focus:border-accent-blue transition-colors"
            placeholder="Ask the ranger..."
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 120) + 'px';
            }}
          />
          <Button
            variant="ghost" size="icon-xs"
            className="text-text-muted hover:text-accent-blue self-end mb-1"
            onClick={send}
            disabled={loading || !input.trim()}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
