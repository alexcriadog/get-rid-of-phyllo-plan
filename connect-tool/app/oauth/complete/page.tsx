import { Suspense } from 'react';
import { OAuthCompleteClient } from './client';

export const dynamic = 'force-dynamic';

export default function OAuthComplete() {
  return (
    <Suspense fallback={null}>
      <OAuthCompleteClient />
    </Suspense>
  );
}
