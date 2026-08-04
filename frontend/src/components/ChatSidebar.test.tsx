import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSidebar } from "@/components/ChatSidebar";
import { testBoard } from "@/test/board-fixture";

/** Resolves chat calls on demand so the pending state can be observed. */
const mockChat = () => {
  const sent: { message: string; history: unknown[] }[] = [];
  let release: (value: unknown) => void = () => {};
  let reply: unknown = { reply: "Sure.", board_updated: false, board: null };
  let status = 200;

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== "/api/ai/chat") throw new Error(`Unexpected request: ${url}`);
    sent.push(JSON.parse(init!.body as string));
    await new Promise((resolve) => {
      release = resolve;
      // Nothing awaits release unless a test holds the call open.
      queueMicrotask(() => resolve(null));
    });
    return { ok: status < 400, status, json: async () => reply } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);

  return {
    sent,
    hold: () => {
      let held: (value: unknown) => void;
      const gate = new Promise((resolve) => (held = resolve));
      fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
        sent.push(JSON.parse((init as RequestInit).body as string));
        await gate;
        return { ok: status < 400, status, json: async () => reply } as Response;
      });
      return () => held!(null);
    },
    respondWith: (value: unknown) => (reply = value),
    failWith: (code: number) => (status = code),
  };
};

const open = async () => {
  await userEvent.click(screen.getByRole("button", { name: /ai assistant/i }));
};

const ask = async (text: string) => {
  await userEvent.type(screen.getByLabelText(/message the ai/i), text);
  await userEvent.click(screen.getByRole("button", { name: /^send$/i }));
};

describe("ChatSidebar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens and closes", async () => {
    mockChat();
    render(<ChatSidebar />);

    expect(screen.queryByLabelText(/message the ai/i)).not.toBeInTheDocument();

    await open();
    expect(screen.getByLabelText(/message the ai/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /close the ai/i }));
    expect(screen.queryByLabelText(/message the ai/i)).not.toBeInTheDocument();
  });

  it("shows the sent message and the reply", async () => {
    const chat = mockChat();
    chat.respondWith({ reply: "There are 8 cards.", board_updated: false, board: null });
    render(<ChatSidebar />);
    await open();

    await ask("How many cards?");

    expect(await screen.findByText("There are 8 cards.")).toBeInTheDocument();
    expect(screen.getByText("How many cards?")).toBeInTheDocument();
  });

  it("shows a pending indicator while waiting", async () => {
    const chat = mockChat();
    const finish = chat.hold();
    render(<ChatSidebar />);
    await open();

    await ask("Slow one");

    expect(await screen.findByText(/thinking/i)).toBeInTheDocument();
    finish();
    await waitFor(() =>
      expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument()
    );
  });

  it("hands an updated board back to the caller", async () => {
    const chat = mockChat();
    const board = testBoard();
    chat.respondWith({ reply: "Moved it.", board_updated: true, board });
    const onBoardUpdate = vi.fn();
    render(<ChatSidebar onBoardUpdate={onBoardUpdate} />);
    await open();

    await ask("Move a card");

    await waitFor(() => expect(onBoardUpdate).toHaveBeenCalledWith(board));
  });

  it("does not call back when the board did not change", async () => {
    const chat = mockChat();
    chat.respondWith({ reply: "Just answering.", board_updated: false, board: null });
    const onBoardUpdate = vi.fn();
    render(<ChatSidebar onBoardUpdate={onBoardUpdate} />);
    await open();

    await ask("A question");

    await screen.findByText("Just answering.");
    expect(onBoardUpdate).not.toHaveBeenCalled();
  });

  it("reports being busy so the board can lock", async () => {
    const chat = mockChat();
    const finish = chat.hold();
    const onBusyChange = vi.fn();
    render(<ChatSidebar onBusyChange={onBusyChange} />);
    await open();

    await ask("Working");

    await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(true));
    finish();
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  });

  it("shows an API failure in the thread", async () => {
    const chat = mockChat();
    chat.failWith(502);
    render(<ChatSidebar />);
    await open();

    await ask("Break it");

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not answer/i);
  });

  it("sends prior turns as history but never failed ones", async () => {
    const chat = mockChat();
    chat.failWith(502);
    render(<ChatSidebar />);
    await open();

    await ask("First");
    await screen.findByRole("alert");

    chat.failWith(200);
    chat.respondWith({ reply: "Second reply", board_updated: false, board: null });
    await ask("Second");
    await screen.findByText("Second reply");

    // The failed exchange leaves the user's turn in history, never the error.
    expect(chat.sent[1].history).toEqual([{ role: "user", content: "First" }]);
  });
});
