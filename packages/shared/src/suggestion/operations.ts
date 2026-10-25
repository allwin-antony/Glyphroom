import * as Y from 'yjs';
import type { AgentMetadata } from '../types/index.js';
import type { SuggestionHunk } from '../validation/suggestions.js';
import {
  computeTokenDiff,
  computeCharDiff,
  computeParagraphDiff,
  normalizeTextForDiff,
} from './diff.js';
import { createAgentOrigin } from './undo.js';
import type {
  SectionBoundary,
  AppendSectionOptions,
  AppendSectionResult,
  InsertAfterSectionOptions,
  InsertAfterSectionResult,
  SuggestEditOptions,
  DiffResult,
} from './types.js';

/**
 * Resolves the active Y.XmlFragment from a Y.Doc.
 */
export function getDocumentFragment(doc: Y.Doc, fieldName?: string): Y.XmlFragment {
  if (fieldName) {
    return doc.getXmlFragment(fieldName);
  }
  // The Web Editor (Tiptap / ProseMirror) binds to 'prosemirror'
  if (doc.share.has('prosemirror')) {
    return doc.getXmlFragment('prosemirror');
  }
  if (doc.share.has('default')) {
    return doc.getXmlFragment('default');
  }
  return doc.getXmlFragment('prosemirror');
}

/**
 * Normalizes heading text for comparison (strips markdown hashes, inline symbols, trims, lowercases).
 */
