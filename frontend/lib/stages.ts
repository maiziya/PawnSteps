import type { Task, TaskStage, StageProgress } from './types';

export interface StageFeedback { id: string; stages: TaskStage[] }
export function stageProgress(task: Task): StageProgress {
  if (task.stage_progress) return task.stage_progress;
  const stages = task.stages || [];
  const pending = stages.find(stage => stage.value > task.progress);
  return { completed: stages.filter(stage => stage.value <= task.progress).length, total: stages.length,
    next_stage: pending ? { ...pending, name: pending.name || `第 ${stages.indexOf(pending) + 1} 阶段`, remaining: pending.value - task.progress } : null };
}
export function crossedStages(before: Task, after: Task): TaskStage[] {
  if (before.id !== after.id || before.owner_id !== after.owner_id || after.progress <= before.progress) return [];
  return (after.stages || []).filter(stage => stage.value > before.progress && stage.value <= after.progress
    && before.stages?.some(previous => previous.value === stage.value && previous.name === stage.name));
}
export function quarterStages(target: number): TaskStage[] {
  if (!Number.isInteger(target) || target < 1) return [];
  return [...new Set([.25, .5, .75, 1].map(fraction => Math.ceil(target * fraction)))].map(value => ({ value,
    name: value === target ? '完成任务' : value / target >= .75 ? '进入最后阶段' : value / target >= .5 ? '完成一半' : '完成第一阶段' }));
}
export function stageUnit(task: Task) { return task.course_items !== null ? '节' : task.daily_quota > 0 && task.daily_plan === null ? '天' : task.unit; }
