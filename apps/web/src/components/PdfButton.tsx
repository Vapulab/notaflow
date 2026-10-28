import { Button } from '../ui';

export type PdfStatus = 'pending' | 'ready' | 'failed' | null;

// A pending PDF stays clickable: the server draws it on demand.
export function PdfButton(props: {
  status: PdfStatus;
  label: string;
  onDownload: () => void;
}) {
  const pending = props.status === 'pending';
  return (
    <Button size="sm" variant="secondary" onClick={props.onDownload}>
      {pending ? (
        <span aria-live="polite" className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block size-3 animate-spin rounded-full border-2 border-current border-r-transparent"
          />
          Gerando PDF…
        </span>
      ) : (
        props.label
      )}
    </Button>
  );
}
