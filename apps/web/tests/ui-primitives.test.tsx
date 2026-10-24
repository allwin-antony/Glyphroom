import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Button } from '../src/components/ui/button.js';
import { Badge } from '../src/components/ui/badge.js';
import { Input } from '../src/components/ui/input.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../src/components/ui/tabs.js';
import { Avatar, AvatarFallback } from '../src/components/ui/avatar.js';

describe('Accessible UI Primitives Suite', () => {
  it('renders Button with variants and respects disabled state', () => {
    const { rerender } = render(<Button variant="default">Primary CTA</Button>);
    const btn = screen.getByRole('button', { name: 'Primary CTA' });
    expect(btn).toBeDefined();
    expect(btn.className).toContain('bg-primary');

    rerender(<Button variant="destructive" disabled>Delete</Button>);
    const delBtn = screen.getByRole('button', { name: 'Delete' });
    expect(delBtn.className).toContain('bg-destructive');
    expect((delBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders Badge with enterprise lifecycle variants', () => {
    render(<Badge variant="in_review">In Review</Badge>);
    const badge = screen.getByText('In Review');
    expect(badge.className).toContain('bg-amber-50');
    expect(badge.className).toContain('text-amber-700');
  });

  it('renders Input with Slate border and focus ring', () => {
    render(<Input placeholder="Search posts..." />);
    const input = screen.getByPlaceholderText('Search posts...');
    expect(input.className).toContain('border-input');
    expect(input.className).toContain('focus-visible:ring-ring');
  });

  it('renders Tabs accessible ARIA attributes', () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">First</TabsTrigger>
          <TabsTrigger value="tab2">Second</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>
    );
    expect(screen.getByRole('tab', { name: 'First' })).toBeDefined();
    expect(screen.getByText('Content 1')).toBeDefined();
  });

  it('renders Avatar with fallback initials', () => {
    render(
      <Avatar>
        <AvatarFallback>AD</AvatarFallback>
      </Avatar>
    );
    expect(screen.getByText('AD')).toBeDefined();
  });
});
