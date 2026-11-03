import React from 'react';
import { AttachmentCard } from '../../AttachmentCard.js';
import type { BlockNode } from '../markdown.js';

export const Attachment: React.FC<{ block: BlockNode }> = ({ block }) => {
  if (!block.attachment) return null;
  return (
    <div className="my-3 not-prose">
      <AttachmentCard {...block.attachment} />
    </div>
  );
};
