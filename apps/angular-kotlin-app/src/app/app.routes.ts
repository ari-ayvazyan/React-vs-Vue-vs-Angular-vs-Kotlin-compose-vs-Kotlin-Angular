import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    title: 'Dashboard · TaskPilot',
    loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardPage),
  },
  {
    path: 'tasks',
    title: 'Tasks · TaskPilot',
    loadComponent: () => import('./pages/tasks/tasks').then((m) => m.TasksPage),
  },
  {
    path: 'tasks/:id',
    title: 'Task · TaskPilot',
    loadComponent: () => import('./pages/task-detail/task-detail').then((m) => m.TaskDetailPage),
  },
  {
    path: 'board',
    title: 'Board · TaskPilot',
    loadComponent: () => import('./pages/board/board').then((m) => m.BoardPage),
  },
  {
    path: 'calendar',
    title: 'Calendar · TaskPilot',
    loadComponent: () => import('./pages/calendar/calendar').then((m) => m.CalendarPage),
  },
  {
    path: 'projects',
    title: 'Projects · TaskPilot',
    loadComponent: () => import('./pages/projects/projects').then((m) => m.ProjectsPage),
  },
  {
    path: 'timeline',
    title: 'Timeline · TaskPilot',
    loadComponent: () => import('./pages/timeline/timeline').then((m) => m.TimelinePage),
  },
  {
    path: 'reports',
    title: 'Reports · TaskPilot',
    loadComponent: () => import('./pages/reports/reports').then((m) => m.ReportsPage),
  },
  {
    path: 'activity',
    title: 'Activity · TaskPilot',
    loadComponent: () => import('./pages/activity/activity').then((m) => m.ActivityPage),
  },
  {
    path: 'settings',
    title: 'Settings · TaskPilot',
    loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsPage),
  },
  {
    path: '**',
    title: 'Not found · TaskPilot',
    loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFoundPage),
  },
];
