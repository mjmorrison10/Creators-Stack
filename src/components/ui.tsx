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

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
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

/** Transient status line. Errors persist; successes are allowed to fade. */
export function StatusLine({ tone, children }: { tone: "info" | "error" | "ok"; children: ReactNode }) {
  const cls =
    tone === "error" ? "text-gold" : tone === "ok" ? "text-pos" : "text-muted";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`mt-3 text-sm ${cls}`}>
      {children}
    </p>
  );
}
