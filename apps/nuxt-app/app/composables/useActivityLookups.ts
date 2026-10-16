import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import type { ActivityLookups } from '~/lib/activity';
import { knownTaskTitles } from '~/lib/activity';
import { commentToText } from '~/lib/mentions';
import { CATEGORY_LABELS } from '~/lib/workflows';
import type { Status } from '~/lib/types';
import { useTaskStore } from '~/stores/tasks';

/** Lookups used to render activity entries (member/project names, titles of deleted tasks, comment text). */
export function useActivityLookups(): ComputedRef<ActivityLookups> {
  const store = useTaskStore();
  const titles = computed(() => knownTaskTitles(store.tasks, store.activity));
  return computed<ActivityLookups>(() => ({
    members: store.memberById,
    projects: store.projectById,
    taskTitle: (id) => titles.value.get(id) ?? null,
    commentText: (body) => commentToText(body, store.members),
    statusName: (taskId, statusId) => {
      const t = store.taskById.get(taskId);
      const own = store.workflows.statusOf(t?.projectId ?? null, statusId);
      if (own) return own.name;
      // status of another (or a since edited) workflow: search all workflows, then fall back to the category label
      for (const p of store.projects) {
        const s = p.workflow?.find((x) => x.id === statusId);
        if (s) return s.name;
      }
      return CATEGORY_LABELS[statusId as Status] ?? statusId;
    },
  }));
}
