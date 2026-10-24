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
      <TooltipContent side="top" className="text-xs space-y-1">
        <div className="font-semibold text-foreground">Document Statistics</div>
        <div className="grid grid-cols-2 gap-x-3 text-[11px] text-text-secondary">
          <span>Words:</span>
          <span className="font-mono text-foreground text-right">{stats.words.toLocaleString()}</span>
          <span>Characters:</span>
          <span className="font-mono text-foreground text-right">{stats.characters.toLocaleString()}</span>
          <span>Characters (no spaces):</span>
          <span className="font-mono text-foreground text-right">{stats.charactersNoSpaces.toLocaleString()}</span>
          <span>Est. Reading Time:</span>
          <span className="font-mono text-foreground text-right">~{stats.readingTimeMinutes} min (200 wpm)</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
