import * as Y from 'yjs';
import type { AgentMetadata } from '../types/index.js';
import type {
  SuggestionHunk,
  SuggestionInsertAttrs,
  SuggestionDeleteAttrs,
  AttributionAttrs,
} from '../validation/suggestions.js';

export interface SectionBoundary {
  headingIndex: number;
  headingLevel: number;
  headingElement: Y.XmlElement;
  endIndex: number; // exclusive end index in fragment
  bodyElements: Y.XmlElement[];
}

export interface AppendSectionOptions {
  fragmentName?: string;
  headingLevel?: number; // default: 2
  origin?: any;
}

export interface AppendSectionResult {
  success: boolean;
  suggestionIds: string[];
  changesSummary: {
    insertions: number;
    deletions: number;
    hunksApplied: number;
  };
}

export interface InsertAfterSectionOptions {
  fragmentName?: string;
  headingLevel?: number;
  origin?: any;
}

export interface InsertAfterSectionResult {
  success: boolean;
  suggestionIds: string[];
  changesSummary: {
    insertions: number;
    deletions: number;
    hunksApplied: number;
  };
  insertedAtIndex: number;
}

export interface SuggestEditOptions {
  fragmentName?: string;
  granularity?: 'words' | 'chars';
  origin?: any;
}

export interface DiffResult {
  success: boolean;
  suggestionIds: string[];
  changesSummary: {
    insertions: number;
    deletions: number;
    hunksApplied: number;
  };
  hunks: SuggestionHunk[];
}

export interface AgentTransactionOrigin {
  origin: 'agent';
  agentId: string;
  tokenId: string;
  ownerUserId: string;
  timestamp: number;
  action?: 'suggest_edit' | 'append_section' | 'insert_after_section' | string;
}

export type SuggestionResolutionAction = 'accept' | 'reject';

export interface SuggestionResolutionResult {
  success: boolean;
  suggestionId: string;
  action: SuggestionResolutionAction;
  affectedHunks: number;
}

export type {
  AgentMetadata,
  SuggestionHunk,
  SuggestionInsertAttrs,
  SuggestionDeleteAttrs,
  AttributionAttrs,
};
