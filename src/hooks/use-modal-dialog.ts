"use client";

import { useEffect, useRef, type SyntheticEvent } from "react";

type ModalEntry = {
  dialog: HTMLDialogElement;
  restoreFocus: HTMLElement | null;
};

type ModalStack = {
  entries: ModalEntry[];
  overflow: string;
  overflowPriority: string;
};

const modalStacks = new WeakMap<Document, ModalStack>();

/** Native dialogs own focus trapping; this hook coordinates their shared page lock. */
export function useModalDialog(onClose: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const ownerDocument = dialog.ownerDocument;
    const trigger = ownerDocument.activeElement;
    const entry: ModalEntry = {
      dialog,
      restoreFocus: trigger instanceof HTMLElement ? trigger : null,
    };

    dialog.showModal();
    activeRef.current = true;
    let stack = modalStacks.get(ownerDocument);
    if (!stack) {
      stack = {
        entries: [],
        overflow: ownerDocument.body.style.getPropertyValue("overflow"),
        overflowPriority: ownerDocument.body.style.getPropertyPriority("overflow"),
      };
      modalStacks.set(ownerDocument, stack);
      ownerDocument.body.style.setProperty("overflow", "hidden");
    }
    stack.entries.push(entry);

    return () => {
      activeRef.current = false;
      const wasTopmost = stack.entries.at(-1) === entry;
      stack.entries = stack.entries.filter((current) => current !== entry);

      // A parent may unmount before its portalled child. Let the child restore
      // the parent's original trigger instead of a soon-to-be detached control.
      for (const remaining of stack.entries) {
        if (remaining.restoreFocus && dialog.contains(remaining.restoreFocus)) {
          remaining.restoreFocus = entry.restoreFocus;
        }
      }
      dialog.close();

      const topmost = stack.entries.at(-1);
      if (!topmost) {
        if (stack.overflow) {
          ownerDocument.body.style.setProperty("overflow", stack.overflow, stack.overflowPriority);
        } else {
          ownerDocument.body.style.removeProperty("overflow");
        }
        modalStacks.delete(ownerDocument);
      }
      if (wasTopmost && entry.restoreFocus?.isConnected && (!topmost || topmost.dialog.contains(entry.restoreFocus))) {
        entry.restoreFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  function onCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    // React events also bubble through portals, unlike the DOM dialog tree.
    event.stopPropagation();
    const dialog = dialogRef.current;
    if (!dialog || event.target !== dialog) return;
    if (modalStacks.get(dialog.ownerDocument)?.entries.at(-1)?.dialog === dialog) onClose();
  }

  return { dialogRef, activeRef, onCancel };
}
