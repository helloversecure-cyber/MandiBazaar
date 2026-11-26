"use client";

/**
 * Is "send a list to stores" on for the person looking at the page?
 * Reads features.listBidding from /api/app/config (public switch, or a beta
 * tester listed in LIST_BIDDING_BETA_EMAILS). One request per signed-in user.
 * Returns null while unknown, so entry points stay hidden until we know.
 */
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

const cache = new Map<string, Promise<boolean>>();

function load(key: string): Promise<boolean> {
  let p = cache.get(key);
  if (!p) {
    p = fetch("/api/app/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => Boolean(d?.data?.features?.listBidding))
      .catch(() => {
        cache.delete(key);
        return false;
      });
    cache.set(key, p);
  }
  return p;
}

export function useListBidding(): boolean | null {
  const { data, status } = useSession();
  const key = status === "authenticated" ? `u:${data?.user?.email ?? data?.user?.id ?? ""}` : status;
  const [state, setState] = useState<{ key: string; on: boolean } | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    let alive = true;
    load(key).then((on) => {
      if (alive) setState({ key, on });
    });
    return () => {
      alive = false;
    };
  }, [key, status]);

  if (status === "loading" || !state || state.key !== key) return null;
  return state.on;
}
