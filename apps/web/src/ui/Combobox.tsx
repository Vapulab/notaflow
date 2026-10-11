import { useId, useState } from 'react';
import { INPUT_CLASSES } from './classes';

export interface ComboboxOption {
  value: string;
  label: string;
}

// A search box and its list of matches in one field (WAI-ARIA combobox with a listbox popup).
// The panel and item classes are the Malphas Dropdown menu ones.
export function Combobox(props: {
  label: string;
  query: string;
  onQueryChange: (query: string) => void;
  options: ComboboxOption[];
  selected: ComboboxOption | null;
  onSelect: (option: ComboboxOption | null) => void;
  placeholder?: string;
  emptyText?: string;
  // A line above the options, such as what makes them suggestions.
  heading?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // With a choice made and nothing typed, there is nothing to list.
  const listing = open && !(props.selected && props.query === '' && props.options.length === 0);
  const shown = listing ? props.options : [];
  const choose = (option: ComboboxOption) => {
    props.onSelect(option);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-label={props.label}
        aria-expanded={listing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        className={`${INPUT_CLASSES} w-full`}
        placeholder={props.placeholder}
        value={props.selected ? props.selected.label : props.query}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          // Typing again means a new search; the earlier choice no longer stands.
          if (props.selected) props.onSelect(null);
          props.onQueryChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, props.options.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === 'Enter' && open && active >= 0) {
            event.preventDefault();
            const option = props.options[active];
            if (option) choose(option);
          } else if (event.key === 'Escape' && listing) {
            // Only the list closes; a dialog around the field stays open.
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {listing && (
        <ul
          id={listId}
          role="listbox"
          aria-label={props.label}
          className="absolute z-40 mt-1 max-h-64 w-full min-w-48 overflow-y-auto rounded border border-border bg-surface py-1 shadow-lg"
        >
          {props.heading && shown.length > 0 && (
            <li role="presentation" className="px-4 pb-1 pt-2 text-xs font-medium text-muted">
              {props.heading}
            </li>
          )}
          {shown.length === 0 && (
            <li className="px-4 py-2 text-sm text-muted">{props.emptyText ?? 'Nada encontrado'}</li>
          )}
          {shown.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={`block w-full cursor-pointer px-4 py-2 text-left text-sm text-fg ${index === active ? 'bg-muted/10' : ''} hover:bg-muted/10`}
              // mousedown, not click: it runs before the input's blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
