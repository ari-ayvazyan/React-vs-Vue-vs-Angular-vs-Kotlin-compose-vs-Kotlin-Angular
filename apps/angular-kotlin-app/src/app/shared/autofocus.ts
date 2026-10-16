import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/** Focuses (and selects) the host element once it is rendered in the browser. */
@Directive({ selector: '[appAutofocus]' })
export class Autofocus {
  constructor() {
    const el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      el.focus();
      el.select?.();
    });
  }
}
