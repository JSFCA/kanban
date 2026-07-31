import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";

const getFirstColumn = () => screen.getAllByTestId(/column-/i)[0];

describe("KanbanBoard", () => {
  it("renders five columns", () => {
    render(<KanbanBoard />);
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);
  });

  it("renames a column", async () => {
    render(<KanbanBoard />);
    const column = getFirstColumn();
    const input = within(column).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Name");
    expect(input).toHaveValue("New Name");
  });

  it("adds and removes a card", async () => {
    render(<KanbanBoard />);
    const column = getFirstColumn();
    const addButton = within(column).getByRole("button", {
      name: /add a card/i,
    });
    await userEvent.click(addButton);

    const titleInput = within(column).getByPlaceholderText(/card title/i);
    await userEvent.type(titleInput, "New card");
    const detailsInput = within(column).getByPlaceholderText(/details/i);
    await userEvent.type(detailsInput, "Notes");

    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    expect(within(column).getByText("New card")).toBeInTheDocument();

    const deleteButton = within(column).getByRole("button", {
      name: /delete new card/i,
    });
    await userEvent.click(deleteButton);

    expect(within(column).queryByText("New card")).not.toBeInTheDocument();
  });

  it("edits a card title and commits on Enter", async () => {
    render(<KanbanBoard />);
    const column = getFirstColumn();

    await userEvent.click(within(column).getByText("Align roadmap themes"));
    const input = within(column).getByLabelText("Card title");
    await userEvent.clear(input);
    await userEvent.type(input, "Reworked roadmap{Enter}");

    expect(within(column).getByText("Reworked roadmap")).toBeInTheDocument();
    expect(
      within(column).queryByLabelText("Card title")
    ).not.toBeInTheDocument();
  });

  it("edits card details and commits on blur", async () => {
    render(<KanbanBoard />);
    const column = getFirstColumn();

    await userEvent.click(
      within(column).getByText(
        "Draft quarterly themes with impact statements and metrics."
      )
    );
    const textarea = within(column).getByLabelText("Card details");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Shorter notes.");
    await userEvent.tab();

    expect(within(column).getByText("Shorter notes.")).toBeInTheDocument();
  });

  it("keeps the original title when the edit is left empty", async () => {
    render(<KanbanBoard />);
    const column = getFirstColumn();

    await userEvent.click(within(column).getByText("Align roadmap themes"));
    const input = within(column).getByLabelText("Card title");
    await userEvent.clear(input);
    await userEvent.type(input, "{Enter}");

    expect(within(column).getByText("Align roadmap themes")).toBeInTheDocument();
  });

  it("discards an edit on Escape", async () => {
    render(<KanbanBoard />);
    const column = getFirstColumn();

    await userEvent.click(within(column).getByText("Align roadmap themes"));
    const input = within(column).getByLabelText("Card title");
    await userEvent.clear(input);
    await userEvent.type(input, "Should not stick{Escape}");

    expect(within(column).getByText("Align roadmap themes")).toBeInTheDocument();
    expect(within(column).queryByText("Should not stick")).not.toBeInTheDocument();
  });
});
