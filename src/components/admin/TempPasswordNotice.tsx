"use client";

/**
 * Admin-created account: the person receives a Firebase "set your password" link
 * by email (no temporary password is shown). This confirms the account was created
 * and the email was sent.
 */
export function TempPasswordNotice({
  identifier,
  message,
  onDismiss,
}: {
  identifier: string;
  message?: string;
  onDismiss: () => void;
}) {
  return (
    <div role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
      <p className="font-semibold">Account created.</p>
      <p className="mt-2 break-all">
        Login email: <strong>{identifier}</strong>
      </p>
      <p className="mt-1 text-xs text-emerald-800">
        {message || "We emailed them a link to set their own password and sign in."}
      </p>
      <div className="mt-3">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
        >
          Done
        </button>
      </div>
    </div>
  );
}
