import { TestBed } from '@angular/core/testing';
import { TaskForm } from './task-form';
import { StoreService } from '../services/store.service';

describe('TaskForm component', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.inject(StoreService).init(5);
  });

  it('shows an inline error when submitting without a title, then creates the task', async () => {
    const fixture = TestBed.createComponent(TaskForm);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const store = TestBed.inject(StoreService);
    let saved = 0;
    fixture.componentInstance.saved.subscribe(() => saved++);

    el.querySelector<HTMLButtonElement>('[data-testid="task-save-button"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Title is required');
    expect(saved).toBe(0);

    const input = el.querySelector<HTMLInputElement>('[data-testid="task-title-input"]')!;
    input.value = 'Write tests';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('[data-testid="task-save-button"]')!.click();
    await fixture.whenStable();
    expect(saved).toBe(1);
    expect(store.tasks()[0].title).toBe('Write tests');
  });

  it('saves the selected assignee and repeat interval', async () => {
    const fixture = TestBed.createComponent(TaskForm);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const store = TestBed.inject(StoreService);

    const options = [...el.querySelectorAll('[data-testid="task-assignee-select"] option')];
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Unassigned',
      'Alex Kim',
      'Sam Rivera',
      'Jordan Lee',
      'Taylor Brooks',
      'Morgan Patel',
    ]);
    const title = el.querySelector<HTMLInputElement>('[data-testid="task-title-input"]')!;
    title.value = 'Standup';
    title.dispatchEvent(new Event('input'));
    const assignee = el.querySelector<HTMLSelectElement>('[data-testid="task-assignee-select"]')!;
    assignee.value = 'm3';
    assignee.dispatchEvent(new Event('change'));
    const repeat = el.querySelector<HTMLSelectElement>('[data-testid="task-recurrence-select"]')!;
    repeat.value = 'daily';
    repeat.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('[data-testid="task-save-button"]')!.click();
    await fixture.whenStable();
    expect(store.tasks()[0]).toMatchObject({
      title: 'Standup',
      assigneeId: 'm3',
      recurrence: 'daily',
    });
  });
});
