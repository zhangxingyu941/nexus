import { FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DOCUMENT_TEMPLATES } from "../../model/documentOperations";
import type { CreateWorkspaceDocumentInput } from "../../model/workspaceOperations";

interface TemplateDialogProps {
  onClose: () => void;
  onCreateFromTemplate: (input?: CreateWorkspaceDocumentInput) => void;
}

export function TemplateDialog({ onClose, onCreateFromTemplate }: TemplateDialogProps) {
  return (
    <Dialog defaultOpen modal={false} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-2xl"
        onCloseAutoFocus={(event) => event.preventDefault()}
        showOverlay={false}
      >
        <DialogHeader>
          <DialogTitle>新建文档</DialogTitle>
          <DialogDescription>选择一个起点，创建后可继续自由调整。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {DOCUMENT_TEMPLATES.map((template) => (
            <Button
              className="h-auto min-h-24 justify-start whitespace-normal border-border p-4 text-left"
              key={template.id}
              onClick={() => onCreateFromTemplate(template.id === "blank" ? undefined : { templateId: template.id })}
              type="button"
              variant="outline"
            >
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted text-foreground">
                {template.id === "blank" ? <FileText className="size-4" /> : <Sparkles className="size-4" />}
              </span>
              <span className="grid gap-1">
                <strong className="text-sm font-medium">{template.id === "blank" ? "空白文档" : template.title}</strong>
                <small className="text-xs font-normal leading-5 text-muted-foreground">{template.description}</small>
              </span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
