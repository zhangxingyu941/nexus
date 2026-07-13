import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TableBlockData } from "../../model/block";

interface TableBlockEditorProps {
  data: TableBlockData;
  isReadOnly: boolean;
  onChange: (data: TableBlockData) => void;
}

export function TableBlockEditor({ data, isReadOnly, onChange }: TableBlockEditorProps) {
  const sequence = useRef(0);
  const [draftData, setDraftData] = useState(data);
  const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++sequence.current}`;

  useEffect(() => {
    setDraftData(data);
  }, [data]);

  const commit = (nextData: TableBlockData) => {
    setDraftData(nextData);
    onChange(nextData);
  };

  const updateColumn = (columnId: string, name: string) => {
    commit({
      ...draftData,
      columns: draftData.columns.map((column) => column.id === columnId ? { ...column, name } : column),
    });
  };

  const updateCell = (rowId: string, columnId: string, value: string) => {
    commit({
      ...draftData,
      rows: draftData.rows.map((row) =>
        row.id === rowId ? { ...row, cells: { ...row.cells, [columnId]: value } } : row,
      ),
    });
  };

  const addColumn = () => {
    const id = nextId("column");
    commit({
      ...draftData,
      columns: [...draftData.columns, { id, name: "新列" }],
      rows: draftData.rows.map((row) => ({ ...row, cells: { ...row.cells, [id]: "" } })),
    });
  };

  const removeColumn = (columnId: string) => {
    if (draftData.columns.length <= 1) {
      return;
    }

    commit({
      ...draftData,
      columns: draftData.columns.filter((column) => column.id !== columnId),
      rows: draftData.rows.map((row) => {
        const cells = { ...row.cells };
        delete cells[columnId];
        return { ...row, cells };
      }),
    });
  };

  const addRow = () => {
    commit({
      ...draftData,
      rows: [
        ...draftData.rows,
        {
          cells: Object.fromEntries(draftData.columns.map((column) => [column.id, ""])),
          id: nextId("row"),
        },
      ],
    });
  };

  return (
    <div className="grid gap-2 overflow-x-auto rounded-md border bg-background p-2">
      <table aria-label="表格块" className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr>
            {draftData.columns.map((column) => (
              <th className="border bg-muted/40 p-1 text-left font-medium" key={column.id}>
                <div className="flex items-center gap-1">
                  {isReadOnly ? (
                    <span className="px-2 py-1">{column.name}</span>
                  ) : (
                    <input
                      aria-label={`列名 ${column.name}`}
                      className="h-8 min-w-0 flex-1 bg-transparent px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                      onChange={(event) => updateColumn(column.id, event.target.value)}
                      value={column.name}
                    />
                  )}
                  {!isReadOnly && draftData.columns.length > 1 ? (
                    <Button aria-label={`删除列 ${column.name}`} className="size-7" onClick={() => removeColumn(column.id)} size="icon" type="button" variant="ghost">
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              </th>
            ))}
            {!isReadOnly ? (
              <th className="w-10 border bg-muted/20 p-1">
                <Button aria-label="添加列" className="size-7" onClick={addColumn} size="icon" type="button" variant="ghost">
                  <Plus aria-hidden="true" className="size-4" />
                </Button>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {draftData.rows.map((row) => (
            <tr key={row.id}>
              {draftData.columns.map((column) => (
                <td className="border p-1" key={column.id}>
                  {isReadOnly ? (
                    <span className="block min-h-8 px-2 py-1.5">{row.cells[column.id] || ""}</span>
                  ) : (
                    <input
                      aria-label={`单元格 ${row.cells[column.id] || "空白"} ${column.name}`}
                      className="h-8 w-full min-w-0 bg-transparent px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                      onChange={(event) => updateCell(row.id, column.id, event.target.value)}
                      value={row.cells[column.id] || ""}
                    />
                  )}
                </td>
              ))}
              {!isReadOnly ? (
                <td className="w-10 border p-1 text-center">
                  <Button aria-label={`删除行 ${row.id}`} className="size-7" onClick={() => commit({ ...draftData, rows: draftData.rows.filter((item) => item.id !== row.id) })} size="icon" type="button" variant="ghost">
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {!isReadOnly ? (
        <Button className="w-fit" onClick={addRow} size="sm" type="button" variant="outline">
          <Plus aria-hidden="true" className="size-4" />
          添加行
        </Button>
      ) : null}
    </div>
  );
}
