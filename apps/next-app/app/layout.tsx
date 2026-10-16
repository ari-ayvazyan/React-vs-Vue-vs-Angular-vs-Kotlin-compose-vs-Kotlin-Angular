import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
// Global styles first so CSS-module rules (loaded with the components below) win on equal specificity.
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: { default: 'TaskPilot', template: '%s · TaskPilot' },
  description: 'TaskPilot — plan, track and finish your work.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1017' },
  ],
};

/**
 * Runs before first paint: resolves the persisted theme (stored inside taskpilot:v2, or v1 before migration) and the
 * sidebar preference so there is no flash of the wrong theme. React never touches these attributes
 * during hydration (suppressHydrationWarning on <html>).
 */
const PREPAINT_SCRIPT = `(function(){var d=document.documentElement;try{var t='system';var raw=localStorage.getItem('taskpilot:v2')||localStorage.getItem('taskpilot:v1');if(raw){var s=JSON.parse(raw);if(s&&s.settings&&s.settings.theme)t=s.settings.theme;}if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}d.setAttribute('data-theme',t);var ui=JSON.parse(localStorage.getItem('taskpilot:ui')||'{}');if(ui.sidebarCollapsed)d.setAttribute('data-sidebar','collapsed');}catch(e){d.setAttribute('data-theme',window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREPAINT_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
