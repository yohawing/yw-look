import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { Button } from "./Button";
import { ListTextFilter, type ListTextFilterProps } from "./ListTextFilter";
import "../../styles/sidebar-list-section.css";

export type SidebarListSearch = Omit<ListTextFilterProps, "id" | "autoFocus">;

/** Common sidebar heading and collapsible, keyboard-accessible list search. */
export function SidebarListSection({
  title,
  count,
  search,
  className = "",
  bodyClassName,
  children,
}: {
  title: ReactNode;
  count?: ReactNode;
  search?: SidebarListSearch;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const headerRef = useRef<HTMLDivElement>(null);
  const visible = open || Boolean(search?.value);
  const close = () => {
    setOpen(false);
    search?.onChange("");
    headerRef.current?.querySelector("button")?.focus();
  };
  return (
    <section
      className={`${className} yl-disclosure yl-disclosure--section`}
      onKeyDown={(event) => {
        if (
          visible &&
          event.key === "Escape" &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="yl-disclosure__summary" ref={headerRef}>
        <ChevronDownIcon
          className="yl-disclosure__chevron"
          aria-hidden="true"
        />
        <span className="yl-disclosure__title">{title}</span>
        {count != null ? (
          <span className="yl-disclosure__count">{count}</span>
        ) : null}
        {search ? (
          <Button
            aria-label={search.placeholder}
            title={search.placeholder}
            aria-expanded={visible}
            aria-controls={visible ? id : undefined}
            aria-pressed={visible}
            className="yl-list-search-toggle"
            iconOnly
            size="sm"
            variant="ghost"
            onClick={() => (visible ? close() : setOpen(true))}
          >
            <MagnifyingGlassIcon aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <div
        className={`${bodyClassName ?? ""}${search ? " yl-list-search-body" : ""}`}
      >
        {visible && search ? (
          <ListTextFilter {...search} id={id} autoFocus />
        ) : null}
        {children}
      </div>
    </section>
  );
}
