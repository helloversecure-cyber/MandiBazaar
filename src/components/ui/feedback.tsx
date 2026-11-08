"use client";

/**
 * In-app confirmation dialog + toast messages (QA P13/P14: no browser alert()/confirm()).
 *
 *   const confirm = useConfirm();
 *   const toast = useToast();
 *
 *   const r = await confirm({
 *     title: "Suspend Euro Store?",
 *     message: "Its products will disappear from the shop.",
 *     confirmLabel: "Suspend store",
 *     tone: "danger",
 *     reason: { label: "Reason (shown to the store owner)", required: true, minLength: 5 },
 *   });
 *   if (!r.confirmed) return;
 *   ... r.reason ...
 *   toast.success("Store suspended");
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Tone = "default" | "danger";

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  /** Ask for a reason in a text box. */
  reason?: { label: string; required?: boolean; minLength?: number; placeholder?: string; maxLength?: number };
};

export type ConfirmResult = { confirmed: boolean; reason?: string };

type ToastKind = "success" | "error" | "info";
type ToastItem = {
  id: number;
  kind: ToastKind;
  text: string;
  action?: { label: string; onClick: () => void };
};

type FeedbackCtx = {
  confirm: (o: ConfirmOptions) => Promise<ConfirmResult>;
  pushToast: (kind: ToastKind, text: string, opts?: { action?: ToastItem["action"]; durationMs?: number }) => void;
};

const Ctx = createContext<FeedbackCtx | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (r: ConfirmResult) => void }) | null>(null);
  const [reason, setReason] = useState("");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const reasonBox = useRef<HTMLTextAreaElement>(null);

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<ConfirmResult>((resolve) => {
        setReason("");
        setDialog({ ...o, resolve });
      }),
    []
  );

  const close = useCallback(
    (confirmed: boolean) => {
      if (!dialog) return;
      dialog.resolve(confirmed ? { confirmed: true, reason: reason.trim() || undefined } : { confirmed: false });
      setDialog(null);
    },
    [dialog, reason]
  );

  useEffect(() => {
    if (!dialog) return;
    (dialog.reason ? reasonBox.current : confirmBtn.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, close]);

  const pushToast = useCallback<FeedbackCtx["pushToast"]>((kind, text, opts) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text, action: opts?.action }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.durationMs ?? 4500);
  }, []);

  const reasonCfg = dialog?.reason;
  const reasonTooShort =
    Boolean(reasonCfg?.required) && reason.trim().length < Math.max(1, reasonCfg?.minLength ?? 1);
  const danger = dialog?.tone === "danger";

  return (
    <Ctx.Provider value={{ confirm, pushToast }}>
      {children}

      {dialog && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 px-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <h2 id="confirm-title" className="text-lg font-bold text-slate-900">
              {dialog.title}
            </h2>
            {dialog.message ? <div className="mt-2 text-sm text-slate-600">{dialog.message}</div> : null}
            {reasonCfg && (
              <div className="mt-4">
                <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="confirm-reason">
                  {reasonCfg.label}
                  {reasonCfg.required ? <span className="ml-0.5 text-red-600">*</span> : null}
                </label>
                <textarea
                  id="confirm-reason"
                  ref={reasonBox}
                  rows={3}
                  maxLength={reasonCfg.maxLength ?? 500}
                  placeholder={reasonCfg.placeholder}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                {reasonCfg.required && reasonCfg.minLength ? (
                  <p className="mt-1 text-xs text-slate-500">At least {reasonCfg.minLength} characters.</p>
                ) : null}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                onClick={() => close(false)}
              >
                {dialog.cancelLabel || "Cancel"}
              </button>
              <button
                ref={confirmBtn}
                type="button"
                disabled={reasonTooShort}
                className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                  danger ? "bg-red-600 hover:bg-red-700" : "bg-brand-600 hover:bg-brand-700"
                }`}
                onClick={() => close(true)}
              >
                {dialog.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[110] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
              t.kind === "success" ? "bg-emerald-600" : t.kind === "error" ? "bg-red-600" : "bg-slate-800"
            }`}
          >
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="rounded-lg bg-white/20 px-2 py-1 text-xs font-bold hover:bg-white/30"
                onClick={() => {
                  t.action?.onClick();
                  setToasts((all) => all.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

function useFeedback(): FeedbackCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm/useToast must be used inside <FeedbackProvider>");
  return ctx;
}

export function useConfirm() {
  return useFeedback().confirm;
}

export function useToast() {
  const { pushToast } = useFeedback();
  return {
    success: (text: string, opts?: { action?: { label: string; onClick: () => void }; durationMs?: number }) =>
      pushToast("success", text, opts),
    error: (text: string) => pushToast("error", text),
    info: (text: string) => pushToast("info", text),
  };
}
