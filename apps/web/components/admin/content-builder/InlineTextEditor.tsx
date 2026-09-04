// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import { useEffect } from 'react';
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
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  Variable,
} from 'lucide-react';
import { UnderlineAsSpan } from '@/lib/content/builder/UnderlineAsSpan';
import { VARIABLE_GROUPS } from '@/lib/content/builder/variables';
import { MiniButton, MiniDropdown, MiniDropdownItem, DARK } from './ui';

// Only ever emits tags/attributes lib/content/sanitize-html.ts allows:
// p, strong, em, span (underline), ul/ol/li, a, h1-h6. No images/tables
// inline -- images are their own block type in the Canvas.
export function InlineTextEditor({
  value,
  onChange,
  autofocus,
}: {
  value: string;
  onChange: (html: string) => void;
  autofocus?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        horizontalRule: false,
        codeBlock: false,
        code: false,
        strike: false,
        heading: { levels: [1, 2, 3, 4, 5] },
      }),
      UnderlineAsSpan,
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
          '[&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-base [&_h3]:font-semibold ' +
          '[&_h4]:text-sm [&_h4]:font-semibold [&_h5]:text-sm [&_h5]:font-semibold ' +
          '[&_a]:underline [&_p]:my-1.5 [&_h1]:my-2 [&_h2]:my-2 [&_h3]:my-1.5',
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

  if (!editor) {
    return (
      <div className="min-h-[48px] p-2 text-xs" style={{ color: DARK.textMuted }}>
        Loading editor…
      </div>
    );
  }

  return (
    <div>
      <InlineToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function InlineToolbar({ editor }: { editor: Editor }) {
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

  return (
    <div
      className="mb-1 flex flex-wrap items-center gap-0.5 rounded-md p-1"
      style={{ background: '#0F1015', border: `1px solid ${DARK.inputBorder}` }}
      // Prevent a click inside the toolbar from bubbling up to the
      // block/column drag-and-drop handlers in Canvas.tsx.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Tiny active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
        <Heading1 className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
        <Heading2 className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
        <Heading3 className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()} title="Paragraph">
        <Pilcrow className="h-3.5 w-3.5" />
      </Tiny>
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
      <Tiny active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
        <List className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
        <ListOrdered className="h-3.5 w-3.5" />
      </Tiny>
      <Tiny active={editor.isActive('link')} onClick={toggleLink} title="Link">
        <LinkIcon className="h-3.5 w-3.5" />
      </Tiny>
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
