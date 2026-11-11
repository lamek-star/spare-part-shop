/**
 * Which product this installation is: the Spare Parts shop (the default) or the Pharmacy. Both run the
 * same engine; the edition only changes defaults, wording and which pages are shown. Set APP_EDITION in
 * the container's environment; IntraForge runs one service per edition.
 */
export type Edition = "spare-parts" | "pharmacy";

export function edition(): Edition {
  return process.env.APP_EDITION === "pharmacy" ? "pharmacy" : "spare-parts";
}

export const isPharmacy = () => edition() === "pharmacy";

/** The product name shown in the browser title, the shell and documents' footers. */
export const productName = () => (isPharmacy() ? "Pharmacy" : "Spare Parts");
