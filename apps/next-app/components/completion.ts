'use client';

import { useCallback } from 'react';
import { blockedCompletions, blockedMessage } from '@/lib/dependencies';
import { getStore } from './store-hooks';
import { useToast } from './toast';

/**
 * Returns a checker used by every "mark done" path (list toggle, bulk action, board drag and
 * keyboard move, detail page, edit forms). It reports refused completions in an error toast
 * naming the blockers, and returns the ids that may be completed. The reducer enforces the same
 * rule, so this is about explaining, not about correctness.
 */
export function useCompletionGuard() {
  const toast = useToast();
  return useCallback(
    (ids: string[]): string[] => {
      const blocked = blockedCompletions(getStore().getSnapshot().state.tasks, ids);
      if (!blocked.length) return ids;
      toast(blockedMessage(blocked), { tone: 'error', duration: 7000 });
      const refused = new Set(blocked.map((b) => b.task.id));
      return ids.filter((id) => !refused.has(id));
    },
    [toast],
  );
}
