import { announce } from "./LiveRegion";
import { useEffect, useRef, type ReactNode } from "react";

/** A titled panel. Everything in Settings is one of these. */
export function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-5 rounded-xl border border-edge bg-surface p-5 shadow-card">
      <h2 className="font-mono text-[11px] font-bold tracking-[0.14em] text-muted">{title}</h2>
      {hint && <p className="mt-1.5 text-sm text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

type ButtonVariant = "default" | "primary" | "danger";

const VARIANTS: Record<ButtonVariant, string> = {
  default: "border-edge bg-surface2 text-ink hover:border-muted",
  primary: "border-brand bg-brand-ghost text-brand hover:brightness-110",
  danger: "border-edge bg-surface2 text-gold hover:border-gold",
};

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-2 font-mono text-[11px] font-bold tracking-[0.08em] transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  id?: string;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      autoComplete="off"
      className="w-full rounded-lg border border-edge bg-ground px-3 py-2 text-sm text-ink placeholder:text-faint"
    />
  );
}

/**
 * A modal that must be answered. Focus moves in on open and Escape cancels, so
 * a destructive confirm can't be dismissed by clicking into the page behind it.
 */
export function Modal({
  title,
  children,
  onClose,
  actions,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Whatever had focus when the modal opened — almost always the button that
  // opened it. Captured in a ref during render rather than in the effect so
  // it records the pre-modal element, not whatever the effect's own focus
  // call left behind.
  const returnTo = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );

  useEffect(() => {
    const node = ref.current;
    node?.focus();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !node) return;

      // Without a trap, Tab walks straight out of an aria-modal dialog into
      // the page behind it — the screen reader still says "dialog" while the
      // keyboard is somewhere else entirely, which is worse than no dialog
      // semantics at all.
      const focusable = [
        ...node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusable.length) {
        // Nothing to cycle between: keep focus on the dialog itself rather
        // than letting Tab escape to the page behind.
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const restore = returnTo.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      // Focus goes back where it came from. Skipped if the trigger is gone
      // from the document — a confirm that deletes its own row — because
      // focusing a detached node silently drops focus to <body>.
      //
      // Deferred a tick because closing is often driven by a CLICK: the
      // dialog unmounts on mousedown, and the browser then delivers mouseup
      // and click, which moves focus to whatever was clicked. Restoring
      // synchronously here gets silently overwritten by that — focus ends up
      // on <body> and the next Tab starts from the top of the document.
      // Found by the keyboard e2e pass, not by reading this code.
      if (restore?.isConnected) setTimeout(() => restore.focus(), 0);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      // Clicking the backdrop cancels, which is what every dialog on the web
      // does and what a creator will try first. Guarded on the target being
      // the backdrop itself so a click that starts inside the panel and drags
      // out does not close it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-lg rounded-xl border border-edge bg-surface p-5 shadow-card outline-none"
      >
        <h2 className="font-mono text-[11px] font-bold tracking-[0.14em] text-muted">{title}</h2>
        <div className="mt-3 text-sm text-ink">{children}</div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">{actions}</div>
      </div>
    </div>
  );
}

/**
 * Transient status line. Errors persist; successes are allowed to fade.
 *
 * The ARIA role moved OFF this element on purpose. Every caller renders a
 * StatusLine together with its message, and a live region that arrives with
 * its own content does not announce — so `role="status"` here was decoration.
 * The text is instead pushed to the boot-mounted regions in LiveRegion, which
 * were in the accessibility tree long before the message existed.
 *
 * Read from the DOM rather than from props because `children` is a ReactNode:
 * most call sites interpolate elements (a handoff link, a count) and there is
 * no honest way to stringify that without duplicating the markup.
 */
export function StatusLine({ tone, children }: { tone: "info" | "error" | "ok"; children: ReactNode }) {
  const cls =
    tone === "error" ? "text-gold" : tone === "ok" ? "text-pos" : "text-muted";
  const ref = useRef<HTMLParagraphElement>(null);
  const said = useRef("");

  useEffect(() => {
    const text = ref.current?.textContent?.trim() ?? "";
    if (!text || text === said.current) return;
    said.current = text;
    announce(text, tone === "error" ? "assertive" : "polite");
  });

  return (
    <p ref={ref} className={`mt-3 text-sm ${cls}`}>
      {children}
    </p>
  );
}
