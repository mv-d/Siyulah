import { Info } from "lucide-react";
import { useI18n } from "../i18n";

/** Shown only in the static preview build: data is recorded, edits are not saved. */
export function PreviewBanner() {
  const { t } = useI18n();
  return (
    <div className="preview-banner" role="note">
      <Info size={15} aria-hidden="true" />
      <span>{t("preview.banner")}</span>
    </div>
  );
}
