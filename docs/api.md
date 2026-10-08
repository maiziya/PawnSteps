# PawnSteps API

The API is version-independent REST under `/api`. Next.js forwards this prefix to FastAPI. OpenAPI is available at `/docs` in development.

Each request carries either `Authorization: Bearer <jwt>` or `X-Guest-Id: <uuid>`. The server derives the owner identifier; clients never submit `owner_id`. Every owner-scoped resource lookup checks both owner and resource ID.

All successful application mutations return a snapshot:

```typescript
interface MutationResponse {
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
}
```

Authentication, uploads, and profile mutations extend the snapshot with their specific result, such as `access_token`, `user`, or `image_url`. A client replaces its tracking state from each response rather than issuing follow-up requests.

| Method | Path | Body or purpose |
| --- | --- | --- |
| GET | `/state`, `/tasks`, `/rewards` | Complete snapshot with daily rollover and milestone evaluation |
| POST | `/tasks` | `name`, `description`, `target`, `priority`, `reward_id`, optional `daily_quota`, `daily_plan`, `plan_start_date`, `course_items` |
| PATCH | `/tasks/{id}` | Editable metadata, ordinary/daily `target`, existing daily-task `daily_quota` |
| POST | `/tasks/{id}/progress` | `{progress: integer}` for ordinary tasks |
| POST | `/tasks/{id}/daily` | `{progress: integer}` for today's quota |
| POST | `/tasks/{id}/daily/undo` | Undo today's achievement and reset today's quota progress |
| POST | `/tasks/{id}/course` | `{indices: integer[], done: boolean}` |
| POST | `/tasks/reorder` | `{ids: uuid[]}` containing every unfinished task once |
| DELETE | `/tasks/{id}` | Soft deletion, returning `undo_token` |
| POST | `/tasks/undo` | `{token: string}` within five seconds |
| POST | `/rewards` | `{name: string, image_url?: string}` |
| PATCH | `/rewards/{id}` | `name`, `image_url`, `is_unlocked` |
| DELETE | `/rewards/{id}` | Delete a custom reward and clear its task associations |
| POST | `/rewards/reorder` | `{ids: uuid[]}` containing all rewards once |
| GET | `/history?month=YYYY-MM` | `{history: [{task_id, task_name, date, completed}], streak}` |

Task type is inferred from its data. A course has `course_items`; a plan has `daily_plan`; a recurring daily task has a positive `daily_quota`; otherwise the task is ordinary. Course and plan types are immutable. Plan and course targets are calculated by the server. Course folder markers end with `/` and are excluded from both target and progress.

Daily task progress counts completed days. Plan progress counts quota units, including partially completed past days, stored in `daily_history.progress`. Positive plan quotas contribute to the target; zero and minus one mark rest days. Rest days automatically receive completed history, including elapsed rest days when the app was closed. Once the plan ends, its overall progress becomes its target and the task completes. An all-rest plan completes on its last rest day. Future plans cannot be advanced early.

`TIMEZONE` determines the application date. Snapshot reads reset stale daily fields and restore the current date's persisted history. Repeated quota submissions remain idempotent because history uses a `(task_id, date)` primary key. A streak starts at the current application date and stops at the first date without any completed daily history.

Six milestone rewards are created idempotently at 3, 7, 14, 30, 60, and 100 consecutive days. Their first automatic achievement is retained in `streak_claimed`, so a later manual lock stays locked. Associated custom rewards unlock when a task transitions to completed; reopening and completing the task again is a new unlock event. Milestone rewards cannot be deleted.

Deleted tasks and their history are hidden immediately. Undo tokens are random, single-use, owner-bound, and expire after five seconds. Expired rows and their history are physically removed during a subsequent snapshot. The unique task name remains reserved during the undo window.

Production mutations serialize through PostgreSQL owner row locks. The development SQLite server also uses per-owner asynchronous locks. Multi-owner account migration acquires owners in sorted order. Production should use PostgreSQL for multiple processes or replicas.
