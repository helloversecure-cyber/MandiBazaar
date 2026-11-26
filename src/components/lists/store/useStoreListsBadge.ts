"use client";

/**
 * Store nav: is "Incoming lists" relevant for this owner, and how many lists
 * wait for an offer? Shown when list bidding is on for them, or when any list
 * was ever sent to their store (beta testing while the switch is off).
 */
import { useEffect, useState } from "react";
import { useListBidding } from "@/components/lists/useListBidding";
import { storeListsNeedingAction, type StoreListRow } from "@/lib/lists/store-ui";

export function useStoreListsBadge(pathname: string, enabled: boolean): { show: boolean; count: number } {
  const featureOn = useListBidding();
  const [state, setState] = useState<{ any: boolean; count: number }>({ any: false, count: 0 });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      try {
        const open = await fetch("/api/store/lists?filter=open&limit=50", { cache: "no-store" }).then((r) => r.json());
        const rows: StoreListRow[] = open?.success ? open.data.items : [];
        let any = rows.length > 0;
        if (!any) {
          const all = await fetch("/api/store/lists?filter=all&limit=1", { cache: "no-store" }).then((r) => r.json());
          any = Boolean(all?.success && all.data.pagination?.total > 0);
        }
        if (alive) setState({ any, count: storeListsNeedingAction(rows) });
      } catch {
        /* keep the last value */
      }
    })();
    return () => {
      alive = false;
    };
  }, [pathname, enabled]);

  return { show: featureOn === true || state.any, count: state.count };
}
