import { useEffect, useState } from 'react';
import { presenceLabel } from '../../api/presence';
import type { UserPresence } from '../../api/types';

export function usePresenceLabel(presence?: UserPresence) {
  const [, refresh] = useState(0);
  useEffect(() => {
    if (presence?.online || !presence?.last_seen) return;
    const timer = setInterval(() => refresh((revision) => revision + 1), 60_000);
    return () => clearInterval(timer);
  }, [presence?.online, presence?.last_seen]);
  return presenceLabel(presence);
}
