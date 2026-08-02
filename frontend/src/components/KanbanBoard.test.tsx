import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import { testBoard } from "@/test/board-fixture";
import type { BoardData } from "@/lib/kanban";

/** Serves the board on GET and records every PUT payload. */
const mockBoardApi = (options: { getStatus?: number; putStatus?: number } = {}) => {
  const puts: BoardData[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/board" && method === "GET") {
      const status = options.getStatus ?? 200;
      return {
        ok: status < 400,
        status,
        json: async () => testBoard(),
      } as Response;
    }
    if (url === "/api/board" && method === "PUT") {
      puts.push(JSON.parse(init!.body as string));
      const status = options.putStatus ?? 200;
      return { ok: status < 400, status, json: async () => ({}) } as Response;
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return puts;
};

const firstColumn = () => screen.getAllByTestId(/column-/)[0];

const boardReady = async () => {
  await screen.findByText("Align roadmap themes");
};

describe("KanbanBoard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state before the board arrives", () => {
    mockBoardApi();

    render(<KanbanBoard />);

    expect(screen.getByText(/loading your board/i)).toBeInTheDocument();
  });

  it("renders the board returned by the API", async () => {
    mockBoardApi();

    render(<KanbanBoard />);
    await boardReady();

    expect(screen.getAllByTestId(/column-/)).toHaveLength(5);
    expect(screen.getByText("Prototype analytics view")).toBeInTheDocument();
  });

  it("shows an error when the board cannot be loaded", async () => {
    mockBoardApi({ getStatus: 500 });

    render(<KanbanBoard />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
  });

  it("persists a new card", async () => {
    const puts = mockBoardApi();
    render(<KanbanBoard />);
    await boardReady();

    const column = firstColumn();
    await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
    await userEvent.type(within(column).getByPlaceholderText(/card title/i), "Fresh card");
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(Object.values(puts[0].cards).map((card) => card.title)).toContain(
      "Fresh card"
    );
  });

  it("persists a card edit", async () => {
    const puts = mockBoardApi();
    render(<KanbanBoard />);
    await boardReady();

    await userEvent.click(screen.getByText("Align roadmap themes"));
    const input = screen.getByLabelText("Card title");
    await userEvent.clear(input);
    await userEvent.type(input, "Edited title{Enter}");

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].cards["card-1"].title).toBe("Edited title");
  });

  it("persists a card deletion", async () => {
    const puts = mockBoardApi();
    render(<KanbanBoard />);
    await boardReady();

    await userEvent.click(
      screen.getByRole("button", { name: "Delete Align roadmap themes" })
    );

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].cards["card-1"]).toBeUndefined();
  });

  it("collapses rapid column renames into a single request", async () => {
    const puts = mockBoardApi();
    render(<KanbanBoard />);
    await boardReady();

    const input = within(firstColumn()).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "Later");

    await waitFor(() => expect(puts.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(puts).toHaveLength(1);
    expect(puts[0].columns[0].title).toBe("Later");
  });

  it("surfaces an error when saving fails", async () => {
    mockBoardApi({ putStatus: 500 });
    render(<KanbanBoard />);
    await boardReady();

    await userEvent.click(
      screen.getByRole("button", { name: "Delete Align roadmap themes" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save/i);
  });
});
