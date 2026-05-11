// Tarjeta reutilizable para cada bloque de la página /verified/{session}.
// La idea es enseñar al revisor de Google: scope X → este dato, fetched
// con este endpoint, en vivo en tu cuenta.

import type { ReactNode } from 'react';

type Status = 'ok' | 'empty' | 'err';

interface Props {
  title: string;
  scope: string;
  status: Status;
  statusLabel?: string;
  children: ReactNode;
}

const STATUS_LABELS: Record<Status, string> = {
  ok: 'OK',
  empty: 'No data',
  err: 'Error',
};

export function ScopeDemoCard({ title, scope, status, statusLabel, children }: Props) {
  return (
    <article className="v-card">
      <div className="v-card-head">
        <h3 className="v-card-title">{title}</h3>
        <span className={`v-status ${status}`}>{statusLabel ?? STATUS_LABELS[status]}</span>
      </div>
      <div className="v-card-scope">{scope}</div>
      <div className="v-card-body" style={{ marginTop: 12 }}>
        {children}
      </div>
    </article>
  );
}
