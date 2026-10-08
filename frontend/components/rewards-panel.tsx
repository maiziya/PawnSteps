"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Check, Flag, Flame, Gift, GripHorizontal, ImagePlus, LoaderCircle, LockKeyhole, Mountain, Pencil, Plus, Sprout, Star, Trash2, Trophy, UnlockKeyhole, X } from "lucide-react";
import { useAppStore } from "@/lib/store";
import type { Reward } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import "./collections.css";

const rewardSchema = z.object({
  name: z.string().trim().min(1, "给这份奖励起个名字吧").max(100, "名称最多 100 个字符"),
  image_url: z.string(),
});
type RewardForm = z.infer<typeof rewardSchema>;
const milestoneIcons = [Sprout, Flame, Flag, Mountain, Star, Trophy];
const milestoneDays = [3, 7, 14, 30, 60, 100];

function RewardCard({ reward, streak, busy, onEdit, onDelete, onToggle }: {
  reward: Reward; streak: number; busy: boolean;
  onEdit: (reward: Reward) => void; onDelete: (reward: Reward) => void; onToggle: (reward: Reward) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: reward.id, disabled: busy });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 5 : undefined };
  const isMilestone = reward.streak_target !== null;
  const Icon = isMilestone ? milestoneIcons[Math.max(0, milestoneDays.indexOf(reward.streak_target!))] : Gift;
  const progress = isMilestone ? Math.min(100, streak / reward.streak_target! * 100) : 0;

  return <article ref={setNodeRef} style={style} className={`reward-card ${reward.is_unlocked ? "reward-earned" : ""} ${isDragging ? "reward-dragging" : ""}`}>
    <div className={`reward-art ${isMilestone ? "reward-milestone-art" : "reward-custom-art"}`}>
      {reward.image_url && !isMilestone
        ? <img src={reward.image_url} alt={reward.name} className="reward-image" loading="lazy" />
        : <div className="reward-emblem"><Icon size={isMilestone ? 37 : 42} strokeWidth={1.35} />{isMilestone && <span>{reward.streak_target}</span>}</div>}
      <span className={`reward-status ${reward.is_unlocked ? "is-earned" : ""}`}>
        {reward.is_unlocked ? <Check size={13} /> : <LockKeyhole size={12} />}{reward.is_unlocked ? "已解锁" : "待解锁"}
      </span>
      <button type="button" className="reward-drag-handle" disabled={busy} {...attributes} {...listeners} aria-label={`拖动排序：${reward.name}`}>
        <GripHorizontal size={20} />
      </button>
    </div>
    <div className="reward-card-body">
      <p className="reward-kind">{isMilestone ? `连续打卡 · ${reward.streak_target} 天` : "为自己准备的心意"}</p>
      <h3>{reward.name}</h3>
      {isMilestone && <div className="reward-streak-progress">
        <div className="reward-progress-track" role="progressbar" aria-label={`${reward.name}连续打卡进度`} aria-valuemin={0} aria-valuemax={reward.streak_target!} aria-valuenow={Math.min(streak, reward.streak_target!)}><span style={{ width: `${progress}%` }} /></div>
        <span>{Math.min(streak, reward.streak_target!)} / {reward.streak_target} 天</span>
      </div>}
      <div className="reward-card-actions">
        <button type="button" className="reward-toggle" onClick={() => onToggle(reward)} disabled={busy}>
          {reward.is_unlocked ? <LockKeyhole size={15} /> : <UnlockKeyhole size={15} />}{reward.is_unlocked ? "重新锁定" : "手动解锁"}
        </button>
        {!isMilestone && <div className="reward-edit-actions">
          <button type="button" className="icon-button" aria-label={`编辑奖励：${reward.name}`} disabled={busy} onClick={() => onEdit(reward)}><Pencil size={15} /></button>
          <button type="button" className="icon-button" aria-label={`删除奖励：${reward.name}`} disabled={busy} onClick={() => onDelete(reward)}><Trash2 size={15} /></button>
        </div>}
      </div>
    </div>
  </article>;
}

