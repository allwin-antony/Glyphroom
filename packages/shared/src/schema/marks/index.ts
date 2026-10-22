import { MarkSpec } from 'prosemirror-model';
import {
  MARK_STRONG,
  MARK_EM,
  MARK_LINK,
  MARK_CODE,
  MARK_SUGGESTION_INSERT,
  MARK_SUGGESTION_DELETE,
  MARK_ATTRIBUTION,
} from './constants.js';
import { strongMark, emMark, linkMark, codeMark } from './standard.js';
import { suggestionInsertMark, suggestionDeleteMark } from './suggestions.js';
import { attributionMark } from './attribution.js';

export * from './constants.js';
export * from './standard.js';
export * from './suggestions.js';
export * from './attribution.js';

export const standardMarks: Record<string, MarkSpec> = {
  [MARK_STRONG]: strongMark,
  [MARK_EM]: emMark,
  [MARK_LINK]: linkMark,
  [MARK_CODE]: codeMark,
};

export const suggestionMarks: Record<string, MarkSpec> = {
  [MARK_SUGGESTION_INSERT]: suggestionInsertMark,
  [MARK_SUGGESTION_DELETE]: suggestionDeleteMark,
  [MARK_ATTRIBUTION]: attributionMark,
};

export const allMarks: Record<string, MarkSpec> = {
  ...standardMarks,
  ...suggestionMarks,
};
