import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  projects: [{
    name: 'desktop-webkit',
    testMatch: ['**/focus.spec.ts', '**/course-selection.spec.ts', '**/course-daily-plan.spec.ts', '**/schedules.spec.ts'],
    use: { ...devices['Desktop Safari'], viewport: { width: 1366, height: 900 } },
  }],
});
