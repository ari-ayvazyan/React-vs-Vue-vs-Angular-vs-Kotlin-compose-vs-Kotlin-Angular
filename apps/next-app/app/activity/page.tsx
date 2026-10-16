import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/bits';
import { ActivityView } from '@/components/views/ActivityView';

export const metadata: Metadata = { title: 'Activity' };

export default function ActivityPage() {
  // ActivityView reads its filters from the query string (useSearchParams) → needs a Suspense boundary.
  return (
    <Suspense fallback={<PageSkeleton title="Activity" />}>
      <ActivityView />
    </Suspense>
  );
}
