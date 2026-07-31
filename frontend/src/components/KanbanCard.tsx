import { useState, type KeyboardEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import type { Card } from "@/lib/kanban";

type EditableField = "title" | "details";

type KanbanCardProps = {
  card: Card;
  onUpdate: (cardId: string, fields: Partial<Card>) => void;
  onDelete: (cardId: string) => void;
};

const fieldClasses =
  "w-full rounded-lg border border-[var(--primary-blue)] bg-white px-2 py-1 outline-none";

export const KanbanCard = ({ card, onUpdate, onDelete }: KanbanCardProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id });
  const [editing, setEditing] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState("");

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const startEditing = (field: EditableField) => {
    setEditing(field);
    setDraft(card[field]);
  };

  const commit = () => {
    // An empty title would leave the card unlabelled, so discard that edit.
    if (editing && !(editing === "title" && !draft.trim())) {
      onUpdate(card.id, { [editing]: draft });
    }
    setEditing(null);
  };

  const handleKeyDown = (event: KeyboardEvent, commitOnEnter: boolean) => {
    if (event.key === "Escape") {
      setEditing(null);
    } else if (event.key === "Enter" && commitOnEnter) {
      event.preventDefault();
      commit();
    }
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "rounded-2xl border border-transparent bg-white px-4 py-4 shadow-[0_12px_24px_rgba(3,33,71,0.08)]",
        "transition-all duration-150",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      {...attributes}
      // Drag listeners are withheld while editing so the fields stay usable.
      {...(editing ? {} : listeners)}
      data-testid={`card-${card.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing === "title" ? (
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => handleKeyDown(event, true)}
              aria-label="Card title"
              className={clsx(
                fieldClasses,
                "font-display text-base font-semibold text-[var(--navy-dark)]"
              )}
            />
          ) : (
            <h4
              onClick={() => startEditing("title")}
              className="cursor-text font-display text-base font-semibold text-[var(--navy-dark)]"
            >
              {card.title}
            </h4>
          )}

          {editing === "details" ? (
            <textarea
              autoFocus
              rows={3}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => handleKeyDown(event, false)}
              aria-label="Card details"
              className={clsx(
                fieldClasses,
                "mt-2 resize-none text-sm leading-6 text-[var(--gray-text)]"
              )}
            />
          ) : (
            <p
              onClick={() => startEditing("details")}
              className="mt-2 cursor-text text-sm leading-6 text-[var(--gray-text)]"
            >
              {card.details}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDelete(card.id)}
          className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-[var(--navy-dark)]"
          aria-label={`Delete ${card.title}`}
        >
          Remove
        </button>
      </div>
    </article>
  );
};
