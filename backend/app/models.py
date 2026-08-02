from pydantic import BaseModel, model_validator


class Card(BaseModel):
    id: str
    title: str
    details: str


class Column(BaseModel):
    id: str
    title: str
    cardIds: list[str]


class BoardData(BaseModel):
    columns: list[Column]
    cards: dict[str, Card]

    @model_validator(mode="after")
    def every_card_id_resolves(self) -> "BoardData":
        """
        The board is stored as one JSON document, so the database cannot express
        this with a foreign key. Without the check, a column could reference a
        card that does not exist and the UI would silently drop it.
        """
        dangling = [
            card_id
            for column in self.columns
            for card_id in column.cardIds
            if card_id not in self.cards
        ]
        if dangling:
            raise ValueError(f"cardIds reference missing cards: {sorted(set(dangling))}")
        return self