export function normalizeHeadingText(raw: string): string {
  return raw
    .replace(/^#+\s*/, '')
    .replace(/[*_`~]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Extracts plain text from a Y.XmlText without XML formatting tags.
 */
export function getPlainTextFromXmlText(ytext: Y.XmlText): string {
  const delta = ytext.toDelta();
  let text = '';
  for (const op of delta) {
    if (typeof op.insert === 'string') {
      text += op.insert;
    }
  }
  return text;
}

/**
 * Recursively extracts plain text from an element.
 */
export function extractTextFromElement(element: Y.XmlElement): string {
  let result = '';
  for (let i = 0; i < element.length; i++) {
    const child = element.get(i);
    if (child instanceof Y.XmlText) {
      result += getPlainTextFromXmlText(child);
    } else if (child instanceof Y.XmlElement) {
      result += extractTextFromElement(child);
    }
  }
  return result;
}

/**
 * Finds target heading and determines the section boundary in a Y.XmlFragment.
 */
export function findSectionBoundary(
  fragment: Y.XmlFragment,
  targetHeading: string
): SectionBoundary | null {
  const target = normalizeHeadingText(targetHeading);
  let targetIndex = -1;
  let targetLevel = 1;
  let headingElement: Y.XmlElement | null = null;

  for (let i = 0; i < fragment.length; i++) {
    const item = fragment.get(i);
    if (item instanceof Y.XmlElement && item.nodeName === 'heading') {
      const text = extractTextFromElement(item);
      if (normalizeHeadingText(text) === target) {
        targetIndex = i;
        targetLevel = Number(item.getAttribute('level') || 1);
        headingElement = item;
        break;
      }
    }
  }

  if (targetIndex === -1 || !headingElement) {
    return null;
  }

  let endIndex = targetIndex + 1;
  const bodyElements: Y.XmlElement[] = [];

  while (endIndex < fragment.length) {
    const item = fragment.get(endIndex);
    if (item instanceof Y.XmlElement && item.nodeName === 'heading') {
      const level = Number(item.getAttribute('level') || 1);
      if (level <= targetLevel) {
        break;
      }
    }
    if (item instanceof Y.XmlElement) {
      bodyElements.push(item);
    }
    endIndex++;
  }

  return {
    headingIndex: targetIndex,
    headingLevel: targetLevel,
    headingElement,
    endIndex,
    bodyElements,
  };
}

/**
 * Safely appends a new section at the end of the document.
 * Safe additive insertion of heading and content blocks without deleting or mutating existing nodes.
 */
export function appendSection(
  doc: Y.Doc,
  heading: string | undefined,
  content: string,
  agentMeta: AgentMetadata,
  options?: AppendSectionOptions
): AppendSectionResult {
  const fragment = getDocumentFragment(doc, options?.fragmentName);
  const suggestionIds: string[] = [];
  const normalizedContent = normalizeTextForDiff(content);
  const paragraphs = normalizedContent.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let insertionsCount = 0;

  const origin = options?.origin || createAgentOrigin(agentMeta, 'append_section');

  doc.transact(() => {
    if (heading && heading.trim()) {
      const cleanHeading = heading.replace(/^#+\s*/, '').trim();
      const hunkId = crypto.randomUUID();
      suggestionIds.push(hunkId);

      const h = new Y.XmlElement('heading');
      fragment.push([h]);
      h.setAttribute('level', String(options?.headingLevel || 2));

      const ht = new Y.XmlText();
      h.push([ht]);
      ht.insert(0, cleanHeading, {
        suggestion_insert: {
          id: hunkId,
          agentId: agentMeta.agentId,
          tokenId: agentMeta.tokenId,
          ownerUserId: agentMeta.ownerUserId,
          timestamp: agentMeta.timestamp,
          status: 'pending',
        },
        suggestion_delete: null,
      });
      insertionsCount += cleanHeading.length;
    }

    for (const para of paragraphs) {
      const hunkId = crypto.randomUUID();
      suggestionIds.push(hunkId);

      const p = new Y.XmlElement('paragraph');
      fragment.push([p]);

      const pt = new Y.XmlText();
      p.push([pt]);
      pt.insert(0, para, {
        suggestion_insert: {
          id: hunkId,
          agentId: agentMeta.agentId,
          tokenId: agentMeta.tokenId,
          ownerUserId: agentMeta.ownerUserId,
          timestamp: agentMeta.timestamp,
          status: 'pending',
        },
        suggestion_delete: null,
      });
      insertionsCount += para.length;
    }
  }, origin);

  return {
    success: true,
    suggestionIds,
    changesSummary: {
      insertions: insertionsCount,
      deletions: 0,
      hunksApplied: suggestionIds.length,
    },
  };
}

/**
 * Inserts content blocks after the target section heading and its subtree.
 */
export function insertAfterSection(
  doc: Y.Doc,
  targetHeading: string,
  heading: string | undefined,
  content: string,
  agentMeta: AgentMetadata,
  options?: InsertAfterSectionOptions
): InsertAfterSectionResult {
  const fragment = getDocumentFragment(doc, options?.fragmentName);
  const boundary = findSectionBoundary(fragment, targetHeading);

  if (!boundary) {
    return {
      success: false,
      suggestionIds: [],
      changesSummary: { insertions: 0, deletions: 0, hunksApplied: 0 },
      insertedAtIndex: -1,
    };
  }

  let insertIndex = boundary.endIndex;
  const suggestionIds: string[] = [];
  const normalizedContent = normalizeTextForDiff(content);
  const paragraphs = normalizedContent.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let insertionsCount = 0;

  const origin = options?.origin || createAgentOrigin(agentMeta, 'insert_after_section');

  doc.transact(() => {
    if (heading && heading.trim()) {
      const cleanHeading = heading.replace(/^#+\s*/, '').trim();
      const hunkId = crypto.randomUUID();
      suggestionIds.push(hunkId);

      const h = new Y.XmlElement('heading');
      fragment.insert(insertIndex, [h]);
      h.setAttribute('level', String(options?.headingLevel || boundary.headingLevel));

      const ht = new Y.XmlText();
      h.push([ht]);
      ht.insert(0, cleanHeading, {
        suggestion_insert: {
          id: hunkId,
          agentId: agentMeta.agentId,
          tokenId: agentMeta.tokenId,
          ownerUserId: agentMeta.ownerUserId,
          timestamp: agentMeta.timestamp,
          status: 'pending',
        },
        suggestion_delete: null,
      });
      insertionsCount += cleanHeading.length;
      insertIndex++;
    }

    for (const para of paragraphs) {
      const hunkId = crypto.randomUUID();
      suggestionIds.push(hunkId);

      const p = new Y.XmlElement('paragraph');
      fragment.insert(insertIndex, [p]);

      const pt = new Y.XmlText();
      p.push([pt]);
      pt.insert(0, para, {
        suggestion_insert: {
          id: hunkId,
          agentId: agentMeta.agentId,
          tokenId: agentMeta.tokenId,
          ownerUserId: agentMeta.ownerUserId,
          timestamp: agentMeta.timestamp,
          status: 'pending',
        },
        suggestion_delete: null,
      });
      insertionsCount += para.length;
      insertIndex++;
    }
  }, origin);

  return {
    success: true,
    suggestionIds,
    changesSummary: {
      insertions: insertionsCount,
      deletions: 0,
      hunksApplied: suggestionIds.length,
    },
    insertedAtIndex: boundary.endIndex,
  };
}

/**
 * Suggests edits to a section using fine-grained Myers diff and non-destructive suggestion marks.
 * Coarse block replacement is strictly forbidden.
 */
export function suggestEditSection(
  doc: Y.Doc,
  targetHeading: string,
  newContent: string,
  agentMeta: AgentMetadata,
  options?: SuggestEditOptions
): DiffResult {
  const fragment = getDocumentFragment(doc, options?.fragmentName);
  const boundary = findSectionBoundary(fragment, targetHeading);

  if (!boundary) {
    return {
      success: false,
      suggestionIds: [],
      changesSummary: { insertions: 0, deletions: 0, hunksApplied: 0 },
      hunks: [],
    };
  }

  const suggestionIds: string[] = [];
  const hunks: SuggestionHunk[] = [];
  let insertionsCount = 0;
  let deletionsCount = 0;

  const origin = options?.origin || createAgentOrigin(agentMeta, 'suggest_edit');

  const normalized = normalizeTextForDiff(newContent).trim();

  // Check if proposed content starts with a heading line
  const headingMatch = normalized.match(/^(#{1,6})\s+(.*)(?:\n|$)/);
  let proposedHeading: string | undefined;
  let bodyContent = normalized;

  if (headingMatch) {
    proposedHeading = headingMatch[2].trim();
    bodyContent = normalized.slice(headingMatch[0].length).trim();
  }

  const existingParas: { el: Y.XmlElement; text: string; ytext: Y.XmlText }[] = [];
  for (const el of boundary.bodyElements) {
    let ytext: Y.XmlText | null = null;
    if (el.length > 0 && el.get(0) instanceof Y.XmlText) {
      ytext = el.get(0) as Y.XmlText;
    } else {
      for (let i = 0; i < el.length; i++) {
        if (el.get(i) instanceof Y.XmlText) {
          ytext = el.get(i) as Y.XmlText;
          break;
        }
      }
      if (!ytext) {
        ytext = new Y.XmlText();
        el.push([ytext]);
      }
    }
    existingParas.push({
      el,
      text: getPlainTextFromXmlText(ytext),
      ytext,
    });
  }

  const proposedParas = bodyContent ? bodyContent.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
  const oldTexts = existingParas.map((p) => p.text);
  const blockChanges = computeParagraphDiff(oldTexts, proposedParas);

  doc.transact(() => {
    // 1. If proposed heading differs from target heading, diff heading text non-destructively
    if (proposedHeading !== undefined && normalizeHeadingText(proposedHeading) !== normalizeHeadingText(targetHeading)) {
      let ht: Y.XmlText | null = null;
      if (boundary.headingElement.length > 0 && boundary.headingElement.get(0) instanceof Y.XmlText) {
        ht = boundary.headingElement.get(0) as Y.XmlText;
      }
      if (ht) {
        const oldHeadingText = getPlainTextFromXmlText(ht);
        const diffParts =
          options?.granularity === 'chars'
            ? computeCharDiff(oldHeadingText, proposedHeading)
            : computeTokenDiff(oldHeadingText, proposedHeading);

        let currOffset = 0;
        for (const part of diffParts) {
          const len = part.value.length;
          const hunkId = crypto.randomUUID();

          if (part.removed) {
            ht.format(currOffset, len, {
              suggestion_delete: {
                id: hunkId,
                agentId: agentMeta.agentId,
                tokenId: agentMeta.tokenId,
                ownerUserId: agentMeta.ownerUserId,
                timestamp: agentMeta.timestamp,
                status: 'pending',
              },
              suggestion_insert: null,
            });
            suggestionIds.push(hunkId);
            deletionsCount += len;
            hunks.push({
              id: hunkId,
              type: 'delete',
              from: currOffset,
              to: currOffset + len,
              text: part.value,
              attributes: {
                id: hunkId,
                agentId: agentMeta.agentId,
                tokenId: agentMeta.tokenId,
                ownerUserId: agentMeta.ownerUserId,
                timestamp: agentMeta.timestamp,
                status: 'pending',
              },
            });
            currOffset += len;
          } else if (part.added) {
            ht.insert(currOffset, part.value, {
              suggestion_insert: {
                id: hunkId,
                agentId: agentMeta.agentId,
                tokenId: agentMeta.tokenId,
                ownerUserId: agentMeta.ownerUserId,
                timestamp: agentMeta.timestamp,
                status: 'pending',
              },
              suggestion_delete: null,
            });
            suggestionIds.push(hunkId);
            insertionsCount += len;
            hunks.push({
              id: hunkId,
              type: 'insert',
              from: currOffset,
              to: currOffset + len,
              text: part.value,
              attributes: {
                id: hunkId,
                agentId: agentMeta.agentId,
                tokenId: agentMeta.tokenId,
                ownerUserId: agentMeta.ownerUserId,
                timestamp: agentMeta.timestamp,
                status: 'pending',
              },
            });
            currOffset += len;
          } else {
            currOffset += len;
          }
        }
      }
    }

    // 2. Diff body paragraphs
    let oldIdx = 0;
    let currFragmentInsertIdx = boundary.headingIndex + 1;

    for (let c = 0; c < blockChanges.length; c++) {
      const change = blockChanges[c];

      if (!change.added && !change.removed) {
        // Unchanged blocks
        const count = change.count || change.value.length || 0;
        oldIdx += count;
        currFragmentInsertIdx += count;
      } else if (change.removed && blockChanges[c + 1]?.added) {
        // Modified block: Pairwise inline Myers diff
        const nextChange = blockChanges[c + 1];
        const removedCount = change.count || change.value.length || 1;
        const addedCount = nextChange.count || nextChange.value.length || 1;
        const minCount = Math.min(removedCount, addedCount);

        for (let i = 0; i < minCount; i++) {
          const oldPara = existingParas[oldIdx + i];
          const proposedText = nextChange.value[i];

          const diffParts =
            options?.granularity === 'chars'
              ? computeCharDiff(oldPara.text, proposedText)
              : computeTokenDiff(oldPara.text, proposedText);

          let currOffset = 0;
          for (const part of diffParts) {
            const len = part.value.length;
            const hunkId = crypto.randomUUID();

            if (part.removed) {
              oldPara.ytext.format(currOffset, len, {
                suggestion_delete: {
                  id: hunkId,
                  agentId: agentMeta.agentId,
                  tokenId: agentMeta.tokenId,
                  ownerUserId: agentMeta.ownerUserId,
                  timestamp: agentMeta.timestamp,
                  status: 'pending',
                },
                suggestion_insert: null,
              });
              suggestionIds.push(hunkId);
              deletionsCount += len;
              hunks.push({
                id: hunkId,
                type: 'delete',
                from: currOffset,
                to: currOffset + len,
                text: part.value,
                attributes: {
                  id: hunkId,
                  agentId: agentMeta.agentId,
                  tokenId: agentMeta.tokenId,
                  ownerUserId: agentMeta.ownerUserId,
                  timestamp: agentMeta.timestamp,
                  status: 'pending',
                },
              });
              currOffset += len;
            } else if (part.added) {
              oldPara.ytext.insert(currOffset, part.value, {
                suggestion_insert: {
                  id: hunkId,
                  agentId: agentMeta.agentId,
                  tokenId: agentMeta.tokenId,
                  ownerUserId: agentMeta.ownerUserId,
                  timestamp: agentMeta.timestamp,
                  status: 'pending',
                },
                suggestion_delete: null,
              });
              suggestionIds.push(hunkId);
              insertionsCount += len;
              hunks.push({
                id: hunkId,
                type: 'insert',
                from: currOffset,
                to: currOffset + len,
                text: part.value,
                attributes: {
                  id: hunkId,
                  agentId: agentMeta.agentId,
                  tokenId: agentMeta.tokenId,
                  ownerUserId: agentMeta.ownerUserId,
                  timestamp: agentMeta.timestamp,
                  status: 'pending',
                },
              });
              currOffset += len;
            } else {
              currOffset += len;
            }
          }
        }

        // Handle excess removed blocks if removedCount > addedCount
        if (removedCount > minCount) {
          for (let i = minCount; i < removedCount; i++) {
            const oldPara = existingParas[oldIdx + i];
            const hunkId = crypto.randomUUID();
            suggestionIds.push(hunkId);
            const len = oldPara.text.length;

            if (len > 0) {
              oldPara.ytext.format(0, len, {
                suggestion_delete: {
                  id: hunkId,
                  agentId: agentMeta.agentId,
                  tokenId: agentMeta.tokenId,
                  ownerUserId: agentMeta.ownerUserId,
                  timestamp: agentMeta.timestamp,
                  status: 'pending',
                },
                suggestion_insert: null,
              });
              deletionsCount += len;
              hunks.push({
                id: hunkId,
                type: 'delete',
                from: 0,
                to: len,
                text: oldPara.text,
                attributes: {
                  id: hunkId,
                  agentId: agentMeta.agentId,
                  tokenId: agentMeta.tokenId,
                  ownerUserId: agentMeta.ownerUserId,
                  timestamp: agentMeta.timestamp,
                  status: 'pending',
                },
              });
            }
          }
        }

        // Handle excess added blocks if addedCount > minCount
        if (addedCount > minCount) {
          for (let i = minCount; i < addedCount; i++) {
            const text = nextChange.value[i];
            const hunkId = crypto.randomUUID();
            suggestionIds.push(hunkId);

            const p = new Y.XmlElement('paragraph');
            fragment.insert(currFragmentInsertIdx + minCount + (i - minCount), [p]);

            const pt = new Y.XmlText();
            p.push([pt]);
            pt.insert(0, text, {
              suggestion_insert: {
                id: hunkId,
                agentId: agentMeta.agentId,
                tokenId: agentMeta.tokenId,
                ownerUserId: agentMeta.ownerUserId,
                timestamp: agentMeta.timestamp,
                status: 'pending',
              },
              suggestion_delete: null,
            });
            insertionsCount += text.length;
            hunks.push({
              id: hunkId,
              type: 'insert',
              from: 0,
              to: text.length,
              text,
              attributes: {
                id: hunkId,
                agentId: agentMeta.agentId,
                tokenId: agentMeta.tokenId,
                ownerUserId: agentMeta.ownerUserId,
                timestamp: agentMeta.timestamp,
                status: 'pending',
              },
            });
          }
        }

        oldIdx += removedCount;
        currFragmentInsertIdx += removedCount + Math.max(0, addedCount - removedCount);
        c++; // Skip paired added block
      } else if (change.removed) {
        // Pure removal: Non-destructive format with suggestion_delete
        const count = change.count || change.value.length || 1;
        for (let i = 0; i < count; i++) {
          const oldPara = existingParas[oldIdx + i];
          const hunkId = crypto.randomUUID();
          suggestionIds.push(hunkId);
          const len = oldPara.text.length;

          if (len > 0) {
            oldPara.ytext.format(0, len, {
              suggestion_delete: {
                id: hunkId,
                agentId: agentMeta.agentId,
                tokenId: agentMeta.tokenId,
                ownerUserId: agentMeta.ownerUserId,
                timestamp: agentMeta.timestamp,
                status: 'pending',
              },
              suggestion_insert: null,
            });
            deletionsCount += len;
            hunks.push({
              id: hunkId,
              type: 'delete',
              from: 0,
              to: len,
              text: oldPara.text,
              attributes: {
                id: hunkId,
                agentId: agentMeta.agentId,
                tokenId: agentMeta.tokenId,
                ownerUserId: agentMeta.ownerUserId,
                timestamp: agentMeta.timestamp,
                status: 'pending',
              },
            });
          }
        }
        oldIdx += count;
        currFragmentInsertIdx += count;
      } else if (change.added) {
        // Pure addition: Insert new block with suggestion_insert
        for (const text of change.value) {
          const hunkId = crypto.randomUUID();
          suggestionIds.push(hunkId);

          const p = new Y.XmlElement('paragraph');
          fragment.insert(currFragmentInsertIdx, [p]);

          const pt = new Y.XmlText();
          p.push([pt]);
          pt.insert(0, text, {
            suggestion_insert: {
              id: hunkId,
              agentId: agentMeta.agentId,
              tokenId: agentMeta.tokenId,
              ownerUserId: agentMeta.ownerUserId,
              timestamp: agentMeta.timestamp,
              status: 'pending',
            },
            suggestion_delete: null,
          });
          insertionsCount += text.length;
          hunks.push({
            id: hunkId,
            type: 'insert',
            from: 0,
            to: text.length,
            text,
            attributes: {
              id: hunkId,
              agentId: agentMeta.agentId,
              tokenId: agentMeta.tokenId,
              ownerUserId: agentMeta.ownerUserId,
              timestamp: agentMeta.timestamp,
              status: 'pending',
            },
          });
          currFragmentInsertIdx++;
        }
      }
    }
  }, origin);

  return {
    success: true,
    suggestionIds,
    changesSummary: {
      insertions: insertionsCount,
      deletions: deletionsCount,
      hunksApplied: suggestionIds.length,
    },
    hunks,
  };
}
