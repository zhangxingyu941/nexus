import { Check, Copy, ExternalLink, Link2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { normalizeRichTextLink } from "@/shared/richText";

interface LinkPopoverProps {
  anchor: { left: number; top: number };
  initialHref: string;
  onClose: () => void;
  onSubmit: (href: string) => void;
}

export function LinkPopover({ anchor, initialHref, onClose, onSubmit }: LinkPopoverProps) {
  const [value, setValue] = useState(initialHref);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(initialHref);
    setError(null);
  }, [initialHref]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const href = value.trim();
    if (!href) {
      onSubmit("");
      onClose();
      return;
    }

    const normalized = normalizeRichTextLink(href);
    if (!normalized) {
      setError("Enter a valid link");
      return;
    }

    onSubmit(normalized);
    onClose();
  };

  const copy = () => {
    if (initialHref) {
      void navigator.clipboard?.writeText(initialHref);
    }
  };

  return (
    <form
      aria-label="Link editor"
      className="link-popover"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      style={{
        left: `clamp(172px, ${anchor.left}px, calc(100vw - 172px))`,
        top: `clamp(12px, ${anchor.top + 8}px, calc(100vh - 164px))`,
      }}
    >
      <label className="link-popover-label" htmlFor="rich-text-link-url">Link URL</label>
      <div className="link-popover-input-row">
        <Link2 aria-hidden="true" className="size-4" />
        <input
          aria-invalid={error ? "true" : "false"}
          aria-label="Link URL"
          id="rich-text-link-url"
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          ref={inputRef}
          type="url"
          value={value}
        />
        <button aria-label="Save link" className="link-popover-icon-button" type="submit">
          <Check aria-hidden="true" className="size-4" />
        </button>
      </div>
      {error ? <p className="link-popover-error" role="alert">{error}</p> : null}
      {initialHref ? (
        <div className="link-popover-actions">
          <a aria-label="Open link" href={initialHref} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
          <button aria-label="Copy link" onClick={copy} type="button">
            <Copy aria-hidden="true" className="size-4" />
          </button>
          <button aria-label="Remove link" onClick={() => {
            onSubmit("");
            onClose();
          }} type="button">
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}
    </form>
  );
}
