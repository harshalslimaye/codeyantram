import { hc } from 'hono/client';
import type { AppType } from '@codeyantram/server';
import { readServerToken } from '@codeyantram/shared';

// Matches the server's own default (packages/server/src/index.ts) so a
// fresh checkout works without any .env at all.
const DEFAULT_BASE_URL = 'http://localhost:3001';

// Must match server/src/lib/server-auth.ts's SERVER_TOKEN_HEADER - not imported directly
// since @codeyantram/server is a devDependency here (see the AppType comment below), and
// pulling in a runtime value from it would defeat that.
const SERVER_TOKEN_HEADER = 'x-codeyantram-token';

export function getServerBaseUrl(): string {
    return process.env.API_URL ?? DEFAULT_BASE_URL;
}

// AppType is a type-only import (see package.json: @codeyantram/server is a
// devDependency, never a runtime one) - hc<AppType>() gets full route/body
// typing for free without the CLI depending on the server at runtime.
//
// One shared factory for every API caller (chat.ts, sessions.ts, and whatever else
// follows) rather than one per file - hc<AppType>() already returns a client typed for
// the whole app (every route, not just one router's), so there was never a reason for
// each file to build its own; they just read different properties off the same shape.
//
// The token header is read fresh on every call (readServerToken() re-reads the file each
// time, and this function itself runs fresh per API call) rather than cached - the same
// reasoning as the server's own per-request read: it picks up a regenerated token without
// needing a CLI restart. If the file doesn't exist yet (the server has never started
// against this config dir), this sends no usable token and the server's own
// requireServerToken() rejects the request - a normal, recognizable failure ("start the
// server first"), not a special case any caller needs to handle differently from any
// other unreachable-server error.
export function getApiClient() {
    return hc<AppType>(getServerBaseUrl(), {
        headers: { [SERVER_TOKEN_HEADER]: readServerToken() ?? '' },
    });
}
