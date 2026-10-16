'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { ACTIVITY_PAGE_SIZE, NO_ACTOR, activityQueryToSearch, filterActivity, parseActivityQuery, type ActivityQuery } from '@/lib/activity';
import { paginate } from '@/lib/filters';
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABEL } from '@/lib/types';
import { PageSkeleton } from '../bits';
import { IconActivity, IconChevronLeft, IconChevronRight, IconX } from '../icons';
import { useAppState } from '../store-hooks';
import { ActivityLine, lookupFor } from './TaskCollab';
import styles from './activity.module.css';

function navigate(query: ActivityQuery) {
  window.history.pushState(null, '', `/activity${activityQueryToSearch(query)}`);
}

export function ActivityView() {
  const state = useAppState();
  const params = useSearchParams();
  const query = useMemo(() => parseActivityQuery(params), [params]);
  const activity = state?.activity;
  const filtered = useMemo(() => (activity ? filterActivity(activity, query) : []), [activity, query]);
  const lookup = useMemo(() => (state ? lookupFor(state) : null), [state]);

  if (!state || !lookup) return <PageSkeleton title="Activity" />;

  const page = paginate(filtered, query.page, ACTIVITY_PAGE_SIZE);
  const set = (patch: Partial<ActivityQuery>) => navigate({ ...query, page: 1, ...patch });
  const first = page.total ? (page.page - 1) * ACTIVITY_PAGE_SIZE + 1 : 0;
  const last = Math.min(page.page * ACTIVITY_PAGE_SIZE, page.total);
  const filtering = query.actor !== null || query.type !== null;

  return (
    <div className={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Activity</h1>
          <p className="page-subtitle" aria-live="polite">
            {filtering ? `${page.total} of ${state.activity.length} changes match` : `${state.activity.length} recorded changes`}
          </p>
        </div>
      </div>

      <section className={`card ${styles.toolbar}`} aria-label="Filter activity">
        <div className="field">
          <label htmlFor="activity-actor" className="label">
            Member
          </label>
          <select
            id="activity-actor"
            className="select"
            value={query.actor ?? ''}
            onChange={(e) => set({ actor: e.target.value || null })}
            data-testid="activity-filter-member"
          >
            <option value="">Everyone</option>
            {state.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value={NO_ACTOR}>No author</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="activity-type" className="label">
            Type
          </label>
          <select
            id="activity-type"
            className="select"
            value={query.type ?? ''}
            onChange={(e) => set({ type: (e.target.value || null) as ActivityQuery['type'] })}
            data-testid="activity-filter-type"
          >
            <option value="">All types</option>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACTIVITY_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        {filtering && (
          <button type="button" className={`btn btn-ghost btn-sm ${styles.clear}`} onClick={() => navigate({ actor: null, type: null, page: 1 })}>
            <IconX size={14} /> Clear filters
          </button>
        )}
      </section>

      <div className="card">
        {page.items.length ? (
          <ol className={styles.list} aria-label="Activity, newest first">
            {page.items.map((e) => (
              <li key={e.id} className={styles.row} data-testid="activity-row">
                <ActivityLine entry={e} lookup={lookup} showTask />
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty">
            <IconActivity size={26} />
            <strong>{filtering ? 'No matching activity' : 'No activity yet'}</strong>
            <span>{filtering ? 'Try another member or type.' : 'Changes to tasks will be listed here, newest first.'}</span>
          </div>
        )}
      </div>

      <nav className={styles.pagination} aria-label="Pagination">
        <span className="muted">{page.total ? `Showing ${first}–${last} of ${page.total}` : 'No results'}</span>
        <div className={styles.pageButtons}>
          <button type="button" className="btn btn-sm" onClick={() => navigate({ ...query, page: page.page - 1 })} disabled={page.page <= 1}>
            <IconChevronLeft size={15} /> Prev
          </button>
          <span className={styles.pageInfo}>
            Page {page.page} of {page.pageCount}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => navigate({ ...query, page: page.page + 1 })}
            disabled={page.page >= page.pageCount}
            data-testid="activity-next"
          >
            Next <IconChevronRight size={15} />
          </button>
        </div>
      </nav>
    </div>
  );
}
