import { moveCard, updateCard, type Card, type Column } from "@/lib/kanban";

describe("moveCard", () => {
  const baseColumns: Column[] = [
    { id: "col-a", title: "A", cardIds: ["card-1", "card-2"] },
    { id: "col-b", title: "B", cardIds: ["card-3"] },
  ];

  it("reorders cards in the same column", () => {
    const result = moveCard(baseColumns, "card-2", "card-1");
    expect(result[0].cardIds).toEqual(["card-2", "card-1"]);
  });

  it("moves cards to another column", () => {
    const result = moveCard(baseColumns, "card-2", "card-3");
    expect(result[0].cardIds).toEqual(["card-1"]);
    expect(result[1].cardIds).toEqual(["card-2", "card-3"]);
  });

  it("drops cards to the end of a column", () => {
    const result = moveCard(baseColumns, "card-1", "col-b");
    expect(result[0].cardIds).toEqual(["card-2"]);
    expect(result[1].cardIds).toEqual(["card-3", "card-1"]);
  });
});

describe("updateCard", () => {
  const cards: Record<string, Card> = {
    "card-1": { id: "card-1", title: "Original", details: "Some details" },
    "card-2": { id: "card-2", title: "Untouched", details: "Leave me" },
  };

  it("updates the title", () => {
    const result = updateCard(cards, "card-1", { title: "Renamed" });
    expect(result["card-1"].title).toBe("Renamed");
  });

  it("updates the details", () => {
    const result = updateCard(cards, "card-1", { details: "New details" });
    expect(result["card-1"].details).toBe("New details");
  });

  it("leaves fields that were not supplied", () => {
    const result = updateCard(cards, "card-1", { title: "Renamed" });
    expect(result["card-1"].details).toBe("Some details");
  });

  it("leaves other cards alone", () => {
    const result = updateCard(cards, "card-1", { title: "Renamed" });
    expect(result["card-2"]).toEqual(cards["card-2"]);
  });

  it("does not mutate the input", () => {
    updateCard(cards, "card-1", { title: "Renamed" });
    expect(cards["card-1"].title).toBe("Original");
  });

  it("ignores an unknown card id", () => {
    const result = updateCard(cards, "card-missing", { title: "Renamed" });
    expect(result).toEqual(cards);
  });
});
