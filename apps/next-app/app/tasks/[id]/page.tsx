import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/bits';
import { TaskDetailView } from '@/components/views/TaskDetailView';

export const metadata: Metadata = { title: 'Task' };

export default function TaskDetailPage() {
  // Tasks live in localStorage, so the id is resolved on the client (useParams).
  return (
    <Suspense fallback={<PageSkeleton title="Task" rows={4} />}>
      <TaskDetailView />
    </Suspense>
  );
}
