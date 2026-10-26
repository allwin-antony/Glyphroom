import React from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout.js';
import { ProtectedRoute } from './components/auth/ProtectedRoute.js';

// Views
import { SignInView } from './views/SignInView.js';
import { HomeView } from './views/HomeView.js';
import { CatalogView } from './views/CatalogView.js';
import { MyWorkView } from './views/MyWorkView.js';
import { NewPostView } from './views/NewPostView.js';
import { EditorView } from './views/EditorView.js';
import { ReaderView } from './views/ReaderView.js';
import { ReviewQueueView } from './views/ReviewQueueView.js';
import { AdminView } from './views/AdminView.js';
import { SpaceView } from './views/SpaceView.js';
import { SettingsView } from './views/SettingsView.js';
import { BookmarksView } from './views/BookmarksView.js';
import { NotFoundView } from './views/NotFoundView.js';

export const router = createBrowserRouter([
  {
    path: '/sign-in',
    element: <SignInView />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <HomeView />,
      },
      {
        path: 'catalog',
        element: <CatalogView />,
      },
      {
        path: 'my-work',
        element: <MyWorkView />,
      },
      {
        path: 'bookmarks',
        element: <BookmarksView />,
      },
      {
        path: 'posts/new',
        element: <NewPostView />,
      },
      {
        path: 'posts/:id/edit',
        element: <EditorView />,
      },
      {
        path: 'posts/:slug',
        element: <ReaderView />,
      },
      {
        path: 'reviews',
        element: (
          <ProtectedRoute allowedRoles={['moderator', 'admin']}>
            <ReviewQueueView />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminView />
          </ProtectedRoute>
        ),
      },
      {
        path: 'spaces/:idOrSlug',
        element: <SpaceView />,
      },
      {
        path: 'settings',
        element: <SettingsView />,
      },
      {
        path: '*',
        element: <NotFoundView />,
      },
    ],
  },
]);
