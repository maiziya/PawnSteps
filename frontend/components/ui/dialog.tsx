"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export function DialogHeader({ children, className }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("dialog-header", className)}>{children}</div>; }
export function DialogContent({ children, className, ...props }: React.ComponentPropsWithoutRef<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Overlay className="dialog-overlay" /><Primitive.Content className={cn("dialog-content", className)} {...props}>{children}<Primitive.Close className="icon-button dialog-close" aria-label="关闭"><X size={20} /></Primitive.Close></Primitive.Content></Primitive.Portal>;
}
