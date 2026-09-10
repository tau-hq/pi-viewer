import { type ReactNode, useEffect } from "react";
import { useUiStore } from "@/store/ui-store";

/** Mirrors the stored theme onto <html class="dark"> so Tailwind's dark variant applies. */
export function ThemeProvider({ children }: { children: ReactNode }) {
	const theme = useUiStore((s) => s.theme);
	useEffect(() => {
		const root = document.documentElement;
		root.classList.toggle("dark", theme === "dark");
		root.style.colorScheme = theme;
	}, [theme]);
	return children;
}
