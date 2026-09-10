import type { ReactNode } from "react";
import {
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
} from "../ui/context-menu";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "../ui/dropdown-menu";

interface KitItemProps {
	onSelect?: () => void;
	destructive?: boolean;
	/** Renders a check mark when true and reserves the space otherwise. */
	checked?: boolean;
	children: ReactNode;
	"data-testid"?: string;
}

interface KitPartProps {
	children: ReactNode;
}

/**
 * The parts a menu is built from, so one list of items can be rendered as the "…" dropdown of a
 * row and as its right-click menu. Radix needs items to sit inside the content of their own
 * primitive, which is the only reason both variants exist.
 */
export interface MenuKit {
	Item: (props: KitItemProps) => ReactNode;
	Separator: () => ReactNode;
	Sub: (props: KitPartProps) => ReactNode;
	SubTrigger: (props: KitPartProps) => ReactNode;
	SubContent: (props: KitPartProps) => ReactNode;
}

export const DROPDOWN_KIT: MenuKit = {
	Item: ({ onSelect, ...rest }) => <DropdownMenuItem {...rest} {...(onSelect ? { onSelect: () => onSelect() } : {})} />,
	Separator: () => <DropdownMenuSeparator />,
	Sub: ({ children }) => <DropdownMenuSub>{children}</DropdownMenuSub>,
	SubTrigger: ({ children }) => <DropdownMenuSubTrigger>{children}</DropdownMenuSubTrigger>,
	SubContent: ({ children }) => <DropdownMenuSubContent>{children}</DropdownMenuSubContent>,
};

export const CONTEXT_KIT: MenuKit = {
	Item: ({ onSelect, ...rest }) => <ContextMenuItem {...rest} {...(onSelect ? { onSelect: () => onSelect() } : {})} />,
	Separator: () => <ContextMenuSeparator />,
	Sub: ({ children }) => <ContextMenuSub>{children}</ContextMenuSub>,
	SubTrigger: ({ children }) => <ContextMenuSubTrigger>{children}</ContextMenuSubTrigger>,
	SubContent: ({ children }) => <ContextMenuSubContent>{children}</ContextMenuSubContent>,
};
