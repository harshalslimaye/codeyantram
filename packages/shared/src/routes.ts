// The server mounts these and the CLI calls them, so the paths live here
// rather than as string literals drifting apart on either side.
export const API_ROUTES = {
    health: "/health",
    providers: "/providers",
    chat: "/chat",
} as const;

export type ApiRoute = (typeof API_ROUTES)[keyof typeof API_ROUTES];
