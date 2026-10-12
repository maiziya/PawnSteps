# PawnSteps API

The API is version-independent REST under `/api`. Next.js forwards this prefix to FastAPI. OpenAPI is available at `/api/docs` in development.

Each request carries either `Authorization: Bearer <jwt>` or `X-Guest-Id: <uuid>`. The server derives the owner identifier; clients never submit `owner_id`. Every owner-scoped resource lookup checks both owner and resource ID.

All successful application mutations return a snapshot:

```typescript
interface MutationResponse {
  today: string;
  timezone: string;
  tasks: Task[];
  rewards: Reward[];
  stats: {
    total: number;
    completed: number;
    in_progress: number;
    xp: number;
    streak: number;
    today_completed: number;
    today_total: number;
  };
  unlocked_reward: Reward | null;
  undo_token?: string | null;
  record?: ProgressRecord | null;
}
```

Authentication, uploads, and profile mutations extend the snapshot with their specific result, such as `access_token`, `user`, or `image_url`. A client replaces its tracking state from each response rather than issuing follow-up requests.

| Method | Path | Body or purpose |
| --- | --- | --- |
| GET | `/state`, `/tasks`, `/rewards` | Complete snapshot with daily rollover and milestone evaluation |
| POST | `/tasks` | `name`, `description`, `target`, `unit`, `priority`, `reward_id`, optional `daily_quota`, `daily_plan`, `plan_start_date`, `course_items` |
| PATCH | `/tasks/{id}` | Editable metadata including `unit`, ordinary/daily `target`, existing daily-task `daily_quota` |
| GET | `/tasks/{id}/records?offset=0&limit=50` | Active history page: `{records, total, offset, limit}` |
| POST | `/tasks/{id}/records` | `{amount: integer, note?: string, request_id?: uuid}`; record today's actual completed quantity |
| POST | `/tasks/{id}/decrement` | `{request_id: uuid}`; atomically reduce the latest applicable record by exactly one |
| PATCH | `/tasks/{id}/records/{record_id}` | `{amount?: integer, note?: string}`; correct an existing record without changing its date |
| DELETE | `/tasks/{id}/records/{record_id}` | Revoke a record and recalculate derived progress; response includes its tombstone |
| POST | `/tasks/{id}/course` | `{indices: integer[], done: boolean}` |
| POST | `/tasks/reorder` | `{ids: uuid[]}` containing every unfinished task once |
| DELETE | `/tasks/{id}` | Soft deletion, returning `undo_token` |
| POST | `/tasks/undo` | `{token: string}` within five seconds |
| POST | `/rewards` | `{name: string, image_url?: string}` |
| PATCH | `/rewards/{id}` | `name`, `image_url`, `is_unlocked` |
| DELETE | `/rewards/{id}` | Delete a custom reward and clear its task associations |
| POST | `/rewards/reorder` | `{ids: uuid[]}` containing all rewards once |
| GET | `/history?month=YYYY-MM` | `{history: [{task_id, task_name, date, completed, amount, unit, task_kind, quota}], streak}` |

Task type is inferred from its data. A course has `course_items`; a plan has `daily_plan`; a recurring daily task has a positive `daily_quota`; otherwise the task is ordinary. Course and plan types are immutable. Plan and course targets are calculated by the server. Course folder markers end with `/` and are excluded from both target and progress.

Progress is derived from active records. Ordinary progress is the sum capped at the task target. Task snapshots also expose `total_amount`: the uncapped sum of active recorded quantities dated on or before the application date, including undated legacy baselines. Courses report their completed real-item count. Ordinary task cards and record summaries display `total_amount / target`; bar fill, completion and XP still use capped `progress`. Editing or revoking a record recalculates both fields, and backfilled work does not change `today_amount`. Daily progress counts completed days: any number of entries may contribute to one day, and reaching its quota contributes exactly one completed day. Plan progress counts actual quota units capped per scheduled day. Positive plan quotas define the target; zero and minus one mark automatic rest days. Once a plan ends it has `is_done=true` and `plan_expired=true`, while progress retains its actual contributions rather than being filled to the target. An all-rest plan completes on its last rest day. Future, expired and rest-day plans cannot accept new numeric records. Courses continue to use their checklist and reject numeric records.

`Task` adds `unit`, `today_amount` (the uncapped actual quantity today), `record_count` (active entries), and `plan_expired`. New quantities are integers from 1 through 1000000; notes are at most 200 characters. Record dates come from the server's business date. Clients cannot submit `date` or `source` or change the date during edits. Historical edits and revocations rebuild the task, daily history, streak and XP. Completed custom rewards remain awarded. Each daily history row freezes its quota; changing a daily quota updates today's threshold without rewriting earlier days.

Every record mutation returns the full snapshot plus the changed `record`, so clients can update both the dashboard and their open history without another read. Record pages contain active entries sorted by date and creation time, with unknown-date legacy baselines last. Deletion retains a tombstone internally, and account exports include all records including revoked ones. Send a stable `request_id` for retries: the same task/request/payload returns its prior result without incrementing progress, including after the entry was edited or revoked. Reusing a request ID with a different initial payload returns 409.

