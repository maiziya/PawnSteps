import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  projects: [{
    name: 'desktop-webkit',
    testMatch: '**/course-selection.spec.ts',
    use: { ...devices['Desktop Safari'], viewport: { width: 1366, height: 900 } },
  }],
});
