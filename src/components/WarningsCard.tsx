import { t, useLocale } from "../lib/i18n";
import { SidebarEmpty, SidebarSection } from "../lib/sidebarPrimitives";
import { Button } from "./ui/Button";
import { WarningList } from "./ui/WarningList";

type WarningsCardProps = {
  onCancelScaleNormalization?: () => void;
  scaleNormalizationApplied?: boolean;
  warnings: string[];
};

export function WarningsCard({
  onCancelScaleNormalization,
  scaleNormalizationApplied = false,
  warnings,
}: WarningsCardProps) {
  useLocale();
  const title = (
    <span className="warnings-title">
      <span>{t("warnings")}</span>
      {scaleNormalizationApplied && onCancelScaleNormalization ? (
        <Button
          className="u-shrink-0"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onCancelScaleNormalization();
          }}
          size="sm"
          variant="subtle"
        >
          {t("cancel_scale_normalize")}
        </Button>
      ) : null}
    </span>
  );

  return (
    <SidebarSection title={title} count={warnings.length}>
      {warnings.length > 0 ? (
        <WarningList warnings={warnings} />
      ) : (
        <SidebarEmpty>{t("no_active_warnings")}</SidebarEmpty>
      )}
    </SidebarSection>
  );
}
