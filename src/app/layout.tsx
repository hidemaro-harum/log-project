import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIグルメ記録",
  description: "個人用グルメ記録PWA",
  icons: { icon: "/icon.svg" },
};
export const viewport: Viewport = { themeColor: "#f97316", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ja"><body>{children}</body></html>;
}
