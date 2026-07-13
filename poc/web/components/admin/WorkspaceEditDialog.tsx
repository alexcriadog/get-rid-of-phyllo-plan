import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { adminPatch } from '@/lib/api';

export type EditableWorkspace = {
  slug: string;
  name: string;
};

/**
 * Edit-workspace modal — matches the admin dialog pattern (RunNowDialog):
 * fixed blurred overlay, `bg-card` panel, mono uppercase field labels,
 * ESC / click-outside to close, body-scroll lock.
 *
 * Intentionally a real form (not a window.prompt): add editable fields here
 * as the workspace schema grows — each field PATCHes its own endpoint on save
 * so this scales past a single value.
 */
export function WorkspaceEditDialog({
  workspace,
  onClose,
  onSaved,
}: {
  workspace: EditableWorkspace;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ESC-to-close + body-scroll lock (same as the app's other dialogs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const trimmed = name.trim();
  const dirty = trimmed.length > 0 && trimmed !== workspace.name;

  const save = async () => {
    if (!dirty) {
      onClose();
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await adminPatch(`/admin/workspaces/${workspace.slug}/name`, {
        name: trimmed,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit workspace ${workspace.slug}`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-lg border border-border bg-card text-card-foreground shadow-xl"
        style={{ width: 'min(480px, 100%)', maxHeight: '90vh', overflow: 'auto' }}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Edit workspace ·{' '}
            <span className="text-foreground">{workspace.slug}</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
          >
            close · esc
          </button>
        </div>

        <form
          className="flex flex-col gap-4 px-5 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div>
            <label
              htmlFor="ws-name"
              className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
            >
              Display name
            </label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={120}
              placeholder="Workspace name"
            />
          </div>

          {/* Add more editable fields here as the schema grows. */}

          {err && <div className="text-sm text-danger">↯ {err}</div>}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
