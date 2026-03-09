import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CREATURES_DIR, OPENSEED_HOME } from '../shared/paths.js';
import type { CostTracker } from './costs.js';

const TOOL_RESULT_CAP = 8000;
const SPILL_DIR = path.join(OPENSEED_HOME, 'ranger-spill');

const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function sanitize(s: string): string {
  return s.replace(LONE_SURROGATE, '\uFFFD');
}

let bashSeq = 0;

async function executeBash(
  command: string,
  options: { cwd?: string; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }> {
  const { cwd = process.cwd(), timeout = 120_000 } = options;
  const id = `ranger_${process.pid}_${++bashSeq}`;
  const outPath = path.join(tmpdir(), `${id}.out`);
  const errPath = path.join(tmpdir(), `${id}.err`);
  const outFd = openSync(outPath, 'w');
  const errFd = openSync(errPath, 'w');

  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', command], {
      cwd,
      stdio: ['ignore', outFd, errFd],
      detached: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        DEBIAN_FRONTEND: 'noninteractive',
      },
    });
    closeSync(outFd);
    closeSync(errFd);
    proc.unref();

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try { process.kill(-proc.pid!, 'SIGKILL'); } catch {}
    }, timeout);

    proc.on('exit', (code) => {
      clearTimeout(timer);
      setTimeout(() => {
        let stdout = '', stderr = '';
        try { stdout = sanitize(readFileSync(outPath, 'utf-8').trim()); } catch {}
        try { stderr = sanitize(readFileSync(errPath, 'utf-8').trim()); } catch {}
        try { unlinkSync(outPath); } catch {}
        try { unlinkSync(errPath); } catch {}
        resolve({
          stdout, exitCode: code ?? 1,
          stderr: killed ? `${stderr}\n[killed: timeout after ${timeout}ms]`.trim() : stderr,
          timedOut: killed,
        });
      }, 200);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      try { unlinkSync(outPath); } catch {}
      try { unlinkSync(errPath); } catch {}
      resolve({ stdout: '', stderr: err.message, exitCode: 1 });
    });
  });
}

// --- Anthropic API types (same pattern as narrator) ---

type AnthropicTextBlock = { type: 'text'; text: string };
type AnthropicThinkingBlock = { type: 'thinking'; thinking: string };
type AnthropicToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
type AnthropicContentBlock = AnthropicTextBlock | AnthropicThinkingBlock | AnthropicToolUseBlock;

interface AnthropicMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

type AnthropicToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string };

type ConversationMessage =
  | { role: 'user'; content: string | AnthropicToolResultBlock[] }
  | { role: 'assistant'; content: AnthropicContentBlock[] };

const MAX_TOOL_ROUNDS = 15;
const MAX_MESSAGES = 40;
const MODEL = 'claude-sonnet-4-6';

// --- Tool definitions ---

