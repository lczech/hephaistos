import { TextIcon } from "../../components/TextIcon";
import { HEALTH_ICONS } from "../../icons";
import { useHealth } from "./health";

/** The Status View's icon in its tab: its shape tells the health; its colour stays the family's. */
export function StatusIcon({ className }: { className?: string }) {
  const { health } = useHealth();
  return <TextIcon icon={HEALTH_ICONS[health]} className={className} />;
}
