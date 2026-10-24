import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { CollaborativeEditor } from '../src/components/Editor.js';
import { api } from '../src/lib/api.js';

// Mock API client
vi.mock('../src/lib/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('Tier 1: Structured Documentation, Block View & Attachment Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toggles between Document View and Block View cleanly', async () => {
    const ydoc = new Y.Doc();
    render(
      <CollaborativeEditor
        ydoc={ydoc}
        postId="test-post-1"
        user={{ name: 'Lead Architect', color: '#2F57C8', role: 'author' }}
      />
    );

    // Initial state: Doc button is active
    const docBtn = screen.getByTitle('Document View (Continuous prose)');
    const blockBtn = screen.getByTitle('Block View (Discrete foldable section cards)');
    expect(docBtn).toBeDefined();
    expect(blockBtn).toBeDefined();

    // Toggle to Block View
    fireEvent.click(blockBtn);

    // Container should now have enterprise-block-mode in DOM
    const editorContent = document.querySelector('.enterprise-block-mode');
    expect(editorContent).toBeDefined();

    // Toggle back to Document View
    fireEvent.click(docBtn);
    const regularContent = document.querySelector('.enterprise-editor-content');
    expect(regularContent).toBeDefined();

    ydoc.destroy();
  });

  it('opens TemplatePickerDialog when Templates toolbar button is clicked', async () => {
    const ydoc = new Y.Doc();
    render(
      <CollaborativeEditor
        ydoc={ydoc}
        postId="test-post-1"
        user={{ name: 'Lead Architect', color: '#2F57C8', role: 'author' }}
      />
    );

    const templatesBtn = screen.getByTitle('Scaffold Enterprise Document Template');
    fireEvent.click(templatesBtn);

    expect(screen.getByText('Project Documentation & Status Templates')).toBeDefined();
    expect(screen.getByText('Weekly Project Status Pulse')).toBeDefined();
    expect(screen.getByText('Architecture RFC & Decision Record (ADR)')).toBeDefined();
    expect(screen.getByText('Incident Postmortem (SEV-1 Retrospective)')).toBeDefined();

    ydoc.destroy();
  });

  it('rejects attachment uploads exceeding the 25 MB enterprise cap', async () => {
    const ydoc = new Y.Doc();
    render(
      <CollaborativeEditor
        ydoc={ydoc}
        postId="test-post-1"
        user={{ name: 'Lead Architect', color: '#2F57C8', role: 'author' }}
      />
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeDefined();

    // Create a mock 26 MB file
    const oversizedFile = new File(['x'.repeat(1024)], 'giant-dump.zip', {
      type: 'application/zip',
    });
    Object.defineProperty(oversizedFile, 'size', { value: 26 * 1024 * 1024 });

    fireEvent.change(fileInput, { target: { files: [oversizedFile] } });

    await waitFor(() => {
      expect(screen.getByText(/File exceeds 25 MB enterprise limit/i)).toBeDefined();
    });

    expect(api.post).not.toHaveBeenCalled();
    ydoc.destroy();
  });

  it('successfully uploads valid attachment and calls API', async () => {
    const ydoc = new Y.Doc();
    (api.post as any).mockResolvedValueOnce({
      attachmentId: 'att-1234',
      fileName: 'architecture_diagram.png',
      fileSize: 45000,
      mimeType: 'image/png',
      scanStatus: 'clean',
      url: '/api/v1/attachments/att-1234',
    });

    render(
      <CollaborativeEditor
        ydoc={ydoc}
        postId="test-post-1"
        user={{ name: 'Lead Architect', color: '#2F57C8', role: 'author' }}
      />
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const validFile = new File(['fake-png-bytes'], 'architecture_diagram.png', {
      type: 'image/png',
    });

    fireEvent.change(fileInput, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/posts/test-post-1/attachments',
        expect.any(FormData)
      );
    });

    ydoc.destroy();
  });
});
