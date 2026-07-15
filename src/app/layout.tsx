import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "../styles.css";

export const metadata: Metadata = {
  title: "Nexus",
  description: "面向协同办公场景的 Notion 风格块编辑器",
  icons: {
    icon: "/nexus-logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={GeistSans.variable}>{children}</body>
    </html>
  );
}
