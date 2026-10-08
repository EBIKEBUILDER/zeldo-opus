import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZELDO & the Sunstone",
  description: "A tiny low-poly overhead adventure: a green overworld, a hidden barrow, a jelly king, and treasure.",
};

export const viewport: Viewport = {
  themeColor: "#0b0a10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
