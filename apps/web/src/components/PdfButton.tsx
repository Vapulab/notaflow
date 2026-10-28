import { Button, DownloadIcon, IconButton } from '../ui';

export type PdfStatus = 'pending' | 'ready' | 'failed' | null;

const SPINNER =
  'inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent';

// A pending PDF stays clickable: the server draws it on demand.
export function PdfButton(props: {
  status: PdfStatus;
  label: string;
  onDownload: () => void;
  // "icon" is the list button: the label is only its accessible name.
  variant?: 'text' | 'icon';
}) {
  const pending = props.status === 'pending';
  if (props.variant === 'icon') {
    return (
      <IconButton
        variant="primary"
        label={pending ? 'Gerando PDF' : props.label}
        onClick={props.onDownload}
      >
        {pending ? <span aria-hidden="true" className={SPINNER} /> : <DownloadIcon />}
      </IconButton>
    );
  }
  return (
    <Button size="sm" variant="secondary" onClick={props.onDownload}>
      {pending ? (
        <span aria-live="polite" className="inline-flex items-center gap-2">
          <span aria-hidden="true" className={SPINNER} />
          Gerando PDF…
        </span>
      ) : (
        <span className="inline-flex items-center gap-2">
          <DownloadIcon className="size-4" />
          {props.label}
        </span>
      )}
    </Button>
  );
}
