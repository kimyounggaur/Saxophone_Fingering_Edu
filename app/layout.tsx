import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "색소폰 운지법 배우기",
  description: "알토·테너·소프라노 색소폰의 33개 음 운지 애니메이션과 차트",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
