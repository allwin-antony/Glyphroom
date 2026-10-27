import { SlotRenderer } from '../plugins/SlotRenderer.js';
import React, { useState } from 'react';
import * as Y from 'yjs';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs.js';
import { Bot, MessageSquare, History, Settings, X } from 'lucide-react';
import { SuggestionsTab } from './tabs/SuggestionsTab.js';
import { CommentsTab } from './tabs/CommentsTab.js';
import { VersionsTab } from './tabs/VersionsTab.js';
import { PostSettingsTab } from './tabs/PostSettingsTab.js';

export interface DrawerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  postId: string;
  ydoc: Y.Doc;
  editor: any | null;
  currentUser: {
    userId: string;
    fullName?: string;
    name?: string;
    email?: string;
    role?: string;
  };
  postMetadata?: {
    id: string;
    title: string;
    slug: string;
    excerpt?: string | null;
    coeId?: string | null;
    status: string;
  };
  onMetadataUpdate?: (metadata: any) => void;
  pendingSuggestionsCount?: number;
  openCommentsCount?: number;
  defaultTab?: 'suggestions' | 'comments' | 'versions' | 'settings';
}

export const DrawerPanel: React.FC<DrawerPanelProps> = ({
  isOpen,
  onClose,
  postId,
  ydoc,
  editor,
  currentUser,
  postMetadata,
  onMetadataUpdate,
  pendingSuggestionsCount = 0,
  openCommentsCount = 0,
  defaultTab = 'suggestions',
}) => {
  const [activeTab, setActiveTab] = useState<'suggestions' | 'comments' | 'versions' | 'settings'>(defaultTab);

  if (!isOpen) return null;

  return (
    <aside 
      aria-label="Editor Inspector Panel"
      className="w-80 sm:w-96 border-l border-border bg-surface flex flex-col h-full text-foreground shrink-0 shadow-lg transition-all z-20"
    >
      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as any)} className="flex flex-col h-full">
        {/* Drawer Header & Tab Selector */}
        <div className="p-2 border-b border-border flex items-center justify-between gap-1 bg-surface-muted/50">
          <TabsList className="grid grid-cols-4 h-8 bg-muted/60 p-0.5 rounded-lg flex-1">
            <TabsTrigger value="suggestions" className="text-xs gap-1 relative px-1 py-1" title="Suggestions">
              <Bot className="w-3.5 h-3.5 text-agent" />
              <span className="hidden sm:inline">Edits</span>
              {pendingSuggestionsCount > 0 && (
                <span className="ml-0.5 px-1 py-0.2 rounded-full text-[10px] bg-agent text-white font-bold leading-none">
                  {pendingSuggestionsCount}
                </span>
              )}
            </TabsTrigger>

            <TabsTrigger value="comments" className="text-xs gap-1 relative px-1 py-1" title="Comments">
              <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
              <span className="hidden sm:inline">Notes</span>
              {openCommentsCount > 0 && (
                <span className="ml-0.5 px-1 py-0.2 rounded-full text-[10px] bg-blue-500 text-white font-bold leading-none">
                  {openCommentsCount}
                </span>
              )}
            </TabsTrigger>

            <TabsTrigger value="versions" className="text-xs gap-1 px-1 py-1" title="Version History">
              <History className="w-3.5 h-3.5 text-amber-500" />
              <span className="hidden sm:inline">History</span>
            </TabsTrigger>

            <TabsTrigger value="settings" className="text-xs gap-1 px-1 py-1" title="Post Settings">
              <Settings className="w-3.5 h-3.5 text-text-secondary" />
              <span className="hidden sm:inline">Settings</span>
            </TabsTrigger>
          </TabsList>
          <SlotRenderer slot="editor:drawer:tabs" context={{ postId, editor }} />

          <button
            onClick={onClose}
            className="p-1 rounded-md text-text-muted hover:text-foreground hover:bg-elevated transition-colors ml-1"
            title="Close Drawer"
            aria-label="Close Inspector Drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-hidden">
          <TabsContent value="suggestions" className="m-0 h-full data-[state=inactive]:hidden">
            <SuggestionsTab ydoc={ydoc} editor={editor} currentUser={currentUser} />
          </TabsContent>

          <TabsContent value="comments" className="m-0 h-full data-[state=inactive]:hidden">
            <CommentsTab postId={postId} ydoc={ydoc} editor={editor} currentUser={currentUser} />
          </TabsContent>

          <TabsContent value="versions" className="m-0 h-full data-[state=inactive]:hidden">
            <VersionsTab postId={postId} />
          </TabsContent>

          <TabsContent value="settings" className="m-0 h-full data-[state=inactive]:hidden">
            <PostSettingsTab postId={postId} postMetadata={postMetadata} onMetadataUpdate={onMetadataUpdate} />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
};
