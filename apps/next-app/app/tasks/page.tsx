import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/bits';
import { TasksView } from '@/components/views/TasksView';

export const metadata: Metadata = { title: 'Tasks' };

export default function TasksPage() {
  // TasksView reads the query string (useSearchParams), which is only known in the browser
  // for this prerendered route, so it needs a Suspense boundary.
  return (
    <Suspense fallback={<PageSkeleton title="Tasks" />}>
      <TasksView />
    </Suspense>
  );
}
