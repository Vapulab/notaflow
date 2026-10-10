import {
  cloneElement,
  type InputHTMLAttributes,
  isValidElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';
import { INPUT_CLASSES, LABEL_CLASSES, SELECT_CLASSES } from './classes';

// Malphas pairs label and control with for/id; the hint describes the control.
export function Field(props: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const child = props.children;
  // A single control gets the id; anything else (a combobox) names itself with aria-label.
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(child)
    ? cloneElement(child, {
        id: child.props.id ?? id,
        ...(props.hint ? { 'aria-describedby': hintId } : {}),
      })
    : child;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={LABEL_CLASSES}>
        {props.label}
      </label>
      {control}
      {props.hint && (
        <span id={hintId} className="text-xs text-muted">
          {props.hint}
        </span>
      )}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT_CLASSES} ${props.className ?? ''}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${INPUT_CLASSES} h-auto min-h-24 py-2 ${props.className ?? ''}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={SELECT_CLASSES} />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted"
      >
        ▾
      </span>
    </div>
  );
}
