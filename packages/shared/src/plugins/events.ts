import { z } from 'zod';

export interface PluginEventMap {
  'post:created': {
    postId: string;
    authorId: string;
    spaceId: string | null;
    title: string;
  };
  'post:submitted_for_review': {
    postId: string;
    authorId: string;
    versionId: string;
  };
  'post:reviewed': {
    postId: string;
    reviewerId: string;
    decision: 'approved' | 'changes_requested';
    submittedVersionId: string;
    notes: string | null;
  };
  'post:published': {
    postId: string;
    publishedVersionId: string;
    authorId: string;
    spaceId: string | null;
    title: string;
  };
  'space:created': {
    spaceId: string;
    name: string;
    ownerId: string;
  };
  'space:archived': {
    spaceId: string;
  };
  'comment:created': {
    commentId: string;
    postId: string;
    authorId: string;
  };
}

export type PluginEventType = keyof PluginEventMap;

export const PluginEventTypeSchema = z.enum([
  'post:created',
  'post:submitted_for_review',
  'post:reviewed',
  'post:published',
  'space:created',
  'space:archived',
  'comment:created',
]);

export interface PluginEventEnvelope<K extends PluginEventType = PluginEventType> {
  id: string;
  type: K;
  occurredAt: string;
  payload: PluginEventMap[K];
}

export type PluginEventHandler<K extends PluginEventType = PluginEventType> = (
  envelope: PluginEventEnvelope<K>
) => Promise<void> | void;
