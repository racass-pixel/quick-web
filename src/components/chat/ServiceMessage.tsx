// Centered pill-style system event rendered inline in the thread. Replaces
// the usual bubble layout for messages with `kind === 'service'`.
//
// The wire `body` is JSON of a structured payload that varies by `type`. We
// parse defensively — an unrecognised or malformed payload renders as a short
// "system message" fallback so we don't blow up the thread.

import type { LocalMessage, SenderUser } from '../../stores/useChats';
import { useChats } from '../../stores/useChats';

type ServiceEvent =
  | { type: 'member_joined'; user_id: string }
  | { type: 'member_left'; user_id: string }
  | { type: 'member_added'; by_user_id: string; user_id: string }
  | { type: 'member_removed'; by_user_id: string; user_id: string }
  | {
      type: 'call_ended';
      by_user_id?: string;
      duration_seconds: number;
      call_type?: 'audio' | 'video';
    }
  | { type: 'call_missed'; by_user_id?: string; call_type?: 'audio' | 'video' }
  | {
      type: 'title_changed';
      by_user_id: string;
      old_title?: string;
      new_title?: string;
    }
  | { type: string; [k: string]: unknown };

function parseEvent(body: string): ServiceEvent | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      return parsed as ServiceEvent;
    }
  } catch {
    /* not JSON — fall through */
  }
  return null;
}

function fmtDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function shortId(id: string | undefined): string {
  if (!id) return 'someone';
  // 8-char truncation matches the spec fallback when no user cache is hit.
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

type Props = {
  message: LocalMessage;
};

export function ServiceMessage({ message }: Props) {
  // Look up sender snapshots already stashed on incoming messages — backend
  // attaches `sender_user` on the wire envelope for message attribution. Names
  // for *other* user_ids referenced inside the event payload aren't readily
  // available, so we fall back to a truncated id.
  const senderUserByMsgId = useChats((s) => s.senderUserByMsgId);

  function nameFor(userId: string | undefined): string {
    if (!userId) return 'someone';
    // Check the snapshot table for any message whose sender matches.
    for (const id in senderUserByMsgId) {
      const u: SenderUser = senderUserByMsgId[id];
      if (u.id === userId) {
        return u.displayName || (u.handle ? `@${u.handle}` : shortId(userId));
      }
    }
    return shortId(userId);
  }

  const event = parseEvent(message.body);

  let text: string = 'system message';
  let tone: 'muted' | 'err' = 'muted';

  if (event) {
    switch (event.type) {
      case 'member_joined': {
        const e = event as { type: 'member_joined'; user_id: string };
        text = `${nameFor(e.user_id)} joined the group`;
        break;
      }
      case 'member_left': {
        const e = event as { type: 'member_left'; user_id: string };
        text = `${nameFor(e.user_id)} left`;
        break;
      }
      case 'member_added': {
        const e = event as {
          type: 'member_added';
          by_user_id: string;
          user_id: string;
        };
        text = `${nameFor(e.by_user_id)} added ${nameFor(e.user_id)}`;
        break;
      }
      case 'member_removed': {
        const e = event as {
          type: 'member_removed';
          by_user_id: string;
          user_id: string;
        };
        text = `${nameFor(e.by_user_id)} removed ${nameFor(e.user_id)}`;
        break;
      }
      case 'call_ended': {
        const e = event as {
          type: 'call_ended';
          duration_seconds: number;
          call_type?: 'audio' | 'video';
        };
        const label = e.call_type === 'video' ? 'Video call' : 'Call';
        text = `${label} · ${fmtDuration(e.duration_seconds)}`;
        break;
      }
      case 'call_missed': {
        text = 'Missed call';
        tone = 'err';
        break;
      }
      case 'title_changed': {
        const e = event as {
          type: 'title_changed';
          by_user_id: string;
          old_title?: string;
          new_title?: string;
        };
        const newTitle = e.new_title ? `"${e.new_title}"` : '';
        text = `${nameFor(e.by_user_id)} changed group name to ${newTitle}`.trim();
        break;
      }
      default:
        text = event.type.replace(/_/g, ' ');
        break;
    }
  }

  const toneClass =
    tone === 'err' ? 'text-err border-err/40' : 'text-ink-3 border-line';

  return (
    <div className="flex justify-center my-2 animate-[bubble-in_200ms_ease-out]">
      <div
        className={`px-3 py-1 text-[12px] font-mono rounded-full border bg-raised/70 ${toneClass} select-none`}
      >
        {text}
      </div>
    </div>
  );
}
