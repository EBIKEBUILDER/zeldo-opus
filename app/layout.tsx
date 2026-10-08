import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZELDO & the Sunstone",
  description: "A tiny low-poly overhead adventure: a green overworld, a hidden barrow, a jelly king, and treasure.",
  appleWebApp: { capable: true, title: "ZELDO", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0b0a10",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // A game: pinch-zoom and double-tap-zoom would fight the touch controls.
  userScalable: false,
  // Draw under the notch; the HUD pads itself with env(safe-area-inset-*).
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
