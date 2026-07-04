import type { Metadata, Viewport } from "next";
import { Outfit, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const notoSans = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto",
  display: "swap",
});

export const metadata: Metadata = {
  title: "もぐレコ",
  description: "個人用もぐレコPWA",
  icons: { icon: "/icon.svg" },
};
export const viewport: Viewport = { themeColor: "#5c6f59", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${outfit.variable} ${notoSans.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
