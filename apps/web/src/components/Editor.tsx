import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { TextAlign } from '@tiptap/extension-text-align';
import * as Y from 'yjs';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { SuggestionInsert, SuggestionDelete } from '../extensions/suggestion.js';
import { Alert } from '../extensions/alert.js';
import { MathBlock } from '../extensions/math.js';
import { MermaidBlock } from '../extensions/mermaid.js';
import { ProjectStatusBlock } from '../extensions/status-block.js';
import { FileAttachmentBlock } from '../extensions/attachment.js';
import { Collaboration } from '../extensions/collab.js';
import { TextSelection } from '@tiptap/pm/state';
import { AwarenessBar } from './AwarenessBar.js';
import { SuggestionActionMenu, type ActiveSuggestionInfo } from './SuggestionActionMenu.js';
import { SuggestionSidebar } from './SuggestionSidebar.js';
import { SlashMenu } from './editor/SlashMenu.js';
import { TemplatePickerDialog } from './editor/TemplatePickerDialog.js';
import { acceptSuggestion, rejectSuggestion } from '@enterprise-blogger/shared';
import { api } from '../lib/api.js';
import {
  Bold,
  Italic,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Table as TableIcon,
  Flag,
  GitGraph,
  Sigma,
  AlertCircle,
  Plus,
  Rows,
  Columns,
  Paperclip,
  Sparkles,
  Layers,
  FileText,
  ChevronUp,
  ChevronDown,
  Loader2,
  X,
  ShieldAlert,
  Trash2,
  RotateCcw,
  RotateCw,
} from 'lucide-react';

export interface CollaborativeEditorProps {
  ydoc: Y.Doc;
  provider?: HocuspocusProvider;
  user?: {
    name: string;
    color: string;
    role?: string;
  };
  onDocChange?: (json: any) => void;
  onEditorReady?: (editor: any) => void;
  hideSidebar?: boolean;
  postId?: string;
}

