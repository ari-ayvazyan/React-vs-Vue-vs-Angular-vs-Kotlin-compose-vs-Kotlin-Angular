import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/bits';
import { BoardView } from '@/components/views/BoardView';

export const metadata: Metadata = { title: 'Board' };

export default function BoardPage() {
  // BoardView reads its filters from the query string (useSearchParams) → needs a Suspense boundary.
  return (
    <Suspense fallback={<PageSkeleton title="Board" rows={3} />}>
      <BoardView />
    </Suspense>
  );
}
