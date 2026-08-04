"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { sendChat, type ChatTurn } from "@/lib/api";
import { createId, type BoardData } from "@/lib/kanban";

type Turn = { id: string; role: ChatTurn["role"] | "error"; content: string };

type ChatSidebarProps = {
  /** Called only when the AI actually changed the board. */
  onBoardUpdate?: (board: BoardData) => void;
  /** Reported around every request so the board can lock while we wait. */
  onBusyChange?: (busy: boolean) => void;
};

export const ChatSidebar = ({ onBoardUpdate, onBusyChange }: ChatSidebarProps) => {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const threadEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [turns, pending]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending) {
      return;
    }

    // Built before the new turn is added, and without the failed ones: an
    // error is ours to show, not something the model should learn to imitate.
    const history: ChatTurn[] = turns
      .filter((turn) => turn.role !== "error")
      .map(({ role, content }) => ({ role: role as ChatTurn["role"], content }));

    setTurns((prev) => [...prev, { id: createId("turn"), role: "user", content: message }]);
    setDraft("");
    setPending(true);
    onBusyChange?.(true);

    try {
      const answer = await sendChat(message, history);
      setTurns((prev) => [
        ...prev,
        { id: createId("turn"), role: "assistant", content: answer.reply },
      ]);
      if (answer.board_updated && answer.board) {
        onBoardUpdate?.(answer.board);
      }
    } catch (cause) {
      setTurns((prev) => [
        ...prev,
        { id: createId("turn"), role: "error", content: (cause as Error).message },
      ]);
    } finally {
      setPending(false);
      onBusyChange?.(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 rounded-full bg-[var(--secondary-purple)] px-6 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-[var(--shadow)] transition hover:brightness-110"
      >
        AI assistant
      </button>
    );
  }

  return (
    <aside
      aria-label="AI assistant"
      className="fixed bottom-0 right-0 top-0 z-40 flex w-full max-w-[400px] flex-col border-l border-[var(--stroke)] bg-white shadow-[var(--shadow)]"
    >
      <header className="flex items-center justify-between border-b border-[var(--stroke)] px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--gray-text)]">
            Assistant
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold text-[var(--navy-dark)]">
            Ask about the board
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close the AI assistant"
          onClick={() => setOpen(false)}
          className="rounded-full border border-[var(--stroke)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--gray-text)] transition hover:border-[var(--secondary-purple)] hover:text-[var(--secondary-purple)]"
        >
          Close
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
        {turns.length === 0 && (
          <p className="text-sm leading-6 text-[var(--gray-text)]">
            Ask a question about the board, or ask for a change — moving a card,
            adding one, renaming a column.
          </p>
        )}
        {turns.map((turn) => (
          <p
            key={turn.id}
            role={turn.role === "error" ? "alert" : undefined}
            className={clsx(
              "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6",
              turn.role === "user" &&
                "ml-auto bg-[var(--primary-blue)] text-white",
              turn.role === "assistant" &&
                "border border-[var(--stroke)] bg-[var(--surface)] text-[var(--navy-dark)]",
              turn.role === "error" &&
                "border border-[var(--secondary-purple)] bg-white text-[var(--secondary-purple)]"
            )}
          >
            {turn.content}
          </p>
        ))}
        {pending && (
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--gray-text)]">
            Thinking
          </p>
        )}
        <div ref={threadEnd} />
      </div>

      <form
        onSubmit={send}
        className="flex items-end gap-3 border-t border-[var(--stroke)] px-6 py-5"
      >
        <textarea
          aria-label="Message the AI"
          value={draft}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Move the QA card to Done"
          className="flex-1 resize-none rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-[var(--secondary-purple)] px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:brightness-110 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </aside>
  );
};
