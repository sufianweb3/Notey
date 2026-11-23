# Sync architecture

## Summary

The client polls `/api/changes?since=<seq>` every **4 seconds** while visible. There's no WebSocket, which keeps the three hosts identical.

## Trade-offs

| Approach | Latency | Complexity |
|---|---|---|
| Polling | ~4 s | Low |
| WebSockets | <100 ms | High (sticky state) |

> [!NOTE]
> If you need lower latency later, add Server-Sent Events behind the same `change_log`.

## Next steps

- [x] Add `change_log` table
- [ ] Wire the client poller
- [ ] Add the "Claude edited this page" banner