The former POST `/tasks/{id}/progress`, `/daily`, and `/daily/undo` endpoints now return 410 for owned tasks. Clients must migrate to the record endpoints; there is no second writable total-progress field.

`TIMEZONE` determines the application date. Snapshot reads reset stale daily fields and restore the current date's persisted history. A `(task_id, date)` history key ensures one achievement per day, while `(task_id, request_id)` prevents record retries from being counted twice. For daily schedules, a streak starts at the current application date and stops at the first date without completed daily history. Flexible schedules use dated obligations to distinguish rest dates from missed work. Daily tasks qualify at their minimum quantity (`daily_quota`); plans use their dated quota, with rest days automatically completed. Partial progress is visible in the calendar but does not count toward streaks.

Six milestone rewards are created idempotently at 3, 7, 14, 30, 60, and 100 consecutive days. Their first automatic achievement is retained in `streak_claimed`, so a later manual lock stays locked. Associated custom rewards unlock when a task transitions to completed; reopening and completing the task again is a new unlock event. Milestone rewards cannot be deleted.

Deleted tasks and their history are hidden immediately. Undo tokens are random, single-use, owner-bound, and expire after five seconds. Expired rows and their history are physically removed during a subsequent snapshot. The unique task name remains reserved during the undo window.

Production mutations serialize through PostgreSQL owner row locks. The development SQLite server also uses per-owner asynchronous locks. Multi-owner account migration acquires owners in sorted order. Production should use PostgreSQL for multiple processes or replicas.

## Existing-data migration

Revision `cf42d17b8e91` adds record storage and backfills existing progress without clearing tasks. An ordinary task's old aggregate becomes a `source=legacy` baseline with `date=null`; it is never falsely attributed to the upgrade day. Dated daily and plan history becomes dated legacy records. Completed historical daily rows preserve the achieved quota inferred from their previous capped progress. Earlier incomplete rows did not store their exact quota, so migration preserves the incomplete status using the existing quota and recorded quantity. These legacy entries are visibly labelled and remain correctable.

Back up the database before upgrading. Apply `alembic upgrade head` before starting the new API/frontend together. The upgrade changes the direct-progress write contract and should be deployed as a coordinated release.

## One-unit correction

`POST /tasks/{id}/decrement` requires a request UUID and returns HTTP 200 with the normal snapshot and the affected `record`. Ordinary tasks select the latest active record; daily and plan tasks select only today. A remaining amount above one is reduced; an amount of one is soft-revoked. Zero progress and inactive/rest/expired plans reject new corrections. Courses retain checklist controls.

Revision `8d3619a56e20` adds internal `progress_adjustments` receipts. Replaying the same task/request UUID confirms the original correction without subtracting again, even if the affected record was subsequently changed or revoked. Create-record and decrement UUIDs may not be reused across operations. Receipts cascade with their task and record; exports continue to contain the resulting records and tombstones.

Calendar activity aggregates active quantities by task and date. Clients display entries with `amount > 0`, including partial daily work. `completed` retains achievement status, while `quota` is the dated daily threshold when applicable. Course items gain server-managed `done_date` in their JSON data on a new check; repeat checks preserve it and unchecking clears it. Existing checked items without a known date stay undated. Calendar quantities, activity dots and streaks reflect corrections and revocations.

Ordinary and course tasks also accept `daily_minimum` (0 disables it for legacy/API clients; otherwise 1–10000 and no greater than `target`). The creation UI defaults it to 1. This field qualifies daily history and streaks without changing task kind: total `progress` still sums quantities, and `daily_quota` remains 0. Editing the minimum updates today's threshold, preserves dated historical thresholds, and does not fabricate achievements for earlier untracked dates. Revision `b6317af29d08` adds the field with a zero default so existing goals keep their prior behavior until edited.

Ordinary, daily and course tasks accept `daily_goal` (1–10000), an aspirational daily quantity separate from the qualifying minimum. It cannot be lower than `daily_minimum` (ordinary) or `daily_quota` (daily); ordinary and course goals also cap it at the cumulative `target`. Revision `c8451d92a307` adds a nullable column, with legacy display falling back to the qualifying minimum. Raising this goal does not revoke a check-in already earned by meeting the minimum. The UI shows today's amount / daily goal on cards, with the minimum available in task details; ordinary task bars retain cumulative progress. Daily task bars use the daily goal.

### Course daily plans

Course creation and edits accept `daily_minimum` and `daily_goal`, measured in lessons. Validate against the number of actual items, excluding folders; the goal must be at least the minimum and no greater than the course size. `target` stays derived from imported lessons and cannot be edited directly. New courses use the unit `节`.

Daily achievement is projected from active course items with a server-managed `done_date`. Repeated checks do not add work; unchecking removes that lesson from its original day and recomputes history/streaks. Minimum edits affect today's threshold, preserving older thresholds. Undated legacy checks retain total progress without inventing historical check-ins. Existing courses have no daily plan until enabled. Disable a course daily plan with `daily_minimum: 0, daily_goal: null`; its lesson completion is retained. No new migration is needed because the existing daily-goal/minimum fields and daily-history table are reused.