export function RewardsPanel() {
  const rewards = useAppStore(state => state.rewards);
  const streak = useAppStore(state => state.stats.streak);
  const busy = useAppStore(state => state.busy);
  const mutate = useAppStore(state => state.mutate);
  const [ordered, setOrdered] = useState(rewards);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Reward | null>(null);
  const [deleting, setDeleting] = useState<Reward | null>(null);
  const [formError, setFormError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const form = useForm<RewardForm>({ resolver: zodResolver(rewardSchema), defaultValues: { name: "", image_url: "" } });
  const imageUrl = form.watch("image_url");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  useEffect(() => { setOrdered(rewards); }, [rewards]);

  function editReward(reward: Reward | null) {
    setEditing(reward);
    setFormError("");
    form.reset({ name: reward?.name || "", image_url: reward?.image_url || "" });
    setOpen(true);
  }
  async function reorder(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id || busy) return;
    const from = ordered.findIndex(reward => reward.id === event.active.id);
    const to = ordered.findIndex(reward => reward.id === event.over!.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(ordered, from, to);
    setOrdered(next);
    try { await mutate("/rewards/reorder", { ids: next.map(reward => reward.id) }); }
    catch { setOrdered(useAppStore.getState().rewards); }
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setFormError("图片需要小于 5 MB"); return; }
    setUploading(true);
    setFormError("");
    const body = new FormData(); body.append("file", file);
    try {
      const result = await mutate("/uploads", body);
      if (result.image_url) form.setValue("image_url", result.image_url, { shouldDirty: true });
    } catch (error) { setFormError(error instanceof Error ? error.message : "图片上传失败，请重试"); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  const save = form.handleSubmit(async values => {
    setFormError("");
    try {
      await mutate(editing ? `/rewards/${editing.id}` : "/rewards", { name: values.name, image_url: values.image_url || null }, editing ? "PATCH" : "POST");
      setOpen(false);
    } catch (error) { setFormError(error instanceof Error ? error.message : "奖励未保存，请重试"); }
  });
  async function removeReward() {
    if (!deleting) return;
    try { await mutate(`/rewards/${deleting.id}`, undefined, "DELETE"); setDeleting(null); }
    catch { /* The shared mutation handler displays the error. */ }
  }

  return <section className="collections-panel" aria-labelledby="rewards-heading">
    <header className="collections-heading">
      <div><p id="rewards-heading" className="collections-intro">给每一次坚持，准备一点期待。</p><p className="muted">让每一次坚持，都通向你喜欢的生活。</p></div>
      <Button onClick={() => editReward(null)}><Plus size={17} />添加奖励</Button>
    </header>
    <div className="reward-summary">
      <div className="reward-summary-icon"><Trophy size={29} strokeWidth={1.5} /></div>
      <div><h2>正在积攒，属于你的成就</h2><p>已解锁 <strong>{rewards.filter(reward => reward.is_unlocked).length}</strong> 份奖励，今天也是值得纪念的一步。</p></div>
      <div className="reward-summary-streak"><Flame size={18} /><strong>{streak}</strong><span>天连续打卡</span></div>
    </div>
    <div className="collections-section-title"><h2>我的奖励架</h2><span className="muted">拖动卡片上方的手柄调整顺序</span></div>
    <DndContext id="rewards-sort" sensors={sensors} collisionDetection={closestCenter} onDragEnd={event => { void reorder(event); }}>
      <SortableContext items={ordered.map(reward => reward.id)} strategy={rectSortingStrategy}>
        <div className="rewards-grid">
          {ordered.map(reward => <RewardCard key={reward.id} reward={reward} streak={streak} busy={busy} onEdit={editReward} onDelete={setDeleting} onToggle={item => { void mutate(`/rewards/${item.id}`, { is_unlocked: !item.is_unlocked }, "PATCH").catch(() => undefined); }} />)}
          <button type="button" className="reward-add-card" onClick={() => editReward(null)}><span><Plus size={25} /></span><strong>为自己准备一份奖励</strong><p>一本书，一次旅行，或一个悠闲的下午</p></button>
        </div>
      </SortableContext>
    </DndContext>
    <Dialog open={open} onOpenChange={value => { if (!uploading && !form.formState.isSubmitting) setOpen(value); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? "编辑这份期待" : "添加一个小期待"}</DialogTitle><DialogDescription>任务完成后，关联的奖励会自动解锁。也可以随时手动解锁。</DialogDescription></DialogHeader>
        <form onSubmit={save} className="reward-form">
          <div><label htmlFor="reward-name">奖励名称</label><Input id="reward-name" placeholder="例如：周末去看一场电影" maxLength={100} autoFocus aria-invalid={Boolean(form.formState.errors.name)} {...form.register("name")} />{form.formState.errors.name && <p className="collections-form-error" role="alert">{form.formState.errors.name.message}</p>}</div>
          <div><label htmlFor="reward-image-file">奖励图片 <span className="muted">（可选）</span></label>
            <input id="reward-image-file" ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="上传奖励图片" disabled={busy || uploading} onChange={event => { void upload(event.target.files?.[0]); }} />
            {imageUrl ? <div className="reward-image-preview"><img src={imageUrl} alt="奖励图片预览" /><Button type="button" variant="secondary" size="icon" aria-label="移除奖励图片" disabled={busy} onClick={() => form.setValue("image_url", "", { shouldDirty: true })}><X size={17} /></Button></div>
              : <button type="button" className="reward-upload" disabled={busy || uploading} onClick={() => fileInput.current?.click()}>{uploading ? <LoaderCircle size={25} className="animate-spin" /> : <ImagePlus size={26} />}<strong>{uploading ? "正在上传" : "选择一张让你心动的图片"}</strong><span>PNG、JPG 或 WebP，小于 5 MB</span></button>}
          </div>
          {formError && <p className="collections-form-error" role="alert">{formError}</p>}
          <div className="collections-form-actions"><Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={busy || uploading || form.formState.isSubmitting}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />}{editing ? "保存修改" : "添加奖励"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(deleting)} onOpenChange={value => { if (!value) setDeleting(null); }}>
      <DialogContent><DialogHeader><DialogTitle>删除这份奖励？</DialogTitle><DialogDescription>「{deleting?.name}」会从奖励架中移除，关联任务会保留。删除后无法恢复。</DialogDescription></DialogHeader><div className="collections-form-actions"><Button variant="ghost" onClick={() => setDeleting(null)}>保留奖励</Button><Button variant="destructive" disabled={busy} onClick={() => { void removeReward(); }}>确认删除</Button></div></DialogContent>
    </Dialog>
  </section>;
}
