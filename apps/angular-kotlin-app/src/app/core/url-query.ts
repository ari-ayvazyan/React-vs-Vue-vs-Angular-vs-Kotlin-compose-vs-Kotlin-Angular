import { inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

/** Signal of the current URL's query string (including "?"), updated on every navigation. */
export function injectQueryString() {
  const router = inject(Router);
  const qs = (url: string) => (url.includes('?') ? url.slice(url.indexOf('?')) : '');
  return toSignal(
    router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => qs(e.urlAfterRedirects)),
    ),
    { initialValue: qs(router.url) },
  );
}
