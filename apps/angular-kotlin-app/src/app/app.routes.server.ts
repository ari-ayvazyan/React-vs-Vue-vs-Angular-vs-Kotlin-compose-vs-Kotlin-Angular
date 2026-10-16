import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * All routes are server-rendered on demand: the shell is rendered on the server while
 * localStorage-backed data is loaded on the client after hydration.
 */
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
