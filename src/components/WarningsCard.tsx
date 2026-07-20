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
  const title = (
    <span className="warnings-title">
      <span>Warnings</span>
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
          Cancel Scale Normalize
        </Button>
      ) : null}
    </span>
  );

  return (
    <SidebarSection title={title} count={warnings.length}>
      {warnings.length > 0 ? (
        <WarningList warnings={warnings} />
      ) : (
        <SidebarEmpty>No active warnings.</SidebarEmpty>
      )}
    </SidebarSection>
  );
}
