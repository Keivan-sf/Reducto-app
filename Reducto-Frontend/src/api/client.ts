import type { Session, Tokens } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// One refresh flight prevents rotating the same refresh token in parallel.
export class ApiClient {
  private session: Session | null = null;
  private refreshFlight: Promise<void> | null = null;
  onSession: (session: Session | null) => Promise<void> = async () => {};
  constructor(
    public baseUrl: string,
    private coordination?: {
      readSession(): Promise<Session | null>;
      withRefreshLock<T>(action: () => Promise<T>): Promise<T>;
    },
  ) {}
  setSession(session: Session | null) {
    this.session = session;
  }
  getSession() {
    return this.session;
  }

  async refresh() {
    if (!this.refreshFlight) {
      const expected = this.session;
      const run = async () => {
        if (this.coordination && expected) {
          const stored = await this.coordination.readSession();
          // A waiting tab must use the tokens another tab just rotated.
          if (!stored || stored.user.id !== expected.user.id) {
            throw new ApiError(401, 'Your session changed. Please try again.');
          }
          if (stored.refreshToken !== expected.refreshToken) {
            if (this.session?.user.id === stored.user.id) {
              this.session = stored;
              await this.onSession(stored);
            }
            return;
          }
        }
        const previous = this.session;
        if (!previous) throw new ApiError(401, 'Please sign in again.');
        try {
          const tokens = await this.request<Tokens>(
            '/api/auth/refresh',
            {
              method: 'POST',
              body: JSON.stringify({ refreshToken: previous.refreshToken }),
            },
            false,
          );
          // A logout during refresh must never restore the old account.
          if (
            this.session?.refreshToken !== previous.refreshToken ||
            this.session.user.id !== previous.user.id
          )
            return;
          this.session = { ...this.session, ...tokens };
          await this.onSession(this.session);
        } catch (error) {
          if (
            error instanceof ApiError &&
            (error.status === 401 || error.status === 403) &&
            this.session?.refreshToken === previous.refreshToken
          ) {
            this.session = null;
            await this.onSession(null);
          }
          throw error;
        }
      };
      this.refreshFlight = (
        this.coordination ? this.coordination.withRefreshLock(run) : run()
      ).finally(() => {
        this.refreshFlight = null;
      });
    }
    return this.refreshFlight;
  }

  async request<T>(
    path: string,
    options: RequestInit = {},
    authenticated = true,
    retry = true,
  ): Promise<T> {
    const requestSession = authenticated ? this.session : null;
    const headers = new Headers(options.headers);
    if (options.body && !(options.body instanceof FormData))
      headers.set('Content-Type', 'application/json');
    if (authenticated && this.session)
      headers.set('Authorization', `Bearer ${this.session.accessToken}`);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        signal: options.signal ?? AbortSignal.timeout(20000),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ApiError(0, 'Could not reach Reducto. Check your connection and server address.');
    }
    if (response.status === 401 && authenticated && retry && this.session) {
      if (this.session.user.id !== requestSession?.user.id)
        throw new ApiError(401, 'Your session changed. Please try again.');
      // Another request/tab may have renewed while this old-token response was in flight.
      if (this.session.accessToken === requestSession.accessToken) await this.refresh();
      return this.request<T>(path, options, authenticated, false);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status,
        typeof body.error === 'string' ? body.error : `Request failed (${response.status}).`,
      );
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  get<T>(path: string, signal?: AbortSignal) {
    return this.request<T>(path, { signal });
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }
}
