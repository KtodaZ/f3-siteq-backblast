import "~/styles/globals.css";

import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { TRPCReactProvider } from "~/trpc/react";
import { Navigation } from "./_components/navigation";

export const metadata: Metadata = {
	title: "F3 Face Recognition",
	description: "AI-powered face recognition for group photos",
	icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`${geist.variable}`}>
			<body className="min-h-screen bg-gray-50">
				<TRPCReactProvider>
					<Navigation />
					<main>{children}</main>
				</TRPCReactProvider>
			</body>
		</html>
	);
}
