import { useState } from 'react';

import {
  ChevronDown,
  ChevronRight,
  Wrench,
} from 'lucide-react';

import { renderMarkdown } from '@/utils';

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result?: string;
}

export interface RangerMsg {
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: ToolCall[];
  thinking?: string;
}

function ToolCallBlock({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;

  const argSummary = Object.entries(call.input)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([k, v]) => `${k}=${typeof v === 'string' && (v as string).length > 40 ? (v as string).slice(0, 40) + '...' : v}`)
    .join(', ');

  return (
    <div className="border border-border-light rounded text-[11px] my-1.5">
      <div
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-[#f5f5f5] transition-colors"
        onClick={() => setOpen(!open)}
      >
        <Wrench className="size-3 text-text-muted shrink-0" />
        <span className="font-mono text-accent-blue">{call.name}</span>
        <span className="text-text-muted truncate flex-1">{argSummary}</span>
        <Chevron className="size-3 text-text-muted shrink-0" />
      </div>
      {open && (
        <div className="border-t border-border-light">
          <pre className="px-2 py-1.5 text-[10px] text-text-secondary overflow-x-auto whitespace-pre-wrap wrap-break-word max-h-[200px] overflow-y-auto bg-[#fafaf8]">
            {call.result || '(no result)'}
          </pre>
        </div>
      )}
    </div>
  );
}

export function RangerMessage({ msg }: { msg: RangerMsg }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div className="bg-accent-blue text-white rounded-lg px-3 py-2 max-w-[85%] text-[12px] whitespace-pre-wrap">
          {msg.text}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <div className="mb-1.5">
          {msg.toolCalls.map((tc, i) => <ToolCallBlock key={i} call={tc} />)}
        </div>
      )}
      {msg.text && (
        <div
          className="prose prose-sm text-[12px] text-text-primary max-w-none [&_p]:my-1 [&_code]:bg-[#f0ede8] [&_code]:px-1 [&_code]:rounded [&_code]:text-[11px] [&_pre]:bg-[#f0ede8] [&_pre]:p-2 [&_pre]:rounded [&_pre]:text-[11px] [&_pre]:overflow-x-auto [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-[14px] [&_h2]:text-[13px] [&_h3]:text-[12px] [&_strong]:font-semibold"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
        />
      )}
    </div>
  );
}
