import { t, useLocale } from "../../lib/i18n";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export interface DialogContentProps extends Omit<
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
  "title"
> {
  title: ReactNode;
}

export const Dialog = DialogPrimitive.Root;
export const DialogTitle = DialogPrimitive.Title;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  children,
  className,
  ...props
}: DialogContentProps) {
  useLocale();
  const classes = ["yl-dialog__content", className].filter(Boolean).join(" ");

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="yl-dialog__overlay" />
      <DialogPrimitive.Content className={classes} {...props}>
        <header className="yl-dialog__header">
          <DialogTitle className="yl-dialog__title">{title}</DialogTitle>
          <DialogClose className="yl-dialog__close" type="button">
            {t("close")}
          </DialogClose>
        </header>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
