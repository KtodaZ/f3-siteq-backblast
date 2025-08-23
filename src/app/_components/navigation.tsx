"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Navigation() {
	const pathname = usePathname();

	const navItems = [
		{ href: "/", label: "Home", icon: "🏠" },
		{ href: "/upload", label: "Upload", icon: "📸" },
		{ href: "/photos", label: "Photos", icon: "🖼️" },
		{ href: "/people", label: "People", icon: "👥" },
	];

	return (
		<nav className="border-b bg-white shadow-lg">
			<div className="container mx-auto px-4">
				<div className="flex h-16 items-center justify-between">
					{/* Logo */}
					<Link href="/" className="flex items-center space-x-2">
						<span className="text-2xl">🤖</span>
						<span className="font-bold text-gray-800 text-xl">
							F3 Face Recognition
						</span>
					</Link>

					{/* Navigation Links */}
					<div className="hidden space-x-8 md:flex">
						{navItems.map((item) => (
							<Link
								key={item.href}
								href={item.href}
								className={`flex items-center space-x-1 rounded-md px-3 py-2 font-medium text-sm transition-colors ${
									pathname === item.href
										? "bg-blue-100 text-blue-700"
										: "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
								}`}
							>
								<span>{item.icon}</span>
								<span>{item.label}</span>
							</Link>
						))}
					</div>

					{/* Mobile menu button */}
					<div className="md:hidden">
						<button
							type="button"
							className="text-gray-600 hover:text-gray-900 focus:text-gray-900 focus:outline-none"
						>
							<svg
								className="h-6 w-6"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								aria-label="Open menu"
								role="img"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M4 6h16M4 12h16M4 18h16"
								/>
							</svg>
						</button>
					</div>
				</div>

				{/* Mobile Navigation */}
				<div className="border-gray-200 border-t md:hidden">
					<div className="space-y-1 px-2 pt-2 pb-3">
						{navItems.map((item) => (
							<Link
								key={item.href}
								href={item.href}
								className={`flex items-center space-x-2 rounded-md px-3 py-2 font-medium text-base transition-colors ${
									pathname === item.href
										? "bg-blue-100 text-blue-700"
										: "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
								}`}
							>
								<span>{item.icon}</span>
								<span>{item.label}</span>
							</Link>
						))}
					</div>
				</div>
			</div>
		</nav>
	);
}
