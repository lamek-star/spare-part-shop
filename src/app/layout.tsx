import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "../ui/Shell";
export const metadata: Metadata = {
  title: "Spare Parts",
  description: "Spare parts catalogue, inventory and sales",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
