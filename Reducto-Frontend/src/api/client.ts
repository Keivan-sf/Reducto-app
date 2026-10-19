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
  constructor(public baseUrl: string) {}
  setSession(session: Session | null) {
    this.session = session;
  }
  getSession() {
    return this.session;
  }

  async refresh() {
    if (!this.refreshFlight) {
      this.refreshFlight = (async () => {
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
          if (this.session !== previous) return;
          this.session = { ...previous, ...tokens };
          await this.onSession(this.session);
        } catch (error) {
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            this.session = null;
            await this.onSession(null);
          }
          throw error;
        }
      })().finally(() => {
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
      await this.refresh();
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
