// The server mounts these and the CLI calls them, so the paths live here
// rather than as string literals drifting apart on either side.
export const API_ROUTES = {
    health: "/health",
    providers: "/providers",
    chat: "/chat",
    // Only the mount point, not every path under it - /sessions/:id,
    // /sessions/:id/messages, and /sessions/:id/approvals are relative paths
    // declared directly inside routers/sessions.ts, the same way /chat's own
    // POST '/' is a path inside routers/chat.ts rather than a second entry here.
    sessions: "/sessions",
} as const;

export type ApiRoute = (typeof API_ROUTES)[keyof typeof API_ROUTES];
