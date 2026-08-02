import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthGate } from "@/components/AuthGate";

type Reply = { status: number; body?: unknown };

const reply = ({ status, body }: Reply) =>
  ({
    ok: status < 400,
    status,
    json: async () => body,
  }) as Response;

/** Routes each mocked call by URL and method, so tests state intent not call order. */
const mockApi = (routes: Record<string, Reply>) => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const route = routes[key];
    if (!route) {
      throw new Error(`Unexpected request: ${key}`);
    }
    return reply(route);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("AuthGate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the login form when there is no session", async () => {
    mockApi({ "GET /api/me": { status: 401 } });

    render(<AuthGate />);

    expect(await screen.findByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/column-/)).toHaveLength(0);
  });

  it("shows the board when a session already exists", async () => {
    mockApi({ "GET /api/me": { status: 200, body: { username: "user" } } });

    render(<AuthGate />);

    expect(await screen.findAllByTestId(/column-/)).toHaveLength(5);
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
  });

  it("shows the board after signing in", async () => {
    mockApi({
      "GET /api/me": { status: 401 },
      "POST /api/login": { status: 200, body: { username: "user" } },
    });
    render(<AuthGate />);

    await userEvent.type(await screen.findByLabelText("Username"), "user");
    await userEvent.type(screen.getByLabelText("Password"), "password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findAllByTestId(/column-/)).toHaveLength(5);
  });

  it("shows an error when the credentials are rejected", async () => {
    mockApi({
      "GET /api/me": { status: 401 },
      "POST /api/login": { status: 401 },
    });
    render(<AuthGate />);

    await userEvent.type(await screen.findByLabelText("Username"), "user");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(
      await screen.findByText(/invalid username or password/i)
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId(/column-/)).toHaveLength(0);
  });

  it("returns to the login form after signing out", async () => {
    mockApi({
      "GET /api/me": { status: 200, body: { username: "user" } },
      "POST /api/logout": { status: 200, body: { status: "signed out" } },
    });
    render(<AuthGate />);

    await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));

    await waitFor(() =>
      expect(screen.getByLabelText("Username")).toBeInTheDocument()
    );
    expect(screen.queryAllByTestId(/column-/)).toHaveLength(0);
  });
});
