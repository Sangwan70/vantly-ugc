// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import { useEffect, useRef } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link as LinkIcon,
  Heading2,
  Heading3,
  Heading4,
  Pilcrow,
  Variable,
  Quote,
  Code,
  Terminal,
  ImagePlus,
  Type,
} from 'lucide-react';
import { UnderlineAsSpan } from '@/lib/content/builder/UnderlineAsSpan';
import { FontSizeExtension } from '@/lib/content/builder/FontSizeExtension';
import { ResizableImageExtension } from '@/lib/content/builder/ResizableImageExtension';
import { VARIABLE_GROUPS } from '@/lib/content/builder/variables';
import { MiniButton, MiniDropdown, MiniDropdownItem, DARK } from './ui';

const MAX_IMAGE_SIZE_MB = 8; // matches /api/admin/content/media's own cap
const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

const FONT_SIZES: { label: string; value: string }[] = [
  { label: 'Small', value: '12px' },
  { label: 'Normal', value: '' },
  { label: 'Medium', value: '18px' },
  { label: 'Large', value: '24px' },
  { label: 'X-Large', value: '32px' },
  { label: 'Huge', value: '40px' },
];

const IMAGE_WIDTHS = ['25%', '50%', '75%', '100%'];

async function uploadInlineImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api/admin/content/media', { method: 'POST', credentials: 'include', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Upload failed (${r.status})`);
  return j.url as string;
}

// Only ever emits tags/attributes lib/content/sanitize-html.ts allows:
// p, strong, em, span (underline/font-size), ul/ol/li, a, h2-h4,
// blockquote, code, pre, img. No H1 -- the page's own title fills that
// role -- and no tables.
export function InlineTextEditor({
  value,
  onChange,
  autofocus,
}: {
  value: string;
  onChange: (html: string) => void;
  autofocus?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        horizontalRule: false,
        strike: false,
        heading: { levels: [2, 3, 4] },
      }),
      UnderlineAsSpan,
      FontSizeExtension,
      ResizableImageExtension,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        // No @tailwindcss/typography plugin in this repo -- style nested
        // elements directly via Tailwind v4 arbitrary-descendant
        // selectors instead of the usual `prose` class.
        class:
          'min-h-[48px] p-2 text-sm leading-relaxed focus:outline-none ' +
          '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 ' +
          '[&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-base [&_h3]:font-semibold ' +
          '[&_h4]:text-sm [&_h4]:font-semibold ' +
          '[&_a]:underline [&_p]:my-1.5 [&_h2]:my-2 [&_h3]:my-1.5 [&_h4]:my-1.5 ' +
          '[&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:my-2 ' +
          '[&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] ' +
          '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-black/40 [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 ' +
          '[&_img]:my-2 [&_img]:rounded-md',
        style: `color:${DARK.text}`,
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    immediatelyRender: false,
    autofocus: autofocus ? 'end' : false,
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  async function onImageFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      window.alert(`Max upload size is ${MAX_IMAGE_SIZE_MB}MB.`);
      return;
    }
    try {
      const url = await uploadInlineImage(file);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  if (!editor) {
    return (
      <div className="min-h-[48px] p-2 text-xs" style={{ color: DARK.textMuted }}>
        Loading editor…
      </div>
    );
  }

  return (
    <div>
      <InlineToolbar editor={editor} onInsertImageClick={() => fileInputRef.current?.click()} />
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        onChange={onImageFileSelected}
        className="hidden"
      />
      <EditorContent editor={editor} />
    </div>
  );
}

function InlineToolbar({ editor, onInsertImageClick }: { editor: Editor; onInsertImageClick: () => void }) {
  function insertVariable(token: string) {
    editor.chain().focus().insertContent(token).run();
  }

  function toggleLink() {
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt('Link URL (https://...)');
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  }

  function setFontSize(value: string) {
    if (!value) {
      editor.chain().focus().setMark('textStyle', { fontSize: null }).run();
    } else {
      editor.chain().focus().setMark('textStyle', { fontSize: value }).run();
    }
  }

  function setImageWidth(width: string) {
    editor.chain().focus().updateAttributes('image', { width }).run();
  }

  const imageSelected = editor.isActive('image');

  return (
    <div
      className="mb-1 flex flex-wrap items-center gap-0.5 rounded-md p-1"
      style={{ background: '#0F1015', border: `1px solid ${DARK.inputBorder}` }}
      // Prevent a click inside the toolbar from bubbling up to the
      // block/column drag-and-drop handlers in Canvas.tsx.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Tiny active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
        <Heading2 className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
        <Heading3 className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('heading', { level: 4 })} onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} title="Heading 4">
        <Heading4 className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()} title="Paragraph">
        <Pilcrow className="h-3.5 w-3.5" />
      </Tiny>
      <Divider />
      <MiniDropdown
        trigger={
          <MiniButton size="xs" className="w-auto gap-1 px-1.5" title="Font size">
            <Type className="h-3 w-3" />
          </MiniButton>
        }
      >
        {(close) => (
          <>
            {FONT_SIZES.map((opt) => (
              <MiniDropdownItem
                key={opt.label}
                onSelect={() => {
                  setFontSize(opt.value);
                  close();
                }}
              >
                {opt.label}
              </MiniDropdownItem>
            ))}
          </>
        )}
      </MiniDropdown>
      <Divider />
      <Tiny active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
        <Bold className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
        <Italic className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
        <UnderlineIcon className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code">
        <Code className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code block">
        <Terminal className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">
        <Quote className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
        <List className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
        <ListOrdered className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('link')} onClick={toggleLink} title="Link">
        <LinkIcon className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={false} onClick={onInsertImageClick} title="Insert image">
        <ImagePlus className="h-3.5 w-3.5" />
      </Tiny>
      {imageSelected ? (
        <>
          <Divider />
          {IMAGE_WIDTHS.map((w) => (
            <MiniButton key={w} size="xs" className="w-auto px-1.5 text-[10px]" onClick={() => setImageWidth(w)}>
              {w}
            </MiniButton>
          ))}
        </>
      ) : null}
      <Divider />
      <MiniDropdown
        trigger={
          <MiniButton size="xs" className="w-auto gap-1 px-1.5">
            <Variable className="h-3 w-3" />
            <span className="text-[10px]">Variable</span>
          </MiniButton>
        }
      >
        {(close) => (
          <>
            {VARIABLE_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="px-2 py-1 text-[10px] font-medium uppercase" style={{ color: DARK.textMuted }}>
                  {group.label}
                </div>
                {group.items.map((item) => (
                  <MiniDropdownItem
                    key={item.token}
                    onSelect={() => {
                      insertVariable(item.token);
                      close();
                    }}
                  >
                    {item.label}
                    <span className="ml-auto pl-4 font-mono text-[10px]" style={{ color: DARK.textMuted }}>
                      {item.token}
                    </span>
                  </MiniDropdownItem>
                ))}
              </div>
            ))}
          </>
        )}
      </MiniDropdown>
    </div>
  );
}

function Divider() {
  return <div className="mx-0.5 h-4 w-px" style={{ background: DARK.inputBorder }} />;
}

function Tiny({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <MiniButton
      size="xs"
      active={active}
      title={title}
      // Toolbar buttons live outside the contenteditable editor DOM node,
      // so a click fires mousedown -> editor blur/selection-loss -> click
      // before onClick's chain().focus()...run() ever runs, applying the
      // command to nothing. Suppressing mousedown's default keeps
      // selection intact through the click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </MiniButton>
  );
}
