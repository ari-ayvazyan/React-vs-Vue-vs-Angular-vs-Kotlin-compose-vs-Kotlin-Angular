import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * All data lives in localStorage, so the server renders the app shell + skeletons.
 * Server (not prerender) mode is used so query-string driven UI (filters on /tasks)
 * renders identically on server and client during hydration.
 */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Server },
  { path: 'dashboard', renderMode: RenderMode.Server },
  { path: 'tasks', renderMode: RenderMode.Server },
  { path: 'tasks/:id', renderMode: RenderMode.Server },
  { path: 'board', renderMode: RenderMode.Server },
  { path: 'calendar', renderMode: RenderMode.Server },
  { path: 'projects', renderMode: RenderMode.Server },
  { path: 'timeline', renderMode: RenderMode.Server },
  { path: 'reports', renderMode: RenderMode.Server },
  { path: 'activity', renderMode: RenderMode.Server },
  { path: 'settings', renderMode: RenderMode.Server },
  { path: '**', renderMode: RenderMode.Server, status: 404 },
];
