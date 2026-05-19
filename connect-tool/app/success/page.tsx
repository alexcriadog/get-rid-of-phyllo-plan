// Post-seed confirmation. Fully driven by query params (no session lookup,
// no DB read) so it lives as a Client Component wrapped in Suspense —
// useSearchParams requires a Suspense boundary in App Router.

import { Suspense } from 'react';
import { SuccessClient } from './client';

export default function SuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessClient />
    </Suspense>
  );
}