export const CollaborativeEditor: React.FC<CollaborativeEditorProps> = ({
  ydoc,
  provider,
  user,
  onDocChange,
  onEditorReady,
  hideSidebar = false,
  postId,
}) => {
  const fragment = ydoc.getXmlFragment('prosemirror');

  // Suggestion tracking state
  const [activeSuggestion, setActiveSuggestion] = useState<ActiveSuggestionInfo | null>(null);
  const [allSuggestions, setAllSuggestions] = useState<ActiveSuggestionInfo[]>([]);

  // Slash command menu state
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false);
  const [slashMenuPos, setSlashMenuPos] = useState({ top: 100, left: 100 });

  // Template picker dialog state
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);

  // View Mode: 'document' (flow) vs 'block' (discrete foldable cards)
  const [viewMode, setViewMode] = useState<'document' | 'block'>(() => {
    return (localStorage.getItem('glyphroom_view_mode') as 'document' | 'block') || 'document';
  });

  const handleToggleViewMode = (mode: 'document' | 'block') => {
    setViewMode(mode);
    try {
      localStorage.setItem('glyphroom_view_mode', mode);
    } catch {
      // ignore localstorage errors
    }
  };
  const [reorderConflictMessage, setReorderConflictMessage] = useState<string | null>(null);
  const [currentBlockInfo, setCurrentBlockInfo] = useState<{
    index: number;
    total: number;
    type: string;
  } | null>(null);

  // Layout refs for active cell positioning
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const [floatingCellPos, setFloatingCellPos] = useState<{ top: number; right: number } | null>(null);

  // Position the floating action pill on the active cell in Block View
  const updateFloatingCellPos = useCallback(
    (ed: any) => {
      if (!ed || !ed.state || viewMode !== 'block' || !editorWrapperRef.current) {
        setFloatingCellPos(null);
        return;
      }
      try {
        const { from } = ed.state.selection;
        const $from = ed.state.doc.resolve(from);
        const blockIndex = $from.index(0);
        const blockEl = ed.view?.dom?.children?.[blockIndex] as HTMLElement;
        if (blockEl && editorWrapperRef.current) {
          const wrapperRect = editorWrapperRef.current.getBoundingClientRect();
          const blockRect = blockEl.getBoundingClientRect();
          setFloatingCellPos({
            top: blockRect.top - wrapperRect.top + 8,
            right: wrapperRect.right - blockRect.right + 12,
          });
          return;
        }
      } catch {
        // fallback
      }
      setFloatingCellPos(null);
    },
    [viewMode]
  );

  // File & Image attachment upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Detect if cursor is currently within a suggestion mark
  const detectActiveSuggestion = useCallback((ed: any) => {
    if (!ed || !ed.state) return;
    const { from, to } = ed.state.selection;
    let found: ActiveSuggestionInfo | null = null;

    ed.state.doc.nodesBetween(from, to, (node: any, pos: number) => {
      if (!node.isText) return;
      const insertMark = node.marks.find((m: any) => m.type.name === 'suggestion_insert');
      const deleteMark = node.marks.find((m: any) => m.type.name === 'suggestion_delete');

      if (insertMark) {
        found = {
          type: 'insert',
          id: insertMark.attrs.id || String(pos),
          agentId: insertMark.attrs.agentId || 'AI Agent',
          tokenId: insertMark.attrs.tokenId,
          ownerUserId: insertMark.attrs.ownerUserId,
          timestamp: insertMark.attrs.timestamp,
          from: pos,
          to: pos + node.nodeSize,
          text: node.text || '',
        };
      } else if (deleteMark) {
        found = {
          type: 'delete',
          id: deleteMark.attrs.id || String(pos),
          agentId: deleteMark.attrs.agentId || 'AI Agent',
          tokenId: deleteMark.attrs.tokenId,
          ownerUserId: deleteMark.attrs.ownerUserId,
          timestamp: deleteMark.attrs.timestamp,
          from: pos,
          to: pos + node.nodeSize,
          text: node.text || '',
        };
      }
    });

    setActiveSuggestion(found);
  }, []);

  // Update current active block info on selection
  const updateCurrentBlockInfo = useCallback((ed: any) => {
    if (!ed || !ed.state) return;
    const { from } = ed.state.selection;
    const $from = ed.state.doc.resolve(from);
    const index = $from.index(0);
    const total = ed.state.doc.childCount;
    if (index >= 0 && index < total) {
      const child = ed.state.doc.child(index);
      let typeLabel = child.type.name;
      if (typeLabel === 'heading') {
        typeLabel = child.attrs.level === 1 ? 'H1 Block Title' : `H${child.attrs.level} Heading`;
      } else if (typeLabel === 'projectStatusBlock') {
        typeLabel = 'Status Pulse Block';
      } else if (typeLabel === 'mermaidBlock') {
        typeLabel = 'Mermaid Diagram';
      } else if (typeLabel === 'mathBlock') {
        typeLabel = 'KaTeX Math Formula';
      } else if (typeLabel === 'fileAttachmentBlock') {
        typeLabel = 'File Attachment';
      } else if (typeLabel === 'table') {
        typeLabel = 'Data Table Matrix';
      } else if (typeLabel === 'taskList') {
        typeLabel = 'Task Checklist';
      } else if (typeLabel === 'codeBlock') {
        typeLabel = 'Code Block';
      } else if (typeLabel === 'paragraph') {
        typeLabel = 'Prose Paragraph';
      } else if (typeLabel === 'alert') {
        typeLabel = 'Alert Callout';
      }
      setCurrentBlockInfo({ index: index + 1, total, type: typeLabel });
    }
  }, []);

  // Collect all suggestions across the entire document
  const scanSuggestions = useCallback((ed: any) => {
    if (!ed || !ed.state) return;
    const list: ActiveSuggestionInfo[] = [];

    ed.state.doc.descendants((node: any, pos: number) => {
      if (!node.isText) return;
      const insertMark = node.marks.find((m: any) => m.type.name === 'suggestion_insert');
      const deleteMark = node.marks.find((m: any) => m.type.name === 'suggestion_delete');

      if (insertMark) {
        list.push({
          type: 'insert',
          id: insertMark.attrs.id || String(pos),
          agentId: insertMark.attrs.agentId || 'AI Agent',
          tokenId: insertMark.attrs.tokenId,
          ownerUserId: insertMark.attrs.ownerUserId,
          timestamp: insertMark.attrs.timestamp,
          from: pos,
          to: pos + node.nodeSize,
          text: node.text || '',
        });
      } else if (deleteMark) {
        list.push({
          type: 'delete',
          id: deleteMark.attrs.id || String(pos),
          agentId: deleteMark.attrs.agentId || 'AI Agent',
          tokenId: deleteMark.attrs.tokenId,
          ownerUserId: deleteMark.attrs.ownerUserId,
          timestamp: deleteMark.attrs.timestamp,
          from: pos,
          to: pos + node.nodeSize,
          text: node.text || '',
        });
      }
    });

    setAllSuggestions(list);
  }, []);

  // Upload file or image attachment
  const uploadAttachment = useCallback(
    async (file: File) => {
      if (!postId) {
        setUploadError('Save draft first to upload attachments.');
        return;
      }
      // 25 MB enterprise limit validation
      if (file.size > 25 * 1024 * 1024) {
        setUploadError('File exceeds 25 MB enterprise limit.');
        return;
      }

      setIsUploading(true);
      setUploadError(null);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await api.post<{
          attachmentId: string;
          fileName: string;
          fileSize: number;
          mimeType: string;
          scanStatus: 'scanning' | 'clean' | 'blocked';
          url: string;
        }>(`/posts/${postId}/attachments`, formData);

        if (editor && res) {
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'fileAttachmentBlock',
              attrs: {
                attachmentId: res.attachmentId,
                fileName: res.fileName,
                fileSize: res.fileSize,
                mimeType: res.mimeType,
                url: res.url,
                scanStatus: res.scanStatus || 'clean',
              },
            })
            .run();
        }
      } catch (err: any) {
        setUploadError(err?.message || 'Failed to upload attachment.');
      } finally {
        setIsUploading(false);
      }
    },
    [postId]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable ProseMirror default history/undo-redo plugin to allow Yjs UndoManager isolation
        undoRedo: false,
      }),
      // Image extension strictly disallowing base64 payloads
      Image.configure({
        allowBase64: false,
      }),
      FileAttachmentBlock,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      MathBlock,
      MermaidBlock,
      ProjectStatusBlock,
      SuggestionInsert,
      SuggestionDelete,
      Alert,
      Collaboration.configure({
        fragment,
        provider,
        user,
      }),
    ],
    editorProps: {
      attributes: {
        class: `enterprise-editor-content w-full focus:outline-none ${
          viewMode === 'block' ? 'enterprise-block-mode' : ''
        }`,
      },
      handleKeyDown: (view, event) => {
        // Shift+Enter: In Notebook mode, split or insert a new card below
        if (event.key === 'Enter' && event.shiftKey) {
          event.preventDefault();
          const { state, dispatch } = view;
          const { from } = state.selection;
          const $from = state.doc.resolve(from);
          const blockIndex = $from.index(0);
          let pos = 0;
          for (let i = 0; i <= blockIndex; i++) {
            pos += state.doc.child(i).nodeSize;
          }
          const pNode = state.schema.nodes.paragraph.create();
          const tr = state.tr.insert(pos, pNode);
          dispatch(tr);
          view.focus();
          return true;
        }

        // Trigger slash menu when user presses '/' on an empty block
        if (event.key === '/') {
          const { $from } = view.state.selection;
          const isAtBlockStart = $from.parentOffset === 0;
          if (isAtBlockStart) {
            const coords = view.coordsAtPos($from.pos);
            setSlashMenuPos({ top: coords.bottom + 8, left: coords.left });
            setIsSlashMenuOpen(true);
          }
        }
        return false;
      },
      handleDrop: (view, event, slice, moved) => {
        if (!moved && event.dataTransfer?.files?.length && postId) {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          uploadAttachment(file);
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        // 1. Intercept file / image paste from clipboard
        if (event.clipboardData?.files?.length && postId) {
          event.preventDefault();
          const file = event.clipboardData.files[0];
          uploadAttachment(file);
          return true;
        }
        // 2. Excel/CSV paste hygiene: prevent freezing by capping paste at 500 rows
        const text = event.clipboardData?.getData('text/plain');
        if (text && (text.includes('\t') || text.includes(','))) {
          const lines = text.split('\n');
          if (lines.length > 500) {
            const capped = lines.slice(0, 500).join('\n');
            view.dispatch(view.state.tr.insertText(capped));
            return true;
          }
        }
        // 3. Multi-line containment in Block View:
        // Prevent multi-paragraph paste from shattering into multiple separate cards
        if (viewMode === 'block' && text && text.includes('\n')) {
          event.preventDefault();
          const { state, dispatch } = view;
          const { from, to } = state.selection;
          const $from = state.doc.resolve(from);
          const parentType = $from.parent.type.name;
          if (parentType === 'paragraph' || parentType === 'heading') {
            const tr = state.tr;
            const lines = text.split('\n');
            const nodes: any[] = [];
            lines.forEach((line, idx) => {
              if (idx > 0) {
                const hardBreakNode = state.schema.nodes.hardBreak?.create();
                if (hardBreakNode) {
                  nodes.push(hardBreakNode);
                } else {
                  nodes.push(state.schema.text(' '));
                }
              }
              if (line.length > 0) {
                nodes.push(state.schema.text(line));
              }
            });
            if (nodes.length > 0) {
              tr.replaceWith(from, to, nodes);
            } else {
              tr.delete(from, to);
            }
            tr.setMeta('addToHistory', true);
            dispatch(tr);
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      onDocChange?.(editor.getJSON());
      scanSuggestions(editor);
      updateCurrentBlockInfo(editor);
      updateFloatingCellPos(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      detectActiveSuggestion(editor);
      updateCurrentBlockInfo(editor);
      updateFloatingCellPos(editor);
    },
  });

  useEffect(() => {
    if (editor) {
      onEditorReady?.(editor);
      scanSuggestions(editor);
      updateCurrentBlockInfo(editor);
      updateFloatingCellPos(editor);
    }
  }, [editor, onEditorReady, scanSuggestions, updateCurrentBlockInfo, updateFloatingCellPos]);

  useEffect(() => {
    if (editor && viewMode === 'block') {
      updateFloatingCellPos(editor);
    }
  }, [viewMode, editor, updateFloatingCellPos]);

  useEffect(() => {
    const handleScrollOrResize = () => {
      if (editor && viewMode === 'block') {
        updateFloatingCellPos(editor);
      }
    };
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScrollOrResize, { passive: true });
    }
    window.addEventListener('resize', handleScrollOrResize, { passive: true });
    return () => {
      if (container) container.removeEventListener('scroll', handleScrollOrResize);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [editor, viewMode, updateFloatingCellPos]);

  // Open Slash Menu manually via toolbar button
  const handleOpenSlashMenu = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSlashMenuPos({ top: rect.bottom + 8, left: rect.left });
    setIsSlashMenuOpen(true);
  };

  // Safe Block Reordering with Collaborator Awareness Guard
  const handleMoveBlock = (direction: 'up' | 'down') => {
    if (!editor) return;
    setReorderConflictMessage(null);
    const { from } = editor.state.selection;
    const $from = editor.state.doc.resolve(from);
    const blockIndex = $from.index(0);
    const totalChildren = editor.state.doc.childCount;

    if (direction === 'up' && blockIndex === 0) return;
    if (direction === 'down' && blockIndex >= totalChildren - 1) return;

    const targetIndex = direction === 'up' ? blockIndex - 1 : blockIndex + 1;

    // Calculate start & end bounds of current block and target block
    let pos = 0;
    let currentStart = 0;
    let currentEnd = 0;
    let targetStart = 0;
    let targetEnd = 0;

    for (let i = 0; i < totalChildren; i++) {
      const size = editor.state.doc.child(i).nodeSize;
      if (i === blockIndex) {
        currentStart = pos;
        currentEnd = pos + size;
      }
      if (i === targetIndex) {
        targetStart = pos;
        targetEnd = pos + size;
      }
      pos += size;
    }

    const minBound = Math.min(currentStart, targetStart);
    const maxBound = Math.max(currentEnd, targetEnd);

    // Collaborator Awareness Guard: check if any connected peer is actively inside the move range
    if (provider?.awareness) {
      const states = provider.awareness.getStates();
      const myClientId = provider.awareness.clientID;
      for (const [clientId, state] of states.entries()) {
        if (clientId === myClientId) continue;
        const peerUser = (state as any)?.user;
        const peerCursor = (state as any)?.cursor || peerUser?.cursor;
        if (peerCursor && typeof peerCursor.anchor === 'number') {
          const anchor = peerCursor.anchor;
          if (anchor >= minBound && anchor <= maxBound) {
            setReorderConflictMessage(
              `Cannot reorder: Collaborator "${peerUser?.name || 'Peer'}" is actively editing inside this section.`
            );
            setTimeout(() => setReorderConflictMessage(null), 4000);
            return;
          }
        }
      }
    }

    // Execute atomic ProseMirror transaction
    const currentNode = editor.state.doc.child(blockIndex);
    let tr = editor.state.tr;

    if (direction === 'up') {
      const prevNode = editor.state.doc.child(blockIndex - 1);
      const prevSize = prevNode.nodeSize;
      const prevStart = currentStart - prevSize;
      tr = tr.delete(currentStart, currentEnd);
      tr = tr.insert(prevStart, currentNode);
      editor.view.dispatch(tr);
      editor.commands.focus(prevStart + 1);
    } else {
      const nextNode = editor.state.doc.child(blockIndex + 1);
      const nextSize = nextNode.nodeSize;
      tr = tr.delete(currentStart, currentEnd);
      tr = tr.insert(currentStart + nextSize, currentNode);
      editor.view.dispatch(tr);
      editor.commands.focus(currentStart + nextSize + 1);
    }

    updateCurrentBlockInfo(editor);
  };

  // Split / Insert New Card Below (Notebook Cell)
  const handleInsertCardBelow = useCallback(
    (
      type:
        | 'paragraph'
        | 'codeBlock'
        | 'table'
        | 'mermaidBlock'
        | 'mathBlock'
        | 'projectStatusBlock'
        | 'taskList'
        | 'heading'
    ) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      const $from = editor.state.doc.resolve(from);
      const blockIndex = $from.index(0);
      const totalChildren = editor.state.doc.childCount;

      let pos = 0;
      for (let i = 0; i <= blockIndex && i < totalChildren; i++) {
        pos += editor.state.doc.child(i).nodeSize;
      }

      if (type === 'paragraph') {
        editor.chain().insertContentAt(pos, { type: 'paragraph' }).focus(pos + 1).run();
      } else if (type === 'codeBlock') {
        editor
          .chain()
          .insertContentAt(pos, { type: 'codeBlock', attrs: { language: 'typescript' } })
          .focus(pos + 1)
          .run();
      } else if (type === 'heading') {
        editor
          .chain()
          .insertContentAt(pos, {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'New Block Title' }],
          })
          .focus(pos + 1)
          .run();
      } else if (type === 'table') {
        editor
          .chain()
          .insertContentAt(pos, {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col 1' }] }] },
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col 2' }] }] },
                ],
              },
              {
                type: 'tableRow',
                content: [
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Data 1' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Data 2' }] }] },
                ],
              },
            ],
          })
          .focus(pos + 1)
          .run();
      } else if (type === 'mermaidBlock') {
        editor
          .chain()
          .insertContentAt(pos, {
            type: 'mermaidBlock',
            attrs: { code: 'graph TD\n  A[Start] --> B[Process]\n  B --> C[End]' },
          })
          .focus(pos + 1)
          .run();
      } else if (type === 'mathBlock') {
        editor
          .chain()
          .insertContentAt(pos, {
            type: 'mathBlock',
            attrs: { formula: 'E = mc^2' },
          })
          .focus(pos + 1)
          .run();
      } else if (type === 'projectStatusBlock') {
        editor
          .chain()
          .insertContentAt(pos, {
            type: 'projectStatusBlock',
            attrs: {
              ragStatus: 'green',
              milestoneTitle: 'Sprint Milestone',
              completionPercent: 50,
              targetDate: new Date().toISOString().split('T')[0],
              blockers: 'None',
            },
          })
          .focus(pos + 1)
          .run();
      } else if (type === 'taskList') {
        editor
          .chain()
          .insertContentAt(pos, {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New deliverable' }] }],
              },
            ],
          })
          .focus(pos + 1)
          .run();
      }

      updateCurrentBlockInfo(editor);
    },
    [editor, updateCurrentBlockInfo]
  );

  // Delete cell at specific index or active cell
  const handleDeleteCardAtIndex = useCallback(
    (indexToDelete?: number) => {
      if (!editor) return;
      const totalChildren = editor.state.doc.childCount;

      let blockIndex: number;
      if (typeof indexToDelete === 'number') {
        blockIndex = indexToDelete;
      } else {
        const { from } = editor.state.selection;
        const $from = editor.state.doc.resolve(from);
        blockIndex = $from.index(0);
      }

      if (blockIndex < 0 || blockIndex >= totalChildren) return;

      if (totalChildren <= 1) {
        // If it's the sole remaining block, clear it to an empty paragraph
        editor.chain().clearContent().insertContent({ type: 'paragraph' }).focus().run();
        updateCurrentBlockInfo(editor);
        updateFloatingCellPos(editor);
        return;
      }

      let pos = 0;
      let currentStart = 0;
      let currentEnd = 0;
      for (let i = 0; i < totalChildren; i++) {
        const size = editor.state.doc.child(i).nodeSize;
        if (i === blockIndex) {
          currentStart = pos;
          currentEnd = pos + size;
          break;
        }
        pos += size;
      }

      const state = editor.state;
      const tr = state.tr;
      tr.delete(currentStart, currentEnd);
      tr.setMeta('addToHistory', true);

      // Safe selection target:
      // When deleting the last cell, place cursor at the end of the previous block cleanly
      const targetPos = Math.max(0, Math.min(currentStart > 0 ? currentStart - 1 : 0, tr.doc.content.size));
      if (tr.doc.content.size > 0) {
        try {
          const resolved = tr.doc.resolve(targetPos);
          tr.setSelection(TextSelection.near(resolved, -1));
        } catch {
          tr.setSelection(TextSelection.atStart(tr.doc));
        }
      }
      editor.view.dispatch(tr);
      editor.view.focus();
      updateCurrentBlockInfo(editor);
      updateFloatingCellPos(editor);
    },
    [editor, updateCurrentBlockInfo, updateFloatingCellPos]
  );

  // Template Scaffolding Injection
  const handleApplyTemplate = (templateId: string) => {
    if (!editor) return;

    if (templateId === 'weekly_status') {
      editor
        .chain()
        .focus()
        .insertContent([
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Weekly Project Status Pulse' }] },
          { type: 'projectStatusBlock' },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Key Achievements & Deliverables' }] },
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: true },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completed milestone core integration' }] }],
              },
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Verify staging cluster deployment' }] }],
              },
            ],
          },
        ])
        .run();
    } else if (templateId === 'architecture_rfc') {
      editor
        .chain()
        .focus()
        .insertContent([
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Architecture RFC & Decision Record' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Context & Problem Statement' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Describe the technical architecture context and problem drivers.' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Proposed Architecture Diagram' }] },
          { type: 'mermaidBlock' },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Decision & Consequences' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Record architectural trade-offs, security implications, and operational impact.' }] },
        ])
        .run();
    } else if (templateId === 'incident_postmortem') {
      editor
        .chain()
        .focus()
        .insertContent([
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Incident Postmortem (SEV-1 Retrospective)' }] },
          {
            type: 'alert',
            attrs: { type: 'warning' },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'SEV-1 Incident Summary: Outage detected, mitigated, and stabilized.' }] }],
          },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Incident Timeline' }] },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Timestamp (UTC)' }] }] },
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Event Description' }] }] },
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Responder' }] }] },
                ],
              },
              {
                type: 'tableRow',
                content: [
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '14:02 UTC' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alert triggered for 5xx latency spike' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'SRE On-Call' }] }] },
                ],
              },
            ],
          },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Root Cause & 5 Whys' }] },
          {
            type: 'orderedList',
            content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Why 1: Database connection pool exhausted.' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Why 2: Query timeout was not configured on reporting jobs.' }] }] },
            ],
          },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Preventive Action Items' }] },
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Add strict connection limits and query timeouts' }] }],
              },
            ],
          },
        ])
        .run();
    } else if (templateId === 'runbook') {
      editor
        .chain()
        .focus()
        .insertContent([
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Operational Engineering Runbook' }] },
          {
            type: 'alert',
            attrs: { type: 'note' },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Target SLA: 99.95% Availability. Escalation: SRE Team Primary.' }] }],
          },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Prerequisites & Validation' }] },
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kubernetes cluster admin credentials verified' }] }],
              },
            ],
          },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Execution Procedure' }] },
          {
            type: 'codeBlock',
            content: [
              {
                type: 'text',
                text: '# 1. Check pod status\nkubectl get pods -n production\n\n# 2. Trigger rollout restart\nkubectl rollout restart deployment/api-server -n production',
              },
            ],
          },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Rollback Steps' }] },
          {
            type: 'codeBlock',
            content: [{ type: 'text', text: 'kubectl rollout undo deployment/api-server -n production' }],
          },
        ])
        .run();
    } else if (templateId === 'test_plan') {
      editor
        .chain()
        .focus()
        .insertContent([
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Test Plan & Acceptance Matrix' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Scope & Target Environments' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'QA staging cluster, integration database, simulated load.' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Acceptance Test Matrix' }] },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Case ID' }] }] },
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Scenario' }] }] },
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Expected Outcome' }] }] },
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Status' }] }] },
                ],
              },
              {
                type: 'tableRow',
                content: [
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'TC-01' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Collaborator paste file attachment' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'File uploaded and rendered cleanly' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'PASS' }] }] },
                ],
              },
            ],
          },
        ])
        .run();
    }
  };

  // Suggestion Acceptance Lifecycle using genuine @enterprise-blogger/shared lifecycle
  const handleAccept = (sug: ActiveSuggestionInfo) => {
    if (!editor) return;
    try {
      acceptSuggestion(ydoc, sug.id, user?.name || 'human', 'prosemirror');
    } catch {
      if (sug.type === 'insert') {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: sug.from, to: sug.to })
          .unsetMark('suggestion_insert')
          .run();
      } else {
        editor
          .chain()
          .focus()
          .deleteRange({ from: sug.from, to: sug.to })
          .run();
      }
    }

    setActiveSuggestion(null);
    scanSuggestions(editor);
  };

  // Suggestion Rejection Lifecycle using genuine @enterprise-blogger/shared lifecycle
  const handleReject = (sug: ActiveSuggestionInfo) => {
    if (!editor) return;
    try {
      rejectSuggestion(ydoc, sug.id, user?.name || 'human', 'prosemirror');
    } catch {
      if (sug.type === 'insert') {
        editor
          .chain()
          .focus()
          .deleteRange({ from: sug.from, to: sug.to })
          .run();
      } else {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: sug.from, to: sug.to })
          .unsetMark('suggestion_delete')
          .run();
      }
    }

    setActiveSuggestion(null);
    scanSuggestions(editor);
  };

  const handleAcceptAll = () => {
    if (!editor) return;
    ydoc.transact(() => {
      allSuggestions.forEach((sug) => {
        try {
          acceptSuggestion(ydoc, sug.id, user?.name || 'human', 'prosemirror');
        } catch {
          // fallback
        }
      });
    }, { origin: 'human', userId: user?.name || 'human', action: 'acceptAll' });
    setActiveSuggestion(null);
    if (editor) scanSuggestions(editor);
  };

  const handleRejectAll = () => {
    if (!editor) return;
    ydoc.transact(() => {
      allSuggestions.forEach((sug) => {
        try {
          rejectSuggestion(ydoc, sug.id, user?.name || 'human', 'prosemirror');
        } catch {
          // fallback
        }
      });
    }, { origin: 'human', userId: user?.name || 'human', action: 'rejectAll' });
    setActiveSuggestion(null);
    if (editor) scanSuggestions(editor);
  };

  const handleSelectSuggestion = (sug: ActiveSuggestionInfo) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection({ from: sug.from, to: sug.to }).run();
    setActiveSuggestion(sug);
  };

  if (!editor) return null;

  const isTableActive = editor.isActive('table');

  return (
    <div className="flex flex-col h-full bg-canvas text-foreground">
      {/* Awareness bar showing connected users and AI agents */}
      <AwarenessBar provider={provider} />

      {/* Hidden file input for attachment uploads */}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            uploadAttachment(e.target.files[0]);
            e.target.value = '';
          }
        }}
      />

      {/* Primary Editor Formatting Toolbar */}
      <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 bg-surface border-b border-border select-none">
        {/* Slash Command / Block Insert trigger */}
        <button
          onClick={handleOpenSlashMenu}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border bg-canvas text-text-secondary hover:text-foreground hover:bg-elevated transition-colors text-xs font-semibold mr-1 shadow-xs"
          title="Insert Block (or type / on new line)"
        >
          <Plus size={13} className="text-accent" />
          <span>Insert</span>
        </button>

        {/* Templates Picker Trigger */}
        <button
          onClick={() => setIsTemplatePickerOpen(true)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border bg-canvas text-accent hover:bg-elevated transition-colors text-xs font-semibold mr-1 shadow-xs"
          title="Scaffold Enterprise Document Template"
        >
          <Sparkles size={13} />
          <span>Templates</span>
        </button>

        <span className="text-border mx-0.5">|</span>

        {/* View Mode Toggle: Document Flow vs Block View */}
        <div className="flex items-center rounded-lg border border-border p-0.5 bg-canvas mr-1">
          <button
            onClick={() => handleToggleViewMode('document')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${
              viewMode === 'document'
                ? 'bg-elevated text-foreground shadow-xs'
                : 'text-text-muted hover:text-foreground'
            }`}
            title="Document View (Continuous prose)"
          >
            <FileText size={11} />
            <span>Doc</span>
          </button>
          <button
            onClick={() => handleToggleViewMode('block')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${
              viewMode === 'block'
                ? 'bg-elevated text-accent shadow-xs'
                : 'text-text-muted hover:text-foreground'
            }`}
            title="Block View (Discrete foldable section cards)"
          >
            <Layers size={11} />
            <span>Blocks</span>
          </button>
        </div>

        <span className="text-border mx-0.5">|</span>

        {/* Text styling */}
        {/* Undo & Redo History Triggers */}
        <button
          onClick={() => editor.chain().focus().undo().run()}
          className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated transition-colors"
          title="Undo (Ctrl+Z)"
        >
          <RotateCcw size={13} />
        </button>
        <button
          onClick={() => editor.chain().focus().redo().run()}
          className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated transition-colors"
          title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
        >
          <RotateCw size={13} />
        </button>

        <span className="text-border mx-0.5">|</span>

        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-1.5 rounded-lg border transition-colors ${
            editor.isActive('bold')
              ? 'bg-accent-bg text-accent border-accent/30'
              : 'border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated'
          }`}
          title="Bold (Ctrl+B)"
        >
          <Bold size={13} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-1.5 rounded-lg border transition-colors ${
            editor.isActive('italic')
              ? 'bg-accent-bg text-accent border-accent/30'
              : 'border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated'
          }`}
          title="Italic (Ctrl+I)"
        >
          <Italic size={13} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleCode().run()}
          className={`p-1.5 rounded-lg border transition-colors ${
            editor.isActive('code')
              ? 'bg-accent-bg text-accent border-accent/30'
              : 'border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated'
          }`}
          title="Inline Code"
        >
          <Code size={13} />
        </button>

        <span className="text-border mx-0.5">|</span>

        {/* Headings */}
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`p-1.5 rounded-lg border transition-colors ${
            editor.isActive('heading', { level: 1 })
              ? 'bg-accent-bg text-accent border-accent/30'
              : 'border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated'
          }`}
          title="Heading 1"
        >
          <Heading1 size={13} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`p-1.5 rounded-lg border transition-colors ${
            editor.isActive('heading', { level: 2 })
              ? 'bg-accent-bg text-accent border-accent/30'
              : 'border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated'
          }`}
          title="Heading 2"
        >
          <Heading2 size={13} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`p-1.5 rounded-lg border transition-colors ${
            editor.isActive('heading', { level: 3 })
              ? 'bg-accent-bg text-accent border-accent/30'
              : 'border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated'
          }`}
          title="Heading 3"
        >
          <Heading3 size={13} />
        </button>

        <span className="text-border mx-0.5">|</span>

        {/* Text Alignment */}
        <button
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className={`p-1.5 rounded-lg border transition-colors ${
            editor.isActive({ textAlign: 'left' })
              ? 'bg-accent-bg text-accent border-accent/30'
              : 'border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated'
          }`}
          title="Align Left"
        >
          <AlignLeft size={13} />
        </button>

        <button
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className={`p-1.5 rounded-lg border transition-colors ${
            editor.isActive({ textAlign: 'center' })
              ? 'bg-accent-bg text-accent border-accent/30'
              : 'border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated'
          }`}
          title="Align Center"
        >
          <AlignCenter size={13} />
        </button>

        <button
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          className={`p-1.5 rounded-lg border transition-colors ${
            editor.isActive({ textAlign: 'right' })
              ? 'bg-accent-bg text-accent border-accent/30'
              : 'border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated'
          }`}
          title="Align Right"
        >
          <AlignRight size={13} />
        </button>

        <span className="text-border mx-0.5">|</span>

        {/* Lists & Checklists */}
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-1.5 rounded-lg border transition-colors ${
            editor.isActive('bulletList')
              ? 'bg-accent-bg text-accent border-accent/30'
              : 'border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated'
          }`}
          title="Bullet List"
        >
          <List size={13} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-1.5 rounded-lg border transition-colors ${
            editor.isActive('orderedList')
              ? 'bg-accent-bg text-accent border-accent/30'
              : 'border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated'
          }`}
          title="Numbered List"
        >
          <ListOrdered size={13} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          className={`p-1.5 rounded-lg border transition-colors ${
            editor.isActive('taskList')
              ? 'bg-accent-bg text-accent border-accent/30'
              : 'border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated'
          }`}
          title="Interactive Task Checklist"
        >
          <CheckSquare size={13} />
        </button>

        <span className="text-border mx-0.5">|</span>

        {/* Tables & Structured Blocks */}
        <button
          onClick={() =>
            isTableActive
              ? editor.chain().focus().deleteTable().run()
              : editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
          className={`p-1.5 rounded-lg border transition-colors ${
            isTableActive
              ? 'bg-accent-bg text-accent border-accent/30 font-semibold'
              : 'border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated'
          }`}
          title={isTableActive ? 'Delete Table' : 'Insert 3x3 Table'}
        >
          <TableIcon size={13} />
        </button>

        {isTableActive && (
          <div className="flex items-center gap-0.5 bg-canvas px-1.5 py-0.5 rounded-lg border border-border">
            <button
              onClick={() => editor.chain().focus().addRowAfter().run()}
              className="p-1 rounded text-text-secondary hover:text-foreground hover:bg-elevated text-[10px] flex items-center gap-0.5"
              title="Add Row Below"
            >
              <Rows size={11} />
              <span>+Row</span>
            </button>
            <button
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              className="p-1 rounded text-text-secondary hover:text-foreground hover:bg-elevated text-[10px] flex items-center gap-0.5"
              title="Add Column Right"
            >
              <Columns size={11} />
              <span>+Col</span>
            </button>
            <button
              onClick={() => editor.chain().focus().deleteRow().run()}
              className="p-1 rounded text-status-danger hover:bg-status-danger/10 text-[10px]"
              title="Delete Current Row"
            >
              -Row
            </button>
            <button
              onClick={() => editor.chain().focus().deleteColumn().run()}
              className="p-1 rounded text-status-danger hover:bg-status-danger/10 text-[10px]"
              title="Delete Current Column"
            >
              -Col
            </button>
          </div>
        )}

        {/* Status Pulse */}
        <button
          onClick={() => editor.chain().focus().insertContent({ type: 'projectStatusBlock' }).run()}
          className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated transition-colors"
          title="Insert Project Status & Health Pulse"
        >
          <Flag size={13} />
        </button>

        {/* Mermaid Diagram */}
        <button
          onClick={() => editor.chain().focus().insertContent({ type: 'mermaidBlock' }).run()}
          className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated transition-colors"
          title="Insert Mermaid Architecture Diagram"
        >
          <GitGraph size={13} />
        </button>

        {/* KaTeX Math */}
        <button
          onClick={() => editor.chain().focus().insertContent({ type: 'mathBlock' }).run()}
          className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated transition-colors"
          title="Insert KaTeX Math Formula"
        >
          <Sigma size={13} />
        </button>

        {/* File & Image Attachment */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated transition-colors disabled:opacity-50"
          title="Attach Image or File (Max 25MB)"
        >
          {isUploading ? <Loader2 size={13} className="animate-spin text-accent" /> : <Paperclip size={13} />}
        </button>

        {allSuggestions.length > 0 && (
          <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-text-secondary bg-elevated border border-border px-2.5 py-0.5 rounded-full font-medium shadow-xs">
            <span>
              {allSuggestions.length} {allSuggestions.length === 1 ? 'suggestion' : 'suggestions'} pending
            </span>
          </div>
        )}
      </div>

      {/* Block View Active Control Bar (Visible when in Block View) */}
      {viewMode === 'block' && currentBlockInfo && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-surface border-b border-border text-xs select-none">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-muted">
              Card {currentBlockInfo.index} of {currentBlockInfo.total}:
            </span>
            <span className="px-2 py-0.5 rounded-md bg-canvas border border-border font-mono text-[11px] text-accent font-semibold">
              {currentBlockInfo.type}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Split / Insert New Card Below */}
            <button
              onClick={() => handleInsertCardBelow('paragraph')}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-canvas hover:bg-elevated text-foreground text-[11px] font-medium transition-colors"
              title="Split / Insert New Card Below (Shift+Enter)"
            >
              <Plus size={12} className="text-accent" />
              <span>+ Card Below</span>
            </button>

            <span className="text-border">|</span>

            <span className="text-[11px] text-text-muted mr-0.5">Move:</span>
            <button
              onClick={() => handleMoveBlock('up')}
              disabled={currentBlockInfo.index <= 1}
              className="p-1 rounded border border-border bg-canvas hover:bg-elevated text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
              title="Move Block Up (▲)"
            >
              <ChevronUp size={13} />
            </button>
            <button
              onClick={() => handleMoveBlock('down')}
              disabled={currentBlockInfo.index >= currentBlockInfo.total}
              className="p-1 rounded border border-border bg-canvas hover:bg-elevated text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
              title="Move Block Down (▼)"
            >
              <ChevronDown size={13} />
            </button>

            <span className="text-border">|</span>

            {/* Delete Card */}
            <button
              onClick={() => handleDeleteCardAtIndex()}
              onMouseDown={(e) => e.preventDefault()}
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded border border-status-danger/30 bg-status-danger/10 hover:bg-status-danger/20 text-status-danger text-[11px] font-semibold transition-colors shadow-2xs"
              title="Delete Current Cell"
            >
              <Trash2 size={12} />
              <span>Delete Cell</span>
            </button>
          </div>
        </div>
      )}

      {/* Reorder Collision Awareness Banner */}
      {reorderConflictMessage && (
        <div className="px-4 py-2 bg-status-danger/10 border-b border-status-danger/30 text-status-danger text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <ShieldAlert size={14} className="shrink-0" />
            <span>{reorderConflictMessage}</span>
          </div>
          <button onClick={() => setReorderConflictMessage(null)} className="p-0.5 hover:opacity-70">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Upload Error Banner */}
      {uploadError && (
        <div className="px-4 py-2 bg-status-danger/10 border-b border-status-danger/30 text-status-danger text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0" />
            <span>{uploadError}</span>
          </div>
          <button onClick={() => setUploadError(null)} className="p-0.5 hover:opacity-70">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Floating Suggestion Action Menu */}
      {activeSuggestion && (
        <div className="px-4 py-2 bg-elevated border-b border-border shadow-sm">
          <SuggestionActionMenu
            editor={editor}
            activeSuggestion={activeSuggestion}
            onAccept={handleAccept}
            onReject={handleReject}
          />
        </div>
      )}

      {/* Floating Slash Command Menu */}
      <SlashMenu
        editor={editor}
        isOpen={isSlashMenuOpen}
        position={slashMenuPos}
        onClose={() => setIsSlashMenuOpen(false)}
        onUploadAttachment={() => fileInputRef.current?.click()}
        onOpenTemplates={() => setIsTemplatePickerOpen(true)}
      />

      {/* Template Picker Dialog */}
      <TemplatePickerDialog
        isOpen={isTemplatePickerOpen}
        onClose={() => setIsTemplatePickerOpen(false)}
        onSelectTemplate={handleApplyTemplate}
      />

      {/* Main workspace layout: Editor canvas centered on paper surface + Suggestion sidebar */}
      <div className="flex flex-1 overflow-hidden bg-canvas min-w-0">
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto p-4 sm:p-8 flex justify-center min-w-0 relative"
        >
          <div
            ref={editorWrapperRef}
            className={`w-full max-w-[820px] transition-all my-2 relative ${
              viewMode === 'block'
                ? 'enterprise-block-mode pb-12'
                : 'min-h-[700px] h-fit bg-surface border border-border rounded-2xl p-6 sm:p-10 shadow-sm text-foreground focus-within:border-accent-main/40'
            }`}
          >
            {/* Active Cell Floating Action Pill (Directly on the active cell in Block View) */}
            {viewMode === 'block' && floatingCellPos && currentBlockInfo && (
              <div
                style={{
                  position: 'absolute',
                  top: `${floatingCellPos.top}px`,
                  right: `${floatingCellPos.right}px`,
                }}
                className="z-20 flex items-center gap-1 px-2 py-1 rounded-lg bg-surface/95 border border-border shadow-md backdrop-blur-xs select-none transition-all animate-fadeIn"
              >
                <span className="text-[10px] font-mono text-text-muted px-1">
                  {currentBlockInfo.type}
                </span>
                <span className="text-border">|</span>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleMoveBlock('up')}
                  disabled={currentBlockInfo.index <= 1}
                  className="p-1 rounded hover:bg-canvas text-text-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  title="Move Cell Up (▲)"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleMoveBlock('down')}
                  disabled={currentBlockInfo.index >= currentBlockInfo.total}
                  className="p-1 rounded hover:bg-canvas text-text-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  title="Move Cell Down (▼)"
                >
                  <ChevronDown size={12} />
                </button>
                <span className="text-border">|</span>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleInsertCardBelow('paragraph')}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-canvas text-accent text-[11px] font-medium transition-colors"
                  title="Insert New Card Below (Shift+Enter)"
                >
                  <Plus size={11} />
                  <span>+ Below</span>
                </button>
                <span className="text-border">|</span>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleDeleteCardAtIndex()}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-status-danger/10 text-status-danger text-[11px] font-semibold transition-colors"
                  title="Delete This Cell"
                >
                  <Trash2 size={11} />
                  <span>Delete</span>
                </button>
              </div>
            )}

            <EditorContent editor={editor} className="w-full max-w-full" />

            {/* In Block View: Notebook-style "+ Add Cell" dock at the bottom of cards */}
            {viewMode === 'block' && (
              <div className="mt-8 pt-4 border-t border-border flex flex-col items-center gap-2 select-none">
                <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  + Add Notebook Card (.ipynb)
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5 p-2 rounded-xl border border-dashed border-border/80 bg-canvas/40 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => handleInsertCardBelow('paragraph')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-foreground hover:bg-canvas border border-transparent hover:border-border transition-colors"
                    title="Add Text / Markdown Card"
                  >
                    <FileText size={12} className="text-text-muted" />
                    <span>+ Text</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertCardBelow('codeBlock')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-foreground hover:bg-canvas border border-transparent hover:border-border transition-colors"
                    title="Add Code Cell"
                  >
                    <Code size={12} className="text-accent" />
                    <span>+ Code</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertCardBelow('heading')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-foreground hover:bg-canvas border border-transparent hover:border-border transition-colors"
                    title="Add Major Block Title (H1)"
                  >
                    <Heading1 size={12} className="text-accent" />
                    <span>+ Block Title (H1)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertCardBelow('table')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-foreground hover:bg-canvas border border-transparent hover:border-border transition-colors"
                    title="Add Table Matrix Card"
                  >
                    <TableIcon size={12} className="text-accent" />
                    <span>+ Table</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertCardBelow('mermaidBlock')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-foreground hover:bg-canvas border border-transparent hover:border-border transition-colors"
                    title="Add Architecture Diagram Card"
                  >
                    <GitGraph size={12} className="text-accent" />
                    <span>+ Diagram</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertCardBelow('projectStatusBlock')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-foreground hover:bg-canvas border border-transparent hover:border-border transition-colors"
                    title="Add Health & Milestone Pulse Card"
                  >
                    <Flag size={12} className="text-success" />
                    <span>+ Status</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertCardBelow('taskList')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-foreground hover:bg-canvas border border-transparent hover:border-border transition-colors"
                    title="Add Task Checklist Card"
                  >
                    <CheckSquare size={12} className="text-success" />
                    <span>+ Tasks</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertCardBelow('mathBlock')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-foreground hover:bg-canvas border border-transparent hover:border-border transition-colors"
                    title="Add Math / KaTeX Formula Card"
                  >
                    <Sigma size={12} className="text-accent" />
                    <span>+ Math</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {!hideSidebar && (
          <SuggestionSidebar
            suggestions={allSuggestions}
            onAccept={handleAccept}
            onReject={handleReject}
            onAcceptAll={handleAcceptAll}
            onRejectAll={handleRejectAll}
            onSelect={handleSelectSuggestion}
          />
        )}
      </div>
    </div>
  );
};