### Flexible schedules

Tasks accept `schedule: {mode: "daily" | "weekdays" | "weekly", weekdays: number[], weekly_target: number | null}`. Weekdays use Monday=0 through Sunday=6 and must be unique/nonempty in weekday mode. Weekly mode requires 1–7 qualifying days; other modes omit the weekly target. Flexible schedules require a daily minimum and cannot override an explicit `daily_plan` array.

`Task` adds `schedule`, `is_scheduled_today`, `weekly_completed` and effective `weekly_target`. Weekly counts use distinct achieved days, Monday through Sunday. The first partial week (including a schedule changed midweek) starts at its effective date and caps the requirement to the remaining days. Schedule changes take effect today; `task_schedules` retains dated configuration/enabled versions and exports include `schedule_history`.

Streaks count actual achieved dates. Non-required weekdays and unfinished weekly windows can bridge a streak without incrementing it; a weekly deficit breaks continuity at Sunday's deadline. A separate due task still requires a check-in on that date. Existing day-by-day plans retain automatic rest-day achievement. Optional work on a rest day remains recordable and can qualify. `/history` adds `rest_dates`, which describes dates with active tasks but no outstanding scheduled obligation.


Desktop notification functionality has been removed. Revision `e25c61498b3a` and the unused `reminder_deliveries` table remain for compatibility with installations that already applied the published migration. No reminder endpoints or browser notification triggers are active.


## Task stages

Task creation and editing accept optional `stages: [{value: integer, name?: string}]`. Up to six distinct positive nodes may be configured; the server sorts them ascending. Values cannot exceed the effective total target (ordinary quantities, daily achievement days, plan positive quota sum or real course item count). Names are trimmed and limited to 40 characters. Omitted creation stages default to `[]`; PATCH omission preserves configuration, `[]` clears it, and null is rejected. Reducing the target below an existing node requires adjusting the stage list in the same mutation.

Task snapshots include the configuration and read-only `stage_progress: {completed, total, next_stage: {value, name, remaining} | null}`. Achievement is derived from cumulative `progress`, not `today_amount` or the uncapped `total_amount`. Nodes provide no additional XP or automatic reward unlocks. Editing, revoking, backfilling and restoring records update the derived state; plan expiry never fills unearned nodes. Account exports retain the configuration.

Clients celebrate only confirmed forward crossings of existing nodes during progress mutations. A single increment crossing several nodes generates one stage receipt; loading, metadata edits and idempotent replays do not produce a celebration. Reductions immediately recalculate current achievement; reaching a node again after a correction is a new crossing. A daily task's daily meter does not display cumulative-day stage ticks.

Alembic revision `f37a8461bc92` adds non-null JSON/JSONB `tasks.stages` with an empty-list default. Existing tasks and records retain their previous values and have stages disabled until configured.


## Task templates

Snapshots add lightweight `templates` summaries (`id`, `name`, `kind`, `target`, `unit`, `is_builtin`, timestamps). The three built-ins are read-only catalog entries: `builtin-reading`, `builtin-exercise`, `builtin-practice`. Custom summaries are owner-scoped and omit potentially large course configuration; details load only when selected.

- `GET /templates` returns a full `MutationResponse` including the catalog and the owner's saved templates.
- `GET /templates/{id}` returns a summary plus a validated `configuration` compatible with `POST /tasks`. It suggests a non-conflicting task name and refreshes a plan's start date to the application date. Applying a template fills a draft; it does not create a task.
- `POST /templates` accepts `{name, source_task_id}` for an owned active or archived source task and returns the full mutation snapshot (201).
- `PATCH /templates/{uuid}` accepts a new `name`, an owned `source_task_id` to replace configuration, or both. Null, empty and unknown fields are rejected. Replacement updates only the saved template.
- `DELETE /templates/{uuid}` deletes the saved configuration and returns the full mutation snapshot; created tasks remain independent.

Saved configuration retains task type, suggested name, description, unit, total target, priority, daily minimum/goal, schedule, stages, plan quotas and course item names. Course checks and their completion metadata are cleared. Progress, records, XP, archives, daily history, absolute deadlines and category/reward associations are not copied. A zero ordinary minimum and unset daily goal remain valid; the UI's empty goal displays the existing minimum-based fallback. Tasks created from templates still pass normal task validation and guest limits.

Custom names are case-insensitively unique per owner and limited to 60 characters. Default creation limits are five guest templates and thirty user templates, configurable with `GUEST_TEMPLATE_LIMIT` and `USER_TEMPLATE_LIMIT`. Source deletion does not invalidate a saved configuration. Registration/login migration retains all saved templates, renaming collisions rather than overwriting data; migration may retain more than the creation limit. Account exports include full `saved_templates` configuration.

Alembic revision `a48b7291dc63` adds only `task_templates` and its indexes/constraints. It does not rewrite existing tasks or progress data.
