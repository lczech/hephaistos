import { TextIcon } from "../../components/TextIcon";
import { HEALTH_ICONS } from "../../icons";
import { useHealth } from "./health";

/** The icon of the Status View in its tab: its shape tells the health; its colour stays that of
 * the family. */
export function StatusIcon({ className }: { className?: string }) {
  const { health } = useHealth();
  return <TextIcon icon={HEALTH_ICONS[health]} className={className} />;
}
