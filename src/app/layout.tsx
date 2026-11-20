import type { Metadata } from "next";
import "./globals.css";
import LiquidBackground from "@/components/LiquidBackground";

export const metadata: Metadata = {
  title: "isamkids — Coming Soon",
  description: "Official website for isamkids. Coming soon.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full bg-black text-white antialiased">
      <body className="min-h-full flex flex-col text-white selection:bg-white selection:text-black">
        <LiquidBackground />
        {children}
      </body>
    </html>
  );
}
