import * as diff from 'diff';

export interface DiffHunkPart {
  value: string;
  added?: boolean;
  removed?: boolean;
  count?: number;
}

export interface ComputedDiffHunk {
  id: string;
  type: 'insert' | 'delete';
  text: string;
  from: number;
  to: number;
}

/**
 * Normalizes input text for diffing (strips carriage returns).
 */
export function normalizeTextForDiff(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Computes fine-grained word/token Myers diff using diffWordsWithSpace.
 */
export function computeTokenDiff(oldText: string, newText: string): DiffHunkPart[] {
  return diff.diffWordsWithSpace(normalizeTextForDiff(oldText), normalizeTextForDiff(newText));
}

/**
 * Computes character-level Myers diff using diffChars.
 */
export function computeCharDiff(oldText: string, newText: string): DiffHunkPart[] {
  return diff.diffChars(normalizeTextForDiff(oldText), normalizeTextForDiff(newText));
}

export interface ArrayChange<T> {
  value: T[];
  added?: boolean;
  removed?: boolean;
  count?: number;
}

/**
 * Computes paragraph array diff using diffArrays.
 */
export function computeParagraphDiff(
  oldParas: string[],
  newParas: string[]
): ArrayChange<string>[] {
  return diff.diffArrays(oldParas, newParas, {
    comparator: (a, b) => a.trim() === b.trim(),
  }) as ArrayChange<string>[];
}

/**
 * General Myers diff dispatcher.
 */
export function computeMyersDiff(
  oldText: string,
  newText: string,
  granularity: 'words' | 'chars' = 'words'
): DiffHunkPart[] {
  return granularity === 'chars'
    ? computeCharDiff(oldText, newText)
    : computeTokenDiff(oldText, newText);
}
