import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  projects: [{
    name: 'desktop-webkit',
    testMatch: ['**/drag-axis.spec.ts', '**/day-plan.spec.ts', '**/focus-fullscreen.spec.ts', '**/review.spec.ts', '**/focus.spec.ts', '**/course-selection.spec.ts', '**/course-daily-plan.spec.ts', '**/schedules.spec.ts'],
    use: { ...devices['Desktop Safari'], viewport: { width: 1366, height: 900 } },
  }],
});
