# PawnSteps application design

This application override refines the generated MASTER.md after the required ui-ux-pro-max searches for Organic Biophilic and Nature Distilled.

## Visual direction

A quiet daily workspace with the warmth of a paper planner. Cream canvas, warm white surfaces, terracotta actions, olive success accents. Use a compact left navigation on desktop, a full-width task column, and bottom navigation on mobile. Task progress controls are the primary content of the first screen.

## Information hierarchy

The sticky header combines the page title, date, search and create action with a compact statistics strip. Keep all four statistics visible while scrolling. When tasks exist, a single 48–60 px summary presents daily completion, streak and the next milestone on every viewport, followed directly by filters and tasks.

The desktop navigation rail is flush with the viewport edges and spans its height, separated by one right border. Brand and navigation stay at the top; theme, audio, help and account actions form a bottom-anchored group. Leave at least 20 px between the groups. On short screens, preserve control sizes and let the rail scroll. Avoid floating short sidebars and decorative slogans; mobile retains its bottom navigation.

Header, body and footer share a maximum width of 1160 px and the same gutters. The shell owns the footer: it sits at the viewport bottom on short pages and follows the content on long pages. For a truly empty task list, hide search, filters and daily summary while preserving top statistics. Show an unboxed, 640 px-wide start section with four functional task-type entry rows. Opening a row selects the corresponding creation form without adding sample data. A failed load must show its error instead of a false empty state; search/filter no-match remains a separate state.

Task cards have two rows: title, readable priority and actions; then a non-draggable progress bar with −1/+1/+5 step controls and a history action. Target approximately 120 px on desktop; on mobile, put the progress meter above a row of 44 px shortcut buttons while keeping the first task fully visible. Descriptions and reward details expand on demand. Editing and deletion live in a keyboard-accessible menu; preserve a dedicated drag handle and 44 px controls.

Completed tasks remain at the bottom and start collapsed. Selecting the completed filter expands them. Course cards show aggregate progress and a continue action; details open in a right-side drawer on desktop and a full-screen dialog on mobile. Inside it, expand the first incomplete group by default and preserve checkbox and mouse-marquee interactions. A mouse drag can start on lesson text or blank space; preserve ordinary clicks with a movement threshold and suppress the click after a drag. Mixed selections complete, fully completed selections clear, and Shift-drag explicitly clears. Support edge auto-scroll and Escape cancellation. Completed lessons and chapters use success background/text/check states, reverting after cancellation. Keep touch interactions as taps and scrolling. Normalize numeric pipe suffixes in imported titles and clean legacy titles for display without rewriting stored completion. Completing a course must not close the drawer. Closing it returns keyboard focus to a visible list control.

At 1366×768, the first card should begin within 240 px and at least three normal task cards must be fully operable without scrolling. At 375×812, at least one full card and the following title must fit above the bottom navigation. Do not replace the document's natural scrolling with nested list scroll areas.

## Tokens

Light: background #F6F3EC; surface #FFFEFA; text #302E29; muted #747066; border #E5E0D5; primary #A94D30; primary-hover #913D24; success #4E6541; accent #EBCB88.

Dark: background #1D201C; surface #272B25; text #F0EEE5; muted #B2B5A9; border #41473B; primary #EFAD8F; primary foreground #352119; success #B1C59D; accent #EBCB88.

Typography: system humanist sans stack, PingFang SC and Microsoft YaHei for Chinese. Numbers use tabular figures. Workspace heading 18–22 px; task titles 15–16 px; body 14–16 px; metadata 12 px. Avoid remote font runtime dependency.

## Interaction

Use lucide icons exclusively. Soft 18–22 px corners for task surfaces; small consistent shadows. Progress has no slider or thumb. +1/+5 each create one dated record and immediately preview the increase. −1 corrects the latest valid record, restricted to today for daily and plan tasks; canonical task totals remain server-derived. Zero-value decrement is disabled. Show an undo notice only when the entire task finishes; it revokes the exact finishing record, not the whole history, and remains accessible in a matching reward dialog. Daily and active-plan meters prioritize today's quota, with overall progress in metadata. Confirm a successful save with a brief +quantity label; rollback failed previews, retaining the same request ID for a confirmation retry. Hold a newly completed card for about one second to show its full bar before moving it into the completed section or opening a reward reveal. Respect reduced motion. History remains available for other quantities, notes, edits and revocation; keep that dialog open after completion. Composite search fields receive one outer focus ring through focus-within while retaining keyboard focus indication on their clear buttons. Visible focus, labelled icon buttons, minimum 44 px touch targets. Forms use labelled fields, inline validation, clear disabled/loading states. Dialogs use Radix focus management.

Completion animates the check mark and progress; reward reveals use a short staggered reveal with a synthesised chord. Respect reduced motion. No decorative infinite animation. No artificial metrics or example tasks inserted into real user data.

## Layout checks

Verify 375, 768, 1024, 1440 px, dark theme, keyboard navigation, error and empty states. Left navigation collapses on small screens; task cards retain their full interaction area. Course selection rectangle applies only to fine mouse pointers, with checkboxes available to all input methods.

The API stays independent of Next.js. The skill's generic Server Actions preference does not apply because this project explicitly requires FastAPI and REST mutations.

## Drag release

Apply the desired unfinished-task order locally in the same drop event, then persist it. Keep that order while the request is pending; roll back to canonical data only if saving fails. Do not wait for the response before repositioning cards, which causes a return to the old slot and a second jump. Preserve keyboard focus after saving. The existing card animation can remain: delayed ordering, not overlapping layout animation, was the reproduced cause.
