'use client';

import { useRef, useState } from 'react';
import { renderMarkdown } from '@/lib/markdown';

/** Render a trusted-after-sanitization markdown string as formatted HTML. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={`space-y-1 leading-relaxed [&_a]:break-words ${className ?? ''}`}
      // renderMarkdown HTML-escapes input first and only emits a safe tag subset.
      dangerouslySetInnerHTML={{ __html: renderMarkdown(children) }}
    />
  );
}

type ToolButton = { label: string; title: string; run: (e: Editing) => void };

type Editing = {
  value: string;
  start: number;
  end: number;
  setValue: (v: string) => void;
  setSelection: (start: number, end: number) => void;
};

/** Wrap the selection with `before`/`after` (e.g. ** … **); if empty, drop the placeholder in. */
function surround(before: string, after: string, placeholder: string) {
  return (e: Editing) => {
    const sel = e.value.slice(e.start, e.end) || placeholder;
    const next = e.value.slice(0, e.start) + before + sel + after + e.value.slice(e.end);
    e.setValue(next);
    e.setSelection(e.start + before.length, e.start + before.length + sel.length);
  };
}

/** Prefix every line touched by the selection (headings, list items). */
function prefixLines(prefix: string | ((i: number) => string)) {
  return (e: Editing) => {
    const lineStart = e.value.lastIndexOf('\n', e.start - 1) + 1;
    const block = e.value.slice(lineStart, e.end) || e.value.slice(lineStart);
    const end = lineStart + block.length;
    const prefixed = block
      .split('\n')
      .map((ln, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + ln)
      .join('\n');
    const next = e.value.slice(0, lineStart) + prefixed + e.value.slice(end);
    e.setValue(next);
    e.setSelection(lineStart, lineStart + prefixed.length);
  };
}

const TOOLS: ToolButton[] = [
  { label: 'H', title: 'Heading', run: prefixLines('## ') },
  { label: 'B', title: 'Bold', run: surround('**', '**', 'bold text') },
  { label: 'I', title: 'Italic', run: surround('*', '*', 'italic text') },
  { label: '• List', title: 'Bullet list', run: prefixLines('- ') },
  { label: '1. List', title: 'Numbered list', run: prefixLines((i) => `${i + 1}. `) },
  { label: '🔗 Link', title: 'Link', run: surround('[', '](https://)', 'text') },
];

/**
 * A markdown text field with a formatting toolbar (bold/italic/heading/lists/link),
 * a Write/Preview toggle, and an Expand/Collapse button so the author can grow the
 * box while editing and shrink it when done. The textarea is also drag-resizable.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  minRows = 3,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number;
  required?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState(false);

  const apply = (tool: ToolButton) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    tool.run({
      value,
      start,
      end,
      setValue: onChange,
      setSelection: (s, e) => {
        // Re-focus + restore selection after React re-renders the controlled value.
        requestAnimationFrame(() => {
          if (!ref.current) return;
          ref.current.focus();
          ref.current.setSelectionRange(s, e);
        });
      },
    });
  };

  const btn =
    'rounded px-1.5 py-0.5 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-700';

  return (
    <div className="rounded-md border border-neutral-300 dark:border-neutral-700">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-neutral-200 bg-neutral-50 px-1 py-1 dark:border-neutral-700 dark:bg-neutral-800/60">
        {TOOLS.map((t) => (
          <button
            key={t.label}
            type="button"
            title={t.title}
            onMouseDown={(e) => e.preventDefault() /* keep textarea selection */}
            onClick={() => apply(t)}
            disabled={preview}
            className={`${btn} ${t.label === 'B' ? 'font-bold' : t.label === 'I' ? 'italic' : ''} disabled:opacity-40`}
          >
            {t.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-neutral-300 dark:bg-neutral-600" />
        <button type="button" onClick={() => setPreview((v) => !v)} className={btn}>
          {preview ? 'Write' : 'Preview'}
        </button>
        <button type="button" onClick={() => setExpanded((v) => !v)} className={`${btn} ml-auto`}>
          {expanded ? '▣ Shrink' : '⤢ Expand'}
        </button>
      </div>
      {preview ? (
        <div className="min-h-[5rem] px-2 py-1.5 text-sm text-neutral-700 dark:text-neutral-300">
          {value.trim() ? <Markdown>{value}</Markdown> : <span className="text-neutral-400">Nothing to preview.</span>}
        </div>
      ) : (
        <textarea
          ref={ref}
          className="w-full resize-y rounded-b-md bg-transparent px-2 py-1.5 text-sm outline-none dark:bg-neutral-900"
          style={{ height: expanded ? '22rem' : `${minRows * 1.6 + 0.75}rem` }}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
        />
      )}
    </div>
  );
}
