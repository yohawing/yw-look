import { Cross2Icon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { Button } from "./Button";
import "../../styles/list-text-filter.css";

export type ListTextFilterProps = {
  id?: string;
  autoFocus?: boolean;
  ariaLabel: string;
  clearLabel: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
};

/** A small, IME-friendly text filter shared by sidebar lists. */
export function ListTextFilter({
  id,
  autoFocus,
  ariaLabel,
  clearLabel,
  onChange,
  placeholder,
  value,
}: ListTextFilterProps) {
  return (
    <div className="yl-list-text-filter">
      <MagnifyingGlassIcon
        aria-hidden="true"
        className="yl-list-text-filter__icon"
      />
      <input
        id={id}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        className="yl-input yl-list-text-filter__input"
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
      {value.length > 0 ? (
        <Button
          aria-label={clearLabel}
          className="yl-list-text-filter__clear"
          iconOnly
          onClick={() => onChange("")}
          size="sm"
          variant="ghost"
        >
          <Cross2Icon aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