const TOOLS = [
  {
    name: 'list_creatures',
    description: 'List all creatures with status, model, cycle count, and sleep state.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'bash',
    description: `Execute a bash command on the host. Working directory is ~/.openseed.

Creature files live under creatures/<name>/. Key paths:
- creatures/<name>/BIRTH.json, PURPOSE.md, src/mind.ts
- creatures/<name>/.self/observations.md, rules.md, briefing.md, strategy.md
- creatures/<name>/.self/dreams.jsonl, conversation.jsonl, creator-log.jsonl
- creatures/<name>/.sys/events.jsonl, iterations.jsonl, cycle-count, sleep.json

Use rg/grep to search, cat/head/tail/sed to read sections, wc/find/ls to explore.
Output over ${TOOL_RESULT_CAP} chars is truncated and spilled to a temp file you can read in a follow-up call.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The bash command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds. Default: 30000' },
      },
      required: ['command'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a creature file. Restricted to .self/ files and PURPOSE.md.',
    input_schema: {
      type: 'object' as const,
      properties: {
        creature: { type: 'string', description: 'Creature name' },
        path: { type: 'string', description: 'File path relative to creature dir (must be in .self/ or PURPOSE.md)' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['creature', 'path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'String replace in any creature file (including src/mind.ts). For surgical edits when you know the exact text to replace.',
    input_schema: {
      type: 'object' as const,
      properties: {
        creature: { type: 'string', description: 'Creature name' },
        path: { type: 'string', description: 'File path relative to creature dir' },
        old_string: { type: 'string', description: 'Exact string to find and replace (must be unique)' },
        new_string: { type: 'string', description: 'Replacement string' },
      },
      required: ['creature', 'path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'restart_creature',
    description: 'Restart a creature to apply code or config changes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        creature: { type: 'string', description: 'Creature name' },
      },
      required: ['creature'],
    },
  },
  {
    name: 'wake_creature',
    description: 'Force-wake a sleeping creature with an optional reason.',
    input_schema: {
      type: 'object' as const,
      properties: {
        creature: { type: 'string', description: 'Creature name' },
        reason: { type: 'string', description: 'Wake reason shown to the creature' },
      },
      required: ['creature'],
    },
  },
  {
    name: 'send_message',
    description: 'Send a creator message to a creature. Injected as a direct interrupt.',
    input_schema: {
      type: 'object' as const,
      properties: {
        creature: { type: 'string', description: 'Creature name' },
        message: { type: 'string', description: 'Message text' },
      },
      required: ['creature', 'message'],
    },
  },
];

// --- System prompt builder ---

interface CreatureInfo {
  name: string;
  status: string;
  model?: string;
  sleepReason?: string | null;
}

function buildSystemPrompt(creatures: CreatureInfo[], focusedCreature?: string): string {
  const creatureList = creatures.map(c => {
    const parts = [c.name, `(${c.status})`];
    if (c.model) parts.push(`model=${c.model}`);
    if (c.sleepReason) parts.push(`sleep: ${c.sleepReason}`);
    return `  - ${parts.join(' ')}`;
  }).join('\n');

  let focusSection = '';
  if (focusedCreature) {
    focusSection = `\nThe user is currently viewing **${focusedCreature}**. When they say "it", "this creature", "its rules", etc., they mean ${focusedCreature}.\n`;
  }

  return `You are the Game Ranger — an on-demand diagnostic and maintenance agent for OpenSeed creatures.

You help the operator inspect, diagnose, and surgically modify autonomous AI creatures. You have direct access to their files, logs, and controls via bash and structured tools.

## Creature Anatomy

Each creature lives in ~/.openseed/creatures/<name>/ with:
- **BIRTH.json**: Identity (name, model, genome, born date)
- **PURPOSE.md**: Mission/role description (injected into system prompt)
- **src/mind.ts**: Cognitive architecture — system prompt, tools, consolidation, sleep/wake
- **.self/**: Mutable state — observations.md (RED/YLW/GRN tagged), rules.md (ALWAYS/NEVER, max 15), briefing.md, strategy.md, dreams.jsonl, conversation.jsonl
- **.sys/**: System logs — events.jsonl (authoritative activity log), iterations.jsonl, cycle-count

## Current Creatures

${creatureList}
${focusSection}
## Your Approach

Use bash liberally. rg/grep to search, cat/head/tail/sed to read, wc/find/ls to explore. Don't guess — check.

For writes, use write_file (whole .self/ files, PURPOSE.md) or edit_file (surgical string replace in any file including src/mind.ts). After changes that affect behavior, offer to restart.`;
}

// --- Ranger session ---

export type ListCreaturesFn = () => Promise<CreatureInfo[]>;
export type RestartCreatureFn = (name: string) => Promise<boolean>;
export type WakeCreatureFn = (name: string, reason?: string) => Promise<boolean>;
export type MessageCreatureFn = (name: string, message: string) => Promise<boolean>;

export interface RangerDeps {
  listCreatures: ListCreaturesFn;
  restartCreature: RestartCreatureFn;
  wakeCreature: WakeCreatureFn;
  messageCreature: MessageCreatureFn;
  costs: CostTracker;
}

export class Ranger {
  private messages: ConversationMessage[] = [];
  private deps: RangerDeps;

  constructor(deps: RangerDeps) {
    this.deps = deps;
  }

  reset() {
    this.messages = [];
  }

  async chat(
    userMessage: string,
    context: { creature?: string },
    res: http.ServerResponse,
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.sseWrite(res, 'error', { text: 'No ANTHROPIC_API_KEY configured' });
      this.sseEnd(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    this.messages.push({ role: 'user', content: userMessage });
    this.trimMessages();

    const creatures = await this.deps.listCreatures();
    const systemPrompt = buildSystemPrompt(creatures, context.creature);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.callLLM(apiKey, systemPrompt);
      if (!response) {
        this.sseWrite(res, 'error', { text: 'LLM call failed' });
        break;
      }

      this.messages.push({ role: 'assistant', content: response.content });

      for (const block of response.content) {
        if (block.type === 'thinking') {
          this.sseWrite(res, 'thinking', { text: block.thinking });
        }
      }

      const toolBlocks = response.content.filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use');

      if (toolBlocks.length === 0) {
        const textBlocks = response.content.filter((b): b is AnthropicTextBlock => b.type === 'text');
        const text = textBlocks.map(b => b.text).join('\n').trim();
        this.sseWrite(res, 'text', { text });
        break;
      }

      const toolResults: AnthropicToolResultBlock[] = [];
      for (const tool of toolBlocks) {
        this.sseWrite(res, 'tool_call', { name: tool.name, input: tool.input });
        const result = await this.executeTool(tool.name, tool.input);
        toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: result.slice(0, TOOL_RESULT_CAP) });
        this.sseWrite(res, 'tool_result', { name: tool.name, result: result.slice(0, 2000) });
      }

      this.messages.push({ role: 'user', content: toolResults });
    }

    this.sseEnd(res);
  }

  private sseWrite(res: http.ServerResponse, type: string, data: Record<string, unknown>) {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    }
  }

  private sseEnd(res: http.ServerResponse) {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    }
  }

  private trimMessages() {
    if (this.messages.length > MAX_MESSAGES) {
      this.messages = this.messages.slice(-MAX_MESSAGES);
      if (this.messages[0]?.role === 'assistant') {
        this.messages.shift();
      }
    }
  }

  private async callLLM(apiKey: string, system: string): Promise<AnthropicMessage | null> {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 16000,
          system,
          tools: TOOLS,
          messages: this.messages,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`[ranger] LLM error ${res.status}: ${text.slice(0, 200)}`);
        return null;
      }

      const data = await res.json() as AnthropicMessage;
      if (data.usage) {
        this.deps.costs.record('_ranger', data.usage.input_tokens || 0, data.usage.output_tokens || 0, MODEL);
      }
      return data;
    } catch (err) {
      console.error('[ranger] LLM call failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  // --- Tool execution ---

  private async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    const str = (v: unknown) => (typeof v === 'string' ? v : String(v ?? ''));
    const num = (v: unknown, def: number) => (typeof v === 'number' ? v : def);

    try {
      switch (name) {
        case 'list_creatures': return await this.toolListCreatures();
        case 'bash': return await this.toolBash(str(input.command), num(input.timeout, 30_000));
        case 'write_file': return await this.toolWriteFile(str(input.creature), str(input.path), str(input.content));
        case 'edit_file': return await this.toolEditFile(str(input.creature), str(input.path), str(input.old_string), str(input.new_string));
        case 'restart_creature': return await this.toolRestart(str(input.creature));
        case 'wake_creature': return await this.toolWake(str(input.creature), str(input.reason));
        case 'send_message': return await this.toolSendMessage(str(input.creature), str(input.message));
        default: return `unknown tool: ${name}`;
      }
    } catch (err) {
      return `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private creatureDir(creature: string): string {
    const dir = path.join(CREATURES_DIR, creature);
    if (!creature || creature.includes('/') || creature.includes('..')) throw new Error('invalid creature name');
    return dir;
  }

  private async toolListCreatures(): Promise<string> {
    const creatures = await this.deps.listCreatures();
    const lines: string[] = [];
    for (const c of creatures) {
      const parts = [c.name, `status=${c.status}`];
      if (c.model) parts.push(`model=${c.model}`);
      if (c.sleepReason) parts.push(`sleep_reason="${c.sleepReason}"`);
      try {
        const cycleCount = await fs.readFile(path.join(CREATURES_DIR, c.name, '.sys/cycle-count'), 'utf-8');
        parts.push(`cycles=${cycleCount.trim()}`);
      } catch {}
      try {
        const birth = JSON.parse(await fs.readFile(path.join(CREATURES_DIR, c.name, 'BIRTH.json'), 'utf-8'));
        if (birth.born) parts.push(`born=${birth.born.slice(0, 10)}`);
      } catch {}
      lines.push(parts.join(' | '));
    }
    return lines.join('\n') || 'no creatures';
  }

  private async toolBash(command: string, timeout: number): Promise<string> {
    if (!command) return 'error: command is required';
    const result = await executeBash(command, { cwd: OPENSEED_HOME, timeout });
    const raw = result.exitCode === 0
      ? (result.stdout || '(no output)')
      : `Exit code ${result.exitCode}\n${result.stderr}\n${result.stdout}`.trim();

    if (raw.length <= TOOL_RESULT_CAP) return raw;

    let spillNote = `\n\n[TRUNCATED — showing ${TOOL_RESULT_CAP} of ${raw.length} chars]`;
    try {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(SPILL_DIR, { recursive: true });
      const spillPath = path.join(SPILL_DIR, `bash-${Date.now()}.txt`);
      writeFileSync(spillPath, raw);
      spillNote = `\n\n[TRUNCATED — showing ${TOOL_RESULT_CAP} of ${raw.length} chars. Full output: ${spillPath} — use cat/head/tail/grep to read it]`;
    } catch {}

    return raw.slice(0, TOOL_RESULT_CAP) + spillNote;
  }

  private async toolWriteFile(creature: string, filePath: string, content: string): Promise<string> {
    const dir = this.creatureDir(creature);
    const resolved = path.resolve(dir, filePath);
    if (!resolved.startsWith(dir)) return 'error: path escapes creature directory';

    const allowed = filePath.startsWith('.self/') || filePath === 'PURPOSE.md';
    if (!allowed) return `error: can only write to .self/ files or PURPOSE.md, not ${filePath}`;

    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf-8');
    return `wrote ${content.length} bytes to ${creature}/${filePath}`;
  }

  private async toolEditFile(creature: string, filePath: string, oldStr: string, newStr: string): Promise<string> {
    const dir = this.creatureDir(creature);
    const resolved = path.resolve(dir, filePath);
    if (!resolved.startsWith(dir)) return 'error: path escapes creature directory';

    try {
      const content = await fs.readFile(resolved, 'utf-8');
      if (!content.includes(oldStr)) return 'error: old_string not found in file';

      const count = content.split(oldStr).length - 1;
      if (count > 1) return `error: old_string found ${count} times, must be unique. Add more context.`;

      const updated = content.replace(oldStr, newStr);
      await fs.writeFile(resolved, updated, 'utf-8');
      return `edited ${creature}/${filePath} (replaced ${oldStr.length} chars with ${newStr.length} chars)`;
    } catch {
      return `error: could not read ${filePath}`;
    }
  }

  private async toolRestart(creature: string): Promise<string> {
    const ok = await this.deps.restartCreature(creature);
    return ok ? `restarted ${creature}` : `failed to restart ${creature}`;
  }

  private async toolWake(creature: string, reason: string): Promise<string> {
    const ok = await this.deps.wakeCreature(creature, reason || 'Ranger wake');
    return ok ? `woke ${creature}` : `failed to wake ${creature} (may not be sleeping)`;
  }

  private async toolSendMessage(creature: string, message: string): Promise<string> {
    const ok = await this.deps.messageCreature(creature, message);
    return ok ? `sent message to ${creature}` : `failed to send message to ${creature}`;
  }
}
