import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <div className="card empty" style={{ marginTop: 48, padding: '56px 24px' }}>
      <p style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--accent)' }}>404</p>
      <h1 className="page-title">Page not found</h1>
      <p>The page you are looking for doesn’t exist or has been moved.</p>
      <Link href="/dashboard" className="btn btn-primary" style={{ marginTop: 12 }}>
        Go to dashboard
      </Link>
    </div>
  );
}
