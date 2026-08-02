export type User = { username: string };

export class ApiError extends Error {}

/**
 * The site is served by the same FastAPI process that owns /api, so the session
 * cookie rides along on same-origin requests without any extra configuration.
 */
const request = async (path: string, init?: RequestInit) => {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  return response;
};

/** Returns null when signed out, so callers can branch without catching. */
export const fetchMe = async (): Promise<User | null> => {
  const response = await request("/api/me");
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new ApiError(`Could not read the session (${response.status})`);
  }
  return response.json();
};

export const login = async (
  username: string,
  password: string
): Promise<User> => {
  const response = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (response.status === 401) {
    throw new ApiError("Invalid username or password");
  }
  if (!response.ok) {
    throw new ApiError(`Sign in failed (${response.status})`);
  }
  return response.json();
};

export const logout = async (): Promise<void> => {
  const response = await request("/api/logout", { method: "POST" });
  if (!response.ok) {
    throw new ApiError(`Sign out failed (${response.status})`);
  }
};
