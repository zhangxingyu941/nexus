import { ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import type { KanbanBlockData } from "../../model/block";

interface KanbanBlockEditorProps {
  data: KanbanBlockData;
  isReadOnly: boolean;
  onChange: (data: KanbanBlockData) => void;
}

export function KanbanBlockEditor({ data, isReadOnly, onChange }: KanbanBlockEditorProps) {
  const sequence = useRef(0);
  const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++sequence.current}`;

  const updateColumn = (columnId: string, update: (column: KanbanBlockData["columns"][number]) => KanbanBlockData["columns"][number]) => {
    onChange({
      ...data,
      columns: data.columns.map((column) => column.id === columnId ? update(column) : column),
    });
  };

  const moveCard = (columnIndex: number, cardId: string, direction: -1 | 1) => {
    const targetIndex = columnIndex + direction;
    if (targetIndex < 0 || targetIndex >= data.columns.length) {
      return;
    }

    const columns = data.columns.map((column) => ({ ...column, cards: [...column.cards] }));
    const cardIndex = columns[columnIndex].cards.findIndex((card) => card.id === cardId);
    const [card] = columns[columnIndex].cards.splice(cardIndex, 1);
    if (!card) {
      return;
    }
    columns[targetIndex].cards.push(card);
    onChange({ columns, kind: "kanban" });
  };

  return (
    <div className="flex min-w-0 gap-2 overflow-x-auto rounded-md border bg-muted/20 p-2">
      {data.columns.map((column, columnIndex) => (
        <section className="grid w-[230px] shrink-0 content-start gap-2 rounded-md border bg-background p-2" key={column.id}>
          <div className="flex items-center gap-1">
            {isReadOnly ? (
              <strong className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{column.title}</strong>
            ) : (
              <input
                aria-label={`看板列名 ${column.title}`}
                className="h-8 min-w-0 flex-1 bg-transparent px-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                onChange={(event) => updateColumn(column.id, (item) => ({ ...item, title: event.target.value }))}
                value={column.title}
              />
            )}
            <span className="text-xs text-muted-foreground">{column.cards.length}</span>
            {!isReadOnly && data.columns.length > 1 ? (
              <Button aria-label={`删除看板列 ${column.title}`} className="size-7" onClick={() => onChange({ ...data, columns: data.columns.filter((item) => item.id !== column.id) })} size="icon" type="button" variant="ghost">
                <Trash2 aria-hidden="true" className="size-3.5" />
              </Button>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            {column.cards.map((card) => (
              <article className="grid gap-2 rounded-md border bg-background p-2 shadow-xs" key={card.id}>
                {isReadOnly ? (
                  <span className="text-sm">{card.title}</span>
                ) : (
                  <input
                    aria-label={`看板卡片 ${card.title}`}
                    className="min-w-0 bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                    onChange={(event) => updateColumn(column.id, (item) => ({
                      ...item,
                      cards: item.cards.map((current) => current.id === card.id ? { ...current, title: event.target.value } : current),
                    }))}
                    value={card.title}
                  />
                )}
                {!isReadOnly ? (
                  <div className="flex items-center justify-end gap-0.5">
                    {columnIndex > 0 ? (
                      <Button aria-label={`向左移动 ${card.title}`} className="size-7" onClick={() => moveCard(columnIndex, card.id, -1)} size="icon" type="button" variant="ghost">
                        <ArrowLeft aria-hidden="true" className="size-3.5" />
                      </Button>
                    ) : null}
                    {columnIndex < data.columns.length - 1 ? (
                      <Button aria-label={`向右移动 ${card.title}`} className="size-7" onClick={() => moveCard(columnIndex, card.id, 1)} size="icon" type="button" variant="ghost">
                        <ArrowRight aria-hidden="true" className="size-3.5" />
                      </Button>
                    ) : null}
                    <Button aria-label={`删除卡片 ${card.title}`} className="size-7" onClick={() => updateColumn(column.id, (item) => ({ ...item, cards: item.cards.filter((current) => current.id !== card.id) }))} size="icon" type="button" variant="ghost">
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          {!isReadOnly ? (
            <Button aria-label={`在${column.title}中添加卡片`} className="justify-start" onClick={() => updateColumn(column.id, (item) => ({
              ...item,
              cards: [...item.cards, { id: nextId("card"), title: "新卡片" }],
            }))} size="sm" type="button" variant="ghost">
              <Plus aria-hidden="true" className="size-4" />
              添加卡片
            </Button>
          ) : null}
        </section>
      ))}

      {!isReadOnly ? (
        <Button className="w-[150px] shrink-0 justify-start" onClick={() => onChange({
          ...data,
          columns: [...data.columns, { cards: [], id: nextId("column"), title: "新分组" }],
        })} size="sm" type="button" variant="outline">
          <Plus aria-hidden="true" className="size-4" />
          添加分组
        </Button>
      ) : null}
    </div>
  );
}
