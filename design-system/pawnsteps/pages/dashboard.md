# PawnSteps application design

This application override refines the generated MASTER.md after the required ui-ux-pro-max searches for Organic Biophilic and Nature Distilled.

## Visual direction

A quiet daily workspace with the warmth of a paper planner. Cream canvas, warm white surfaces, terracotta actions, olive success accents. Use a compact left navigation on desktop, a single content column with a small right-hand daily summary, and bottom navigation on mobile. Give the primary task interaction more visual weight than decorative metrics.

## Tokens

Light: background #F6F3EC; surface #FFFEFA; text #302E29; muted #747066; border #E5E0D5; primary #A94D30; primary-hover #913D24; success #4E6541; accent #EBCB88.

Dark: background #1D201C; surface #272B25; text #F0EEE5; muted #B2B5A9; border #41473B; primary #EFAD8F; primary foreground #352119; success #B1C59D; accent #EBCB88.

Typography: system humanist sans stack, PingFang SC and Microsoft YaHei for Chinese. Numbers use tabular figures. Headings 28–36 px; body 14–16 px; no text below 12 px. Avoid remote font runtime dependency.

## Interaction

Use lucide icons exclusively. Soft 18–22 px corners for task surfaces; small consistent shadows. Real range input for progress: preview while dragging and submit on pointer release or keyboard release. Visible focus, labelled icon buttons, minimum 44 px touch targets. Forms use labelled fields, inline validation, clear disabled/loading states. Dialogs use Radix focus management.

Completion animates the check mark and progress; reward reveals use a short staggered reveal with a synthesised chord. Respect reduced motion. No decorative infinite animation. No artificial metrics or example tasks inserted into real user data.

## Layout checks

Verify 375, 768, 1024, 1440 px, dark theme, keyboard navigation, error and empty states. Left navigation collapses on small screens; task cards retain their full interaction area. Course selection rectangle applies only to fine mouse pointers, with checkboxes available to all input methods.

The API stays independent of Next.js. The skill's generic Server Actions preference does not apply because this project explicitly requires FastAPI and REST mutations.
