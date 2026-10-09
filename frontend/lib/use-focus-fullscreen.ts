"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const openDialog = () => document.querySelector('[role="dialog"][data-state="open"]');

export function useFocusFullscreen(root: RefObject<HTMLDivElement | null>) {
  const [fullscreen, setFullscreen] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const active = useRef(false), nativeOwned = useRef(false), entering = useRef(false), mounted = useRef(true);
  const toggleButton = useRef<HTMLButtonElement>(null);

  const closePresentation = useCallback(() => { active.current = false; setFullscreen(false); }, []);
  const exit = useCallback(async () => {
    if (nativeOwned.current && document.fullscreenElement === document.documentElement) {
      setTransitioning(true);
      try { await document.exitFullscreen(); }
      catch { if (document.fullscreenElement === document.documentElement) return; }
      finally { if (mounted.current) setTransitioning(entering.current); }
      nativeOwned.current = false;
    }
    closePresentation();
  }, [closePresentation]);

  const toggle = useCallback(async () => {
    if (entering.current) return;
    if (active.current) { await exit(); return; }
    active.current = true; setFullscreen(true);
    if (!document.documentElement.requestFullscreen || document.fullscreenEnabled === false || document.fullscreenElement) return;
    entering.current = true; setTransitioning(true);
    try {
      // Request during the click's user activation. Fullscreen the document so portals stay visible.
      await document.documentElement.requestFullscreen();
      nativeOwned.current = document.fullscreenElement === document.documentElement;
      if ((!mounted.current || !active.current) && nativeOwned.current) {
        nativeOwned.current = false;
        await document.exitFullscreen().catch(() => undefined);
      }
    } catch { /* Unsupported or rejected requests retain the page fullscreen presentation. */ }
    finally { entering.current = false; if (mounted.current) setTransitioning(false); }
  }, [exit]);

  useEffect(() => {
    mounted.current = true;
    const nativeChange = () => {
      if (entering.current && document.fullscreenElement === document.documentElement) nativeOwned.current = true;
      else if (nativeOwned.current && document.fullscreenElement !== document.documentElement) {
        nativeOwned.current = false; closePresentation();
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      if (!active.current || event.defaultPrevented || openDialog()) return;
      if (event.key === "Escape") { event.preventDefault(); void exit(); }
      else if (event.key === "Tab" && !document.activeElement?.closest('[data-sonner-toaster]')) {
        const items = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') || [])]
          .filter(item => item.getClientRects().length && getComputedStyle(item).visibility !== "hidden" && !item.closest('[inert]'));
        const first = items[0], last = items.at(-1);
        if (!first) { event.preventDefault(); root.current?.focus(); return; }
        if (!items.includes(document.activeElement as HTMLElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus();
        }
      }
    };
    document.addEventListener("fullscreenchange", nativeChange);
    document.addEventListener("keydown", keyboard);
    return () => {
      mounted.current = false; active.current = false;
      document.removeEventListener("fullscreenchange", nativeChange);
      document.removeEventListener("keydown", keyboard);
      if (nativeOwned.current && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => undefined);
      nativeOwned.current = false;
    };
  }, [closePresentation, exit, root]);

  useLayoutEffect(() => {
    if (!fullscreen) return;
    const body = document.body, previousOverflow = body.style.overflow, previousFlag = body.dataset.focusFullscreen;
    const scroll = { left: window.scrollX, top: window.scrollY };
    const chrome = [...document.querySelectorAll<HTMLElement>('.sidebar,.workspace-header,.workspace>.page-footer,.mobile-nav,.skip-link')];
    const siblings = [...(root.current?.parentElement?.children || [])].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== root.current);
    const previousInert = new Map([...chrome, ...siblings].map(element => [element, element.inert]));
    for (const element of previousInert.keys()) element.inert = true;
    body.style.overflow = "hidden"; body.dataset.focusFullscreen = "true";
    if (toggleButton.current?.disabled) root.current?.focus({ preventScroll: true });
    else toggleButton.current?.focus({ preventScroll: true });
    return () => {
      body.style.overflow = previousOverflow;
      if (previousFlag === undefined) delete body.dataset.focusFullscreen; else body.dataset.focusFullscreen = previousFlag;
      for (const [element, inert] of previousInert) element.inert = inert;
      requestAnimationFrame(() => {
        if (!root.current?.isConnected || active.current) return;
        window.scrollTo({ ...scroll, behavior: "instant" });
        if (!openDialog()) toggleButton.current?.focus({ preventScroll: true });
      });
    };
  }, [fullscreen, root]);

  return { fullscreen, transitioning, toggle, exit, toggleButton };
}
