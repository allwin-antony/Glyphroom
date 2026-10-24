import React, { useState, useEffect } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { cn } from '../../lib/utils.js';

export interface DocStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  readingTimeMinutes: number;
}

export function computeDocStats(editor: any | null): DocStats {
  if (!editor || !editor.state) {
    return { words: 0, characters: 0, charactersNoSpaces: 0, readingTimeMinutes: 0 };
  }

  const { doc } = editor.state;
  // Use newline separator between blocks so words across block boundaries don't join
  const text = doc.textBetween(0, doc.content.size, '\n', ' ').trim();

  if (!text) {
    return { words: 0, characters: 0, charactersNoSpaces: 0, readingTimeMinutes: 0 };
  }

  const wordsArray = text.split(/\s+/).filter(Boolean);
  const words = wordsArray.length;
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s/g, '').length;
  const readingTimeMinutes = Math.max(1, Math.ceil(words / 200));

  return {
    words,
    characters,
    charactersNoSpaces,
    readingTimeMinutes,
  };
}

export interface WordCountIndicatorProps {
  editor: any | null;
  className?: string;
  showReadingTime?: boolean;
}

export const WordCountIndicator: React.FC<WordCountIndicatorProps> = ({
  editor,
  className,
  showReadingTime = true,
}) => {
  const [stats, setStats] = useState<DocStats>(() => computeDocStats(editor));

  useEffect(() => {
    if (!editor) return;

    const updateStats = () => {
      setStats(computeDocStats(editor));
    };

    updateStats();
    editor.on('update', updateStats);

    return () => {
      editor.off('update', updateStats);
    };
  }, [editor]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex items-center gap-2 text-xs text-text-muted font-medium cursor-default select-none transition-colors hover:text-foreground",
            className
          )}
        >
          <span>{stats.words.toLocaleString()} words</span>
          <span className="text-border">•</span>
          <span>{stats.characters.toLocaleString()} chars</span>
          {showReadingTime && stats.words > 0 && (
            <>
              <span className="text-border">•</span>
              <span>~{stats.readingTimeMinutes} min read</span>
            </>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="p-3 w-56 space-y-2 bg-elevated text-foreground border border-border shadow-xl rounded-xl">
        <div className="font-semibold text-xs text-foreground border-b border-border pb-1.5 flex items-center justify-between">
          <span>Document Statistics</span>
          <span className="text-[10px] text-text-muted font-normal">200 wpm</span>
        </div>
        <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs">
          <span className="text-text-secondary">Words:</span>
          <span className="font-mono font-semibold text-foreground text-right">{stats.words.toLocaleString()}</span>
          <span className="text-text-secondary">Characters:</span>
          <span className="font-mono font-semibold text-foreground text-right">{stats.characters.toLocaleString()}</span>
          <span className="text-text-secondary">No spaces:</span>
          <span className="font-mono font-semibold text-foreground text-right">{stats.charactersNoSpaces.toLocaleString()}</span>
          <span className="text-text-secondary">Reading time:</span>
          <span className="font-mono font-semibold text-foreground text-right">~{stats.readingTimeMinutes} min</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
