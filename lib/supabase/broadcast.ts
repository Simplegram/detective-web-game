/**
 * Server-side room broadcast (service-role).
 * The API routes can't reach the anon client, so this opens a short-lived
 * realtime socket with the service key and fires one broadcast event.
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { BroadcastEvent } from "@/types";

function serviceRealtimeClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function sendRoomBroadcast(roomCode: string, event: BroadcastEvent): Promise<void> {
  const client = serviceRealtimeClient();
  const channel = client.channel(`room:${roomCode}`, { config: { broadcast: { self: false } } });
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(() => reject(new Error("broadcast subscribe timeout")), 8000);

  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      clearTimeout(timer);
      void channel
        .send({ type: "broadcast", event: "sync", payload: event })
        .finally(() => resolve());
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      clearTimeout(timer);
      reject(new Error(`broadcast channel ${status}`));
    }
  });

  try {
    await promise;
  } finally {
    await client.removeChannel(channel).catch(() => {});
    await client.realtime.disconnect().catch(() => {});
  }
}